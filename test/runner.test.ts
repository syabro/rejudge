import { test, expect } from "vitest";
import { resolveModel, runPanelAgent } from "../src/runner.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
const STUB = "opencode-go/kimi-k2.6";

test("resolveModel rejects malformed and unknown model ids", () => {
  expect(() => resolveModel("no-slash")).toThrow();
  expect(() => resolveModel("opencode-go/")).toThrow();
  expect(() => resolveModel("opencode-go/not-a-real-model")).toThrow();
});

// Real run, no mocks: one agent runs end-to-end on a real model and returns text.
test("runPanelAgent runs one model end-to-end and returns finished text", async () => {
  const result = await runPanelAgent(STUB, "Reply with exactly the word: PONG. Nothing else.");
  try {
    expect(result.modelId).toBe(STUB);
    expect(result.text.trim().length).toBeGreaterThan(0);
  } finally {
    result.session.dispose();
  }
}, 60_000);
