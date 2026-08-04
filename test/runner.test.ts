import { test, expect } from "vitest";
import {
  createAgentSession,
  ModelRuntime,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  REVIEWER_TOOLS,
  READONLY_TOOLS,
  createInnerAgentSession,
  resolveModel,
  reviewerToolNames,
  runAgent,
} from "../src/runner.ts";
import { gitDiffTool, GIT_DIFF_TOOL_NAME } from "../src/git-diff-tool.ts";
import { ASK_PANEL_TOOL_NAME, makeAskPanelTool } from "../src/ask-panel-tool.ts";
import type { ProgressEvent } from "../src/events.ts";
import { integrationTest } from "./integration.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
const STUB = "opencode-go/kimi-k2.6";

interface FakePromptTurn {
  stopReason: string;
  text?: string;
  errorMessage?: string;
  beforeMessage?: () => void;
  events?: AgentSessionEvent[];
}

type FakeRunSession = AgentSession & {
  prompts: string[];
  disposed: boolean;
  disposeCount: number;
};

function fakeRunSession(turns: FakePromptTurn[]): FakeRunSession {
  const messages: Record<string, unknown>[] = [];
  let latestText = "";
  let subscriber: ((event: AgentSessionEvent) => void) | undefined;
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

      turn.beforeMessage?.();
      const message: Record<string, unknown> = { role: "assistant", stopReason: turn.stopReason };
      if (turn.errorMessage) {
        message.errorMessage = turn.errorMessage;
      }
      messages.push(message);
      latestText = turn.text ?? "";
      for (const event of turn.events ?? []) {
        subscriber?.(event);
      }
    },
    getLastAssistantText() {
      return latestText;
    },
    abort() {},
    subscribe(callback: (event: AgentSessionEvent) => void) {
      subscriber = callback;
      return () => {
        subscriber = undefined;
      };
    },
    dispose() {
      session.disposed = true;
      session.disposeCount += 1;
    },
  } as unknown as FakeRunSession;

  return session;
}

test("reviewer tool names reflect the granted safety mode and available host tools", () => {
  expect(reviewerToolNames(false, [])).toEqual(["read", "grep", "find", "ls", "git_diff"]);
  expect(reviewerToolNames(false, ["web_search"])).toEqual([
    "read",
    "grep",
    "find",
    "ls",
    "git_diff",
    "web_search",
  ]);
  expect(reviewerToolNames(true, ["web_search"])).toEqual([
    "read",
    "grep",
    "find",
    "ls",
    "git_diff",
    "edit",
    "write",
    "bash",
    "web_search",
  ]);
});

