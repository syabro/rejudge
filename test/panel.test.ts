import { test, expect } from "vitest";
import { runPanel } from "../src/panel.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
// Three instances exercise the fan-out mechanism (dispatch 3, collect 3, order,
// distinct sessions) without the latency of the real panel models — those run
// in the PNL-009 end-to-end demo.
const STUB = "opencode-go/kimi-k2.6";

// Real run, no mocks: one invocation dispatches all three agents and collects
// three independent finished outputs, one per model id, in input order.
test("runPanel fans the same prompt out to three agents and collects three outputs", async () => {
  const models = [STUB, STUB, STUB];
  const results = await runPanel(models, "Reply with exactly the word: PONG. Nothing else.");
  try {
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.modelId)).toEqual(models);
    for (const r of results) {
      expect(r.text.trim().length).toBeGreaterThan(0);
    }
    // Three independent sessions, not one reused.
    expect(new Set(results.map((r) => r.session)).size).toBe(3);
  } finally {
    for (const r of results) r.session.dispose();
  }
}, 120_000);

// A failure in any single agent surfaces loudly — no silent partial panel.
test("runPanel surfaces a failure instead of returning a partial panel", async () => {
  await expect(
    runPanel([STUB, "opencode-go/not-a-real-model", STUB], "Reply with exactly the word: PONG."),
  ).rejects.toThrow();
}, 120_000);
