import { test, expect } from "vitest";
import { buildJudgePrompt, runJudge, type ReviewerOutput } from "../src/judge.ts";
import { makeAskPanelTool } from "../src/ask-panel-tool.ts";
import { integrationTest } from "./integration.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
const STUB = "opencode-go/kimi-k2.6";

// Deterministic (no model): the judge's prompt carries only the analyses plus the ask_panel guidance.
// It must contain every panel output and the panel model ids (so the judge knows whom to re-query),
// make consulting the default, and omit the "## Task" section.
test("buildJudgePrompt gives the judge the analyses + ask_panel, not the task", () => {
  const panel: ReviewerOutput[] = [
    { roleKey: "panel-1", modelId: "m1", text: "alpha-distinct-answer" },
    { roleKey: "panel-2", modelId: "m2", text: "beta-distinct-answer" },
    { roleKey: "panel-3", modelId: "m3", text: "gamma-distinct-answer" },
  ];
  const built = buildJudgePrompt(panel);

  for (const p of panel) {
    expect(built).toContain(p.text);
  }
  expect(built).toContain("## Analyses");
  expect(built).not.toContain("Candidate");
  // The judge's prompt omits the task section entirely.
  expect(built).not.toContain("## Task");
  // ask_panel is the always-present, consult-by-default channel, with the panel ids listed.
  expect(built).toContain("ask_panel");
  expect(built).toContain("Before you answer, make one batched");
  expect(built).toContain("checkable");
  expect(built).toContain("(panel-1, panel-2, panel-3)");
  expect(built).toContain("### panel-2 (m2)");
});

// Real run, no mocks: one real judge call fuses three static analyses into a single answer.
// Exact format preservation is model behavior, so the smoke test checks wiring and content only.
// ask_panel is wired (empty here) to mirror production. The full three-panel fan-out is covered by
// review.test.ts.
integrationTest("runJudge fuses the analyses into one answer", async () => {
  const panel: ReviewerOutput[] = [
    { roleKey: "panel-1", modelId: "m1", text: "RESULT: The capital of France is Paris." },
    { roleKey: "panel-2", modelId: "m2", text: "RESULT: Paris is the capital of France." },
    { roleKey: "panel-3", modelId: "m3", text: "RESULT: It's Paris." },
  ];

  const result = await runJudge(STUB, panel, makeAskPanelTool([]));

  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    const answer = result.value;
    expect(answer.trim().length).toBeGreaterThan(0);
    expect(answer).toMatch(/Paris/i);
  }
}, 120_000);
