import { test, expect } from "vitest";
import { buildSynthesisPrompt, synthesize, type PanelOutput } from "../src/synth.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
const STUB = "opencode-go/kimi-k2.6";

// Deterministic (no model): the synthesis prompt threads the original task AND
// every panel output, and instructs the model to emit only the single final
// answer. This is the contract "consumes all three outputs + original task".
test("buildSynthesisPrompt threads the task and all panel outputs", () => {
  const panel: PanelOutput[] = [
    { modelId: "m1", text: "alpha-distinct-answer" },
    { modelId: "m2", text: "beta-distinct-answer" },
    { modelId: "m3", text: "gamma-distinct-answer" },
  ];
  const prompt = "ORIGINAL-TASK-MARKER: answer the question";
  const built = buildSynthesisPrompt(prompt, panel);

  expect(built).toContain(prompt);
  for (const p of panel) {
    expect(built).toContain(p.text);
  }
  // Tells the synthesizer to obey the task's format and surface only the answer.
  const lower = built.toLowerCase();
  expect(lower).toContain("only");
  expect(lower).toContain("final answer");
});

// Real run, no mocks: one real synth call fuses three (static) panel outputs into
// a single answer that respects the task's requested format. Only the synth model
// runs here — the full three-panel fan-out is covered by fusion.test.ts.
test("synthesize fuses panel outputs into one answer respecting the format", async () => {
  const panel: PanelOutput[] = [
    { modelId: "m1", text: "The capital of France is Paris." },
    { modelId: "m2", text: "Paris is the capital of France." },
    { modelId: "m3", text: "It's Paris." },
  ];
  // The candidates do NOT carry the format — only the task does, so a pass proves
  // synthesis applied the original task's output instruction.
  const prompt = "What is the capital of France? Begin your reply with the token RESULT:";

  const answer = await synthesize(STUB, prompt, panel);

  expect(answer.trim().length).toBeGreaterThan(0);
  // Format applied (the task's instruction), AND fused content preserved.
  expect(answer.trim()).toMatch(/^RESULT\s*:/i);
  expect(answer).toMatch(/Paris/i);
}, 120_000);
