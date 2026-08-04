import { test, expect } from "vitest";
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ASK_PANEL_TOOL_NAME, makeAskPanelTool } from "../src/ask-panel-tool.ts";
import { READONLY_TOOLS, resolveModel, type ReviewerResult } from "../src/runner.ts";
import { gitDiffTool, GIT_DIFF_TOOL_NAME } from "../src/git-diff-tool.ts";
import { runPanel } from "../src/panel.ts";
import type { ProgressEvent } from "../src/events.ts";
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

function fakePanelSession(
  promptBody: (ctx: { question: string; messages: Record<string, unknown>[]; emit: (event: unknown) => void }) => Promise<void> | void,
  options: { text?: string | ((question: string) => string); onAbort?: () => void } = {},
): ReviewerResult["session"] {
  const messages: Record<string, unknown>[] = [{ role: "assistant", stopReason: "stop" }];
  let subscriber: ((event: unknown) => void) | undefined;
  let lastQuestion = "";
  return {
    state: { messages },
    subscribe(cb: (event: never) => void) {
      subscriber = cb as (event: unknown) => void;
      return () => {
        subscriber = undefined;
      };
    },
    async prompt(question: string) {
      lastQuestion = question;
      await promptBody({ question, messages, emit: (event) => subscriber?.(event) });
    },
    getLastAssistantText() {
      return typeof options.text === "function" ? options.text(lastQuestion) : options.text ?? "follow-up answer";
    },
    abort() {
      options.onAbort?.();
    },
  } as unknown as ReviewerResult["session"];
}

