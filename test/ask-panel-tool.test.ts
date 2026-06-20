import { test, expect } from "vitest";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ASK_PANEL_TOOL_NAME, makeAskPanelTool } from "../src/ask-panel-tool.ts";
import { READONLY_TOOLS, resolveModel, type PanelAgentResult } from "../src/runner.ts";
import { gitDiffTool, GIT_DIFF_TOOL_NAME } from "../src/git-diff-tool.ts";
import { runPanel } from "../src/panel.ts";
import { integrationTest } from "./integration.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
const STUB = "opencode-go/kimi-k2.6";

// ask_panel.execute never reads its `ctx` (5th) arg — it only uses params + signal — so the tests
// pass a minimal stand-in cast `as never` rather than constructing the SDK's full ExtensionContext.
/** Join a tool result's text content into one string. */
function resultText(result: { content: { type: string }[] }): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

// Deterministic (no session touched, no model): an unknown model id short-circuits before any
// re-query and returns an error VALUE (not a throw) that lists the valid panel ids — so the judge
// learns which models it can actually re-query. The dummy entries are a typed input, not a mock of
// the runner/Pi/models (the not-found branch never reads the session).
test("ask_panel returns an error listing valid models for an unknown model", async () => {
  const panel = [
    { modelId: "provider/alpha", text: "a", session: {} as PanelAgentResult["session"] },
    { modelId: "provider/beta", text: "b", session: {} as PanelAgentResult["session"] },
  ];
  const tool = makeAskPanelTool(panel);

  const result = await tool.execute(
    "call-1",
    { model: "provider/nope", question: "anything" },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  const text = resultText(result);
  expect(text).toContain("provider/nope");
  expect(text).toContain("provider/alpha");
  expect(text).toContain("provider/beta");
});

// Real SDK, no model call: the ask_panel custom tool, wired the way runPanelAgent wires it
// (customTools + its name in the allow-list), actually activates in a session. This proves the
// extraTools threading shape the synth/"judge" agent relies on.
test("a session with ask_panel in customTools + allow-list activates it", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fusion-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-proj-"));
  const askPanel = makeAskPanelTool([]);
  const { session } = await createAgentSession({
    model: resolveModel(STUB),
    cwd,
    agentDir,
    tools: [...READONLY_TOOLS, GIT_DIFF_TOOL_NAME, ASK_PANEL_TOOL_NAME],
    customTools: [gitDiffTool, askPanel],
  });
  try {
    expect(session.getActiveToolNames()).toContain(ASK_PANEL_TOOL_NAME);
  } finally {
    session.dispose();
  }
}, 30_000);

// Real run, no mocks: the heart of SYN-011 — a panel agent's session stays ALIVE after round 1
// and is re-promptable for a second round. Run a real one-model panel, then re-query that live
// session via ask_panel and assert it did NEW work: the message log grew by a fresh assistant
// turn that completed cleanly, and the tool returned its text.
integrationTest("ask_panel re-queries a live panel session for a second round", async () => {
  const panelResult = await runPanel([STUB], "Reply with exactly the word: PONG. Nothing else.");
  expect(panelResult.isOk()).toBe(true);
  if (!panelResult.isOk()) return;

  const panel = panelResult.value;
  const session = panel[0].session;
  const tool = makeAskPanelTool(panel);

  const messagesBefore = session.state.messages.length;
  const assistantsBefore = session.state.messages.filter((m) => m.role === "assistant").length;

  try {
    const result = await tool.execute(
      "call-1",
      { model: STUB, question: "Now reply with exactly the word: PING. Nothing else." },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() } as never,
    );

    // The tool surfaced the panel's follow-up answer.
    expect(resultText(result).trim().length).toBeGreaterThan(0);

    // The same session did new work: more messages, a fresh assistant turn, ended cleanly.
    const after = session.state.messages;
    expect(after.length).toBeGreaterThan(messagesBefore);
    expect(after.filter((m) => m.role === "assistant").length).toBeGreaterThan(assistantsBefore);

    const lastAssistant = [...after]
      .reverse()
      .find((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");
    expect(lastAssistant?.stopReason).toBe("stop");
  } finally {
    for (const r of panel) r.session.dispose();
  }
}, 120_000);
