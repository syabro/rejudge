import { test, expect } from "vitest";
import { createAgentSession, type AgentSession } from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PANEL_TOOLS, READONLY_TOOLS, createInnerSession, resolveModel, runPanelAgent } from "../src/runner.ts";
import { gitDiffTool, GIT_DIFF_TOOL_NAME } from "../src/git-diff-tool.ts";
import { ASK_PANEL_TOOL_NAME, makeAskPanelTool } from "../src/ask-panel-tool.ts";
import { integrationTest } from "./integration.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
const STUB = "opencode-go/kimi-k2.6";

interface FakePromptTurn {
  stopReason: string;
  text?: string;
  errorMessage?: string;
}

type FakeRunSession = AgentSession & {
  prompts: string[];
  disposed: boolean;
  disposeCount: number;
};

function fakeRunSession(turns: FakePromptTurn[]): FakeRunSession {
  const messages: Record<string, unknown>[] = [];
  let latestText = "";
  const pendingTurns = [...turns];

  const session = {
    state: { messages },
    prompts: [] as string[],
    disposed: false,
    disposeCount: 0,
    async prompt(prompt: string) {
      session.prompts.push(prompt);
      const turn = pendingTurns.shift();
      if (!turn) throw new Error("unexpected prompt");

      const message: Record<string, unknown> = { role: "assistant", stopReason: turn.stopReason };
      if (turn.errorMessage) {
        message.errorMessage = turn.errorMessage;
      }
      messages.push(message);
      latestText = turn.text ?? "";
    },
    getLastAssistantText() {
      return latestText;
    },
    abort() {},
    dispose() {
      session.disposed = true;
      session.disposeCount += 1;
    },
  } as unknown as FakeRunSession;

  return session;
}

// Real SDK, no model call: a session created with PANEL_TOOLS actually activates
// the full local tool set — read, the dedicated grep/find/ls search/list tools,
// and edit/write/bash — so inner agents search/list with the dedicated tools
// instead of shelling out through bash (TLS-003). Whether a model then *picks*
// grep over bash is nondeterministic and left to the live demo, not asserted here.
test("a session built from PANEL_TOOLS activates the dedicated grep/find/ls tools", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fusion-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-proj-"));
  const { session } = await createAgentSession({
    model: resolveModel(STUB),
    cwd,
    agentDir,
    tools: [...PANEL_TOOLS],
  });
  try {
    expect(session.getActiveToolNames()).toEqual(
      expect.arrayContaining(["read", "grep", "find", "ls", "edit", "write", "bash"]),
    );
  } finally {
    session.dispose();
  }
}, 30_000);

// Real SDK, no model call: the custom read-only git_diff tool (TLS-026) is wired into a
// session via customTools + its name in the allow-list, so it actually activates alongside
// the read-only built-ins. This proves the SDK enables a custom tool only when both
// registered AND allow-listed (the wiring runPanelAgent uses).
test("a session with git_diff in customTools + allow-list activates it", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fusion-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-proj-"));
  const { session } = await createAgentSession({
    model: resolveModel(STUB),
    cwd,
    agentDir,
    tools: [...READONLY_TOOLS, GIT_DIFF_TOOL_NAME],
    customTools: [gitDiffTool],
  });
  try {
    expect(session.getActiveToolNames()).toContain(GIT_DIFF_TOOL_NAME);
  } finally {
    session.dispose();
  }
}, 30_000);

// Real SDK, no model call: a synth/"judge" session (role "synth") activates exactly [ask_panel] —
// its sole tool — and fullTools leaves that set unchanged. Asserted directly, independent of model
// behavior.
test("a synth/judge session exposes ask_panel and nothing else", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-proj-"));
  const session = await createInnerSession(STUB, {
    cwd,
    role: "synth",
    fullTools: true, // proves the judge stays at [ask_panel] regardless
    askPanel: makeAskPanelTool([]),
  });
  try {
    expect(session.getActiveToolNames()).toEqual([ASK_PANEL_TOOL_NAME]);
  } finally {
    session.dispose();
  }
}, 30_000);

test("resolveModel rejects malformed and unknown model ids", () => {
  expect(() => resolveModel("no-slash")).toThrow();
  expect(() => resolveModel("opencode-go/")).toThrow();
  expect(() => resolveModel("opencode-go/not-a-real-model")).toThrow();
});

