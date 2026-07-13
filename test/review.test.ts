import { test, expect } from "vitest";
import { runReview } from "../src/review.ts";
import type { RejudgeConfig } from "../src/config.ts";
import { integrationTest } from "./integration.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
// Used for all 4 agents (3 reviewers + 1 judge) — this exercises the all-or-nothing
// contract, not answer quality; the real 3+1 models run in the PNL-009 demo.
const STUB = "opencode-go/kimi-k2.6";
// Reasoning level is irrelevant to the stub smoke; keep it minimal so the runs are fast.
const SPEC = { id: STUB, level: "minimal" } as const;
const GOOD: RejudgeConfig = { reviewers: [SPEC, SPEC, SPEC], judge: SPEC, debugLog: false };
const PROMPT = "Reply with exactly the word: PONG. Nothing else.";

// Real run, no mocks: all three reviewers and the judge complete → one final answer.
integrationTest("runReview returns one final answer when the panel and judge succeed", async () => {
  const result = await runReview(GOOD, PROMPT);
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    expect(result.value.answer.trim().length).toBeGreaterThan(0);
    expect(result.value.runId.length).toBeGreaterThan(0);
  }
}, 180_000);

// A panel technical failure → err, no answer (the judge never runs). The failure names
// the panel stage and the offending model (PNL-017), not an abort.
integrationTest("runReview fails with no answer when a reviewer fails", async () => {
  const result = await runReview(
    {
      reviewers: [SPEC, { id: "opencode-go/not-a-real-model", level: "minimal" }, SPEC],
      judge: SPEC,
      debugLog: false,
    },
    PROMPT,
  );
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.stage).toBe("panel");
    expect(result.error.model).toBe("opencode-go/not-a-real-model");
    expect(result.error.aborted).toBe(false);
  }
}, 180_000);

// A judge technical failure → err even though all reviewers succeeded. The failure names
// the judge stage and offending model.
integrationTest("runReview fails with no answer when the judge fails", async () => {
  const result = await runReview(
    {
      reviewers: [SPEC, SPEC, SPEC],
      judge: { id: "opencode-go/not-a-real-model", level: "minimal" },
      debugLog: false,
    },
    PROMPT,
  );
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.stage).toBe("judge");
    expect(result.error.model).toBe("opencode-go/not-a-real-model");
    expect(result.error.aborted).toBe(false);
  }
}, 180_000);

// Cancellation (PNL-016). Pre-aborted: every agent short-circuits before any model call,
// so this is fast and deterministic — proves the signal is threaded end-to-end, and that
// the failure is flagged as an abort (PNL-017), not blamed on a model fault.
test("runReview honors an already-aborted signal and reports it as aborted", async () => {
  const result = await runReview(GOOD, PROMPT, { signal: AbortSignal.abort() });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.stage).toBe("panel");
    expect(result.error.aborted).toBe(true);
    // combine returns the first agent's failure in input order → the first panel model.
    expect(result.error.model).toBe(STUB);
  }
}, 30_000);

// In-flight: abort shortly after start cancels the running agents (had the signal been
// dropped, the run would complete and return ok) — the actual "stop burning credits".
integrationTest("aborting mid-run cancels the review", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 400);
  const result = await runReview(GOOD, PROMPT, { signal: ac.signal });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error.aborted).toBe(true);
}, 180_000);