// Real SDK, no model call: a session created with REVIEWER_TOOLS actually activates
// the full local tool set — read, the dedicated grep/find/ls search/list tools,
// and edit/write/bash — so inner agents search/list with the dedicated tools
// instead of shelling out through bash (TLS-003). Whether a model then *picks*
// grep over bash is nondeterministic and left to the live demo, not asserted here.
test("a session built from REVIEWER_TOOLS activates the dedicated grep/find/ls tools", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({
    model: await resolveModel(STUB, modelRuntime),
    cwd,
    agentDir,
    tools: [...REVIEWER_TOOLS],
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
// registered AND allow-listed (the wiring runAgent uses).
test("a session with git_diff in customTools + allow-list activates it", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({
    model: await resolveModel(STUB, modelRuntime),
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

test("a pre-resolved read-only policy is the session's exact allow-list", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  const reviewerTools = reviewerToolNames(false, []);
  const session = await createInnerAgentSession(STUB, { cwd, fullTools: true, reviewerTools });

  try {
    expect(session.getActiveToolNames()).toEqual(reviewerTools);
  } finally {
    session.dispose();
  }
}, 30_000);

// Real SDK, no model call: a judge session activates exactly [ask_panel] — its sole tool.
test("a judge session exposes ask_panel and nothing else", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  const session = await createInnerAgentSession(STUB, {
    cwd,
    role: "judge",
    askPanel: makeAskPanelTool([]),
  });
  try {
    expect(session.getActiveToolNames()).toEqual([ASK_PANEL_TOOL_NAME]);
  } finally {
    session.dispose();
  }
}, 30_000);

test("resolveModel rejects malformed and unknown model ids", async () => {
  const modelRuntime = await ModelRuntime.create();

  await expect(resolveModel("no-slash", modelRuntime)).rejects.toThrow();
  await expect(resolveModel("opencode-go/", modelRuntime)).rejects.toThrow();
  await expect(resolveModel("opencode-go/not-a-real-model", modelRuntime)).rejects.toThrow();
});

test("runAgent emits one lifecycle pair when session creation fails", async () => {
  const events: ProgressEvent[] = [];

  const result = await runAgent("invalid-model-id", "original prompt", {
    activitySink: (event) => events.push(event),
  });

  expect(result.isErr()).toBe(true);
  expect(events.map((event) => event.kind)).toEqual(["model_start", "model_end"]);
  expect(events[1]).toMatchObject({
    kind: "model_end",
    model: "invalid-model-id",
    role: "reviewer",
    status: "error",
  });
});

test("runAgent flushes open activity before model_end", async () => {
  const session = fakeRunSession([
    {
      stopReason: "stop",
      text: "visible answer",
      events: [
        {
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        } as AgentSessionEvent,
      ],
    },
  ]);
  const events: ProgressEvent[] = [];

  const result = await runAgent("provider/model", "original prompt", {
    existingSession: session,
    activitySink: (event) => events.push(event),
  });

  expect(result.isOk()).toBe(true);
  const activityStart = events.findIndex(
    (event) => event.kind === "activity" && event.phase === "start",
  );
  const activityEnd = events.findIndex(
    (event) => event.kind === "activity" && event.phase === "end",
  );
  const modelEnd = events.findIndex((event) => event.kind === "model_end");
  expect(activityStart).toBeGreaterThan(0);
  expect(activityEnd).toBeGreaterThan(activityStart);
  expect(events[activityEnd]).toMatchObject({ kind: "activity", aborted: true });
  expect(modelEnd).toBeGreaterThan(activityEnd);

  if (result.isOk()) {
    result.value.session.dispose();
  }
});

test("runAgent retries one clean empty response in the same session", async () => {
  const session = fakeRunSession([
    { stopReason: "stop", text: "  " },
    { stopReason: "stop", text: "visible answer" },
  ]);

  const result = await runAgent("provider/model", "original prompt", { existingSession: session });

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

test("runAgent fails explicitly when the retry is still empty", async () => {
  const session = fakeRunSession([
    { stopReason: "stop", text: "" },
    { stopReason: "stop", text: "\t" },
  ]);

  const result = await runAgent("provider/model", "original prompt", { existingSession: session });

  expect(result.isErr()).toBe(true);
  expect(session.prompts).toHaveLength(2);
  expect(session.disposeCount).toBe(1);
  if (result.isErr()) {
    expect(result.error.error).toContain("empty-output-after-retry");
  }
});

test("runAgent reports a non-clean empty-output retry", async () => {
  const session = fakeRunSession([
    { stopReason: "stop", text: "" },
    { stopReason: "length", errorMessage: "too long" },
  ]);

  const result = await runAgent("provider/model", "original prompt", { existingSession: session });

  expect(result.isErr()).toBe(true);
  expect(session.prompts).toHaveLength(2);
  expect(session.disposeCount).toBe(1);
  if (result.isErr()) {
    expect(result.error.error).toContain("empty-output retry did not complete cleanly");
    expect(result.error.error).toContain("stopReason: length");
    expect(result.error.error).toContain("too long");
  }
});

test("runAgent does not retry an initially non-clean response", async () => {
  const session = fakeRunSession([{ stopReason: "length", errorMessage: "too long" }]);

  const result = await runAgent("provider/model", "original prompt", { existingSession: session });

  expect(result.isErr()).toBe(true);
  expect(session.prompts).toHaveLength(1);
  expect(session.disposeCount).toBe(1);
  if (result.isErr()) {
    expect(result.error.error).toContain("did not complete cleanly");
    expect(result.error.error).not.toContain("retry");
  }
});

test("runAgent marks an SDK-aborted prompt as cancelled", async () => {
  const controller = new AbortController();
  const session = fakeRunSession([
    {
      stopReason: "aborted",
      errorMessage: "cancelled",
      beforeMessage: () => controller.abort(),
    },
  ]);

  const result = await runAgent("provider/model", "original prompt", {
    existingSession: session,
    signal: controller.signal,
  });

  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.aborted).toBe(true);
});

test("runAgent keeps a technical failure technical after a late abort", async () => {
  const controller = new AbortController();
  const session = fakeRunSession([
    {
      stopReason: "error",
      errorMessage: "provider failed",
      beforeMessage: () => controller.abort(),
    },
  ]);

  const result = await runAgent("provider/model", "original prompt", {
    existingSession: session,
    signal: controller.signal,
  });

  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.error).toContain("provider failed");
    expect(result.error.aborted).toBe(false);
  }
});

// Real run, no mocks: read-only is the DEFAULT (CLI-023). With no tool option the
// agent's actual session is limited to exactly read/grep/find/ls — edit, write and
// bash are absent, so a review cannot change files or run shell
// in its cwd. createAgentSession({tools}) is an allowlist, so the active set is
// exactly READONLY_TOOLS, nothing more.
integrationTest("runAgent defaults to read-only (read/grep/find/ls only)", async () => {
  const result = await runAgent(STUB, "Reply with exactly the word: PONG. Nothing else.");
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
integrationTest("runAgent with fullTools gives the full local tool set", async () => {
  const result = await runAgent(STUB, "Reply with exactly the word: PONG. Nothing else.", {
    fullTools: true,
  });
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    try {
      const names = [...result.value.session.getActiveToolNames()];
      expect(names).toEqual(expect.arrayContaining([...REVIEWER_TOOLS, GIT_DIFF_TOOL_NAME]));
    } finally {
      result.value.session.dispose();
    }
  }
}, 60_000);

// Real run, no mocks: one agent runs end-to-end on a real model and returns text.
integrationTest("runAgent runs one model end-to-end and returns finished text", async () => {
  const result = await runAgent(STUB, "Reply with exactly the word: PONG. Nothing else.");
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