// Deterministic (no session touched, no model): an unknown role key short-circuits before any
// re-query and returns an error VALUE (not a throw) that lists the valid panel roles — so the judge
// learns which sessions it can actually re-query. The dummy entries are a typed input, not a mock of
// the runner/Pi/models (the not-found branch never reads the session).
test("ask_panel returns an error listing valid roles for an unknown role", async () => {
  const panel: ReviewerResult[] = [
    { roleKey: "panel-1", modelId: "provider/alpha", text: "a", session: {} as ReviewerResult["session"] },
    { roleKey: "panel-2", modelId: "provider/beta", text: "b", session: {} as ReviewerResult["session"] },
  ];
  const tool = makeAskPanelTool(panel);

  const result = await tool.execute(
    "call-1",
    { queries: [{ role: "panel-9", question: "anything" }] },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  const text = resultText(result);
  expect(text).toContain("panel-9");
  expect(text).toContain("Valid roles: panel-1, panel-2.");
});

// Deterministic fake sessions: role-key targeting must pick the requested slot even when model ids
// are identical.
test("ask_panel targets a stable panel role when model ids are duplicated", async () => {
  const prompts = [0, 0];
  const makeSession = (index: number) => fakePanelSession(({ messages }) => {
    prompts[index]++;
    messages.push({ role: "assistant", stopReason: "stop" });
  });
  const panel = [
    { roleKey: "panel-1", modelId: "provider/shared", text: "a", session: makeSession(0) },
    { roleKey: "panel-2", modelId: "provider/shared", text: "b", session: makeSession(1) },
  ] as ReviewerResult[];
  const tool = makeAskPanelTool(panel);

  const result = await tool.execute(
    "call-1",
    { queries: [{ role: "panel-2", question: "check the second slot" }] },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  expect(prompts).toEqual([0, 1]);
  expect(resultText(result)).toContain("panel-2 (provider/shared)");
});

test("ask_panel serializes repeated reviewer queries while distinct reviewers run in parallel", async () => {
  const started: string[] = [];
  let panelOneActive = false;
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  let markSecondReviewerStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const secondReviewerStarted = new Promise<void>((resolve) => { markSecondReviewerStarted = resolve; });

  const panelOne = fakePanelSession(async ({ question, messages }) => {
    if (panelOneActive) {
      throw new Error("Agent is already processing");
    }
    panelOneActive = true;
    started.push(`panel-1:${question}`);
    try {
      if (question === "q1") {
        markFirstStarted();
        await firstGate;
      }
      messages.push({ role: "assistant", stopReason: "stop" });
    } finally {
      panelOneActive = false;
    }
  }, { text: (question) => `${question} answer` });

  const panelTwo = fakePanelSession(({ question, messages }) => {
    started.push(`panel-2:${question}`);
    markSecondReviewerStarted();
    messages.push({ role: "assistant", stopReason: "stop" });
  }, { text: (question) => `${question} answer` });

  const tool = makeAskPanelTool([
    { roleKey: "panel-1", modelId: "provider/alpha", text: "a", session: panelOne },
    { roleKey: "panel-2", modelId: "provider/beta", text: "b", session: panelTwo },
  ]);

  const execution = tool.execute(
    "call-1",
    { queries: [
      { role: "panel-1", question: "q1" },
      { role: "panel-2", question: "q2" },
      { role: "panel-1", question: "q3" },
    ] },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  await Promise.all([firstStarted, secondReviewerStarted]);
  expect(started).toEqual(["panel-1:q1", "panel-2:q2"]);

  releaseFirst();
  const result = await execution;
  const text = resultText(result);
  expect(started).toEqual(["panel-1:q1", "panel-2:q2", "panel-1:q3"]);
  expect(text).not.toContain("Agent is already processing");
  expect(text.indexOf("q1 answer")).toBeLessThan(text.indexOf("q2 answer"));
  expect(text.indexOf("q2 answer")).toBeLessThan(text.indexOf("q3 answer"));
});

// Re-query progress carries the same stable role key as the target session.
test("ask_panel emits panel progress while re-querying a live session", async () => {
  const session = fakePanelSession(({ messages, emit }) => {
    emit({ type: "message_update", assistantMessageEvent: { type: "text_start" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "follow-up" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_end" } });
    messages.push({ role: "assistant", stopReason: "stop" });
  });

  const events: ProgressEvent[] = [];
  const tool = makeAskPanelTool([{ roleKey: "panel-1", modelId: "provider/alpha", text: "a", session }], (event) => {
    events.push(event);
  });

  const result = await tool.execute(
    "call-1",
    { queries: [{ role: "panel-1", question: "check again" }] },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  expect(resultText(result)).toContain("follow-up answer");
  expect(events[0]).toMatchObject({ kind: "model_start", roleKey: "panel-1", model: "provider/alpha", role: "reviewer" });
  expect(events).toContainEqual(expect.objectContaining({ kind: "activity", roleKey: "panel-1", model: "provider/alpha", activity: "writing", phase: "start" }));
  const activityEnd = events.findIndex((event) => event.kind === "activity" && event.phase === "end");
  const modelEnd = events.findIndex((event) => event.kind === "model_end");
  expect(activityEnd).toBeGreaterThan(0);
  expect(modelEnd).toBeGreaterThan(activityEnd);
  expect(events[modelEnd]).toMatchObject({ kind: "model_end", roleKey: "panel-1", model: "provider/alpha", role: "reviewer", status: "done" });
});

// If the judge turn was already cancelled, ask_panel must not start a new model call or show a
// ghost row.
test("ask_panel does not start a re-query when the signal is already aborted", async () => {
  let prompted = false;
  const session = fakePanelSession(() => {
    prompted = true;
  });
  const events: ProgressEvent[] = [];
  const tool = makeAskPanelTool([{ roleKey: "panel-1", modelId: "provider/alpha", text: "a", session }], (event) => {
    events.push(event);
  });
  const controller = new AbortController();
  controller.abort();

  const result = await tool.execute(
    "call-1",
    { queries: [{ role: "panel-1", question: "check again" }] },
    controller.signal,
    undefined,
    { cwd: process.cwd() } as never,
  );

  expect(prompted).toBe(false);
  expect(events).toHaveLength(0);
  expect(resultText(result)).toContain("cancelled");
});

test("ask_panel marks an in-flight re-query as cancelled", async () => {
  const controller = new AbortController();
  let abortCalled = false;
  const session = fakePanelSession(
    ({ messages, emit }) => {
      emit({ type: "message_update", assistantMessageEvent: { type: "text_start" } });
      controller.abort();
      messages.push({ role: "assistant", stopReason: "aborted" });
    },
    { onAbort: () => { abortCalled = true; } },
  );
  const events: ProgressEvent[] = [];
  const tool = makeAskPanelTool([{ roleKey: "panel-1", modelId: "provider/alpha", text: "a", session }], (event) => {
    events.push(event);
  });

  const result = await tool.execute(
    "call-1",
    { queries: [{ role: "panel-1", question: "check again" }] },
    controller.signal,
    undefined,
    { cwd: process.cwd() } as never,
  );

  const modelEnd = events.find((event) => event.kind === "model_end");
  expect(abortCalled).toBe(true);
  expect(resultText(result)).toContain("stopReason: aborted");
  expect(events).toContainEqual(expect.objectContaining({ kind: "activity", phase: "end", aborted: true }));
  expect(modelEnd).toMatchObject({ kind: "model_end", status: "cancelled" });
});

test("ask_panel marks a thrown re-query as an error", async () => {
  const session = fakePanelSession(() => {
    throw new Error("boom");
  });
  const events: ProgressEvent[] = [];
  const tool = makeAskPanelTool([{ roleKey: "panel-1", modelId: "provider/alpha", text: "a", session }], (event) => {
    events.push(event);
  });

  const result = await tool.execute(
    "call-1",
    { queries: [{ role: "panel-1", question: "check again" }] },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  const modelEnd = events.find((event) => event.kind === "model_end");
  expect(resultText(result)).toContain("boom");
  expect(modelEnd).toMatchObject({ kind: "model_end", status: "error" });
});

test("ask_panel marks a non-clean re-query stop reason as an error", async () => {
  const session = fakePanelSession(({ messages }) => {
    messages.push({ role: "assistant", stopReason: "length", errorMessage: "too long" });
  });
  const events: ProgressEvent[] = [];
  const tool = makeAskPanelTool([{ roleKey: "panel-1", modelId: "provider/alpha", text: "a", session }], (event) => {
    events.push(event);
  });

  const result = await tool.execute(
    "call-1",
    { queries: [{ role: "panel-1", question: "check again" }] },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  const modelEnd = events.find((event) => event.kind === "model_end");
  expect(resultText(result)).toContain("stopReason: length");
  expect(modelEnd).toMatchObject({ kind: "model_end", status: "error" });
});

// Real SDK, no model call: the ask_panel custom tool, wired the way the judge wires it
// (customTools + its name in the allow-list), actually activates in a session. This proves the
// askPanel threading shape the judge relies on.
test("a session with ask_panel in customTools + allow-list activates it", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  const askPanel = makeAskPanelTool([]);
  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({
    model: await resolveModel(STUB, modelRuntime),
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

// Real run, no mocks: one ask_panel call can queue multiple prompts for the same live reviewer
// session. Each prompt produces a clean new assistant turn and both answers reach the judge.
integrationTest("ask_panel serializes repeated follow-ups to one live panel session", async () => {
  const panelResult = await runPanel([{ id: STUB, level: "minimal" }], "Reply with exactly the word: PONG. Nothing else.");
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
      { queries: [
        { role: "panel-1", question: "Now reply with exactly the word: PING. Nothing else." },
        { role: "panel-1", question: "Now reply with exactly the word: PANG. Nothing else." },
      ] },
      new AbortController().signal,
      undefined,
      { cwd: process.cwd() } as never,
    );

    const text = resultText(result);
    expect(text.split("### panel-1")).toHaveLength(3);
    expect(text).not.toContain("Agent is already processing");
    expect(text).not.toContain("did not answer cleanly");

    const after = session.state.messages;
    expect(after.length).toBeGreaterThan(messagesBefore);
    const assistantsAfter = after.filter((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");
    expect(assistantsAfter).toHaveLength(assistantsBefore + 2);
    expect(assistantsAfter.slice(-2).map((message) => message.stopReason)).toEqual(["stop", "stop"]);
  } finally {
    for (const r of panel) r.session.dispose();
  }
}, 120_000);
