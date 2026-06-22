import { expect } from "vitest";
import { runPanel } from "../src/panel.ts";
import { integrationTest } from "./integration.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
// Three instances exercise the fan-out mechanism (dispatch 3, collect 3, order,
// distinct sessions) without the latency of the real panel models — those run
// in the PNL-009 end-to-end demo.
const STUB = "opencode-go/kimi-k2.6";
const SPEC = { id: STUB, level: "minimal" } as const;

// Real run, no mocks: one invocation dispatches all three agents and collects
// three independent finished outputs, one per model id, in input order.
integrationTest("runPanel fans the same prompt out to three agents and collects three outputs", async () => {
  const models = [SPEC, SPEC, SPEC];
  const result = await runPanel(models, "Reply with exactly the word: PONG. Nothing else.");
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    const outputs = result.value;
    try {
      expect(outputs).toHaveLength(3);
      expect(outputs.map((r) => r.modelId)).toEqual(models.map((m) => m.id));
      for (const r of outputs) {
        expect(r.text.trim().length).toBeGreaterThan(0);
      }
      // Three independent sessions, not one reused.
      expect(new Set(outputs.map((r) => r.session)).size).toBe(3);
    } finally {
      for (const r of outputs) r.session.dispose();
    }
  }
}, 120_000);

// A failure in any single agent surfaces as err naming that model — no partial panel.
integrationTest("runPanel surfaces a failure instead of returning a partial panel", async () => {
  const result = await runPanel(
    [SPEC, { id: "opencode-go/not-a-real-model", level: "minimal" }, SPEC],
    "Reply with exactly the word: PONG.",
  );
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.model).toBe("opencode-go/not-a-real-model");
  }
}, 120_000);