test("runPanelAgent retries one clean empty response in the same session", async () => {
  const session = fakeRunSession([
    { stopReason: "stop", text: "  " },
    { stopReason: "stop", text: "visible answer" },
  ]);

  const result = await runPanelAgent("provider/model", "original prompt", { existingSession: session });

  expect(result.isOk()).toBe(true);
  expect(session.prompts).toHaveLength(2);
  expect(session.prompts[0]).toBe("original prompt");
  expect(session.prompts[1]).toContain("visible");
  expect(session.disposeCount).toBe(0);
  if (result.isOk()) {
    expect(result.value.text).toBe("visible answer");
    expect(result.value.session).toBe(session);
    result.value.session.dispose();
  }
});

test("runPanelAgent fails explicitly when the retry is still empty", async () => {
  const session = fakeRunSession([
    { stopReason: "stop", text: "" },
    { stopReason: "stop", text: "\t" },
  ]);

  const result = await runPanelAgent("provider/model", "original prompt", { existingSession: session });

  expect(result.isErr()).toBe(true);
  expect(session.prompts).toHaveLength(2);
  expect(session.disposeCount).toBe(1);
  if (result.isErr()) {
    expect(result.error.error).toContain("empty-output-after-retry");
  }
});

test("runPanelAgent reports a non-clean empty-output retry", async () => {
  const session = fakeRunSession([
    { stopReason: "stop", text: "" },
    { stopReason: "length", errorMessage: "too long" },
  ]);

  const result = await runPanelAgent("provider/model", "original prompt", { existingSession: session });

  expect(result.isErr()).toBe(true);
  expect(session.prompts).toHaveLength(2);
  expect(session.disposeCount).toBe(1);
  if (result.isErr()) {
    expect(result.error.error).toContain("empty-output retry did not complete cleanly");
    expect(result.error.error).toContain("stopReason: length");
    expect(result.error.error).toContain("too long");
  }
});

test("runPanelAgent does not retry an initially non-clean response", async () => {
  const session = fakeRunSession([{ stopReason: "length", errorMessage: "too long" }]);

  const result = await runPanelAgent("provider/model", "original prompt", { existingSession: session });

  expect(result.isErr()).toBe(true);
  expect(session.prompts).toHaveLength(1);
  expect(session.disposeCount).toBe(1);
  if (result.isErr()) {
    expect(result.error.error).toContain("did not complete cleanly");
    expect(result.error.error).not.toContain("retry");
  }
});

// Real run, no mocks: read-only is the DEFAULT (CLI-023). With no tool option the
// agent's actual session is limited to exactly read/grep/find/ls — edit, write and
// bash are absent, so a fusion used as a reviewer cannot change files or run shell
// in its cwd. createAgentSession({tools}) is an allowlist, so the active set is
// exactly READONLY_TOOLS, nothing more.
integrationTest("runPanelAgent defaults to read-only (read/grep/find/ls only)", async () => {
  const result = await runPanelAgent(STUB, "Reply with exactly the word: PONG. Nothing else.");
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    try {
      const names = [...result.value.session.getActiveToolNames()];
      expect(names).toEqual(expect.arrayContaining([...READONLY_TOOLS, GIT_DIFF_TOOL_NAME]));
      expect(names).not.toContain("edit");
      expect(names).not.toContain("write");
      expect(names).not.toContain("bash");
    } finally {
      result.value.session.dispose();
    }
  }
}, 60_000);

// Real run, no mocks: opting in with fullTools gives the full local set (the
// read-only tools plus edit/write/bash), so writing is an explicit choice.
integrationTest("runPanelAgent with fullTools gives the full local tool set", async () => {
  const result = await runPanelAgent(STUB, "Reply with exactly the word: PONG. Nothing else.", {
    fullTools: true,
  });
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    try {
      const names = [...result.value.session.getActiveToolNames()];
      expect(names).toEqual(expect.arrayContaining([...PANEL_TOOLS, GIT_DIFF_TOOL_NAME]));
    } finally {
      result.value.session.dispose();
    }
  }
}, 60_000);

// Real run, no mocks: one agent runs end-to-end on a real model and returns text.
integrationTest("runPanelAgent runs one model end-to-end and returns finished text", async () => {
  const result = await runPanelAgent(STUB, "Reply with exactly the word: PONG. Nothing else.");
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    try {
      expect(result.value.modelId).toBe(STUB);
      expect(result.value.text.trim().length).toBeGreaterThan(0);
    } finally {
      result.value.session.dispose();
    }
  }
}, 60_000);
