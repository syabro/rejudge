import { test, expect } from "vitest";
import { fuse } from "../src/fusion.ts";
import type { FusionConfig } from "../src/config.ts";
import { integrationTest } from "./integration.ts";

// Fastest reliable opencode-go model; content is irrelevant for the smoke run.
// Used for all 4 agents (3 panel + 1 synth) — this exercises the all-or-nothing
// contract, not synthesis quality; the real 3+1 models run in the PNL-009 demo.
const STUB = "opencode-go/kimi-k2.6";
// Thinking level is irrelevant to the stub smoke; keep it minimal so the runs are fast.
const THINKING = { panel: "minimal", synth: "minimal" } as const;
const GOOD: FusionConfig = { panel: [STUB, STUB, STUB], synth: STUB, thinking: THINKING, debugLog: false };
const PROMPT = "Reply with exactly the word: PONG. Nothing else.";

// Real run, no mocks: all three panels AND synthesis complete → one final answer.
integrationTest("fuse returns one final answer when all panels and synthesis succeed", async () => {
  const result = await fuse(GOOD, PROMPT);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.answer.trim().length).toBeGreaterThan(0);
  }
}, 180_000);

// A panel technical failure → binary failure, no answer text (synthesis never runs).
integrationTest("fuse fails with no answer when a panel agent fails", async () => {
  const result = await fuse(
    { panel: [STUB, "opencode-go/not-a-real-model", STUB], synth: STUB, thinking: THINKING, debugLog: false },
    PROMPT,
  );
  expect(result.ok).toBe(false);
  expect("answer" in result).toBe(false);
}, 180_000);

// A synthesis technical failure → binary failure even though all panels succeeded.
integrationTest("fuse fails with no answer when synthesis fails", async () => {
  const result = await fuse(
    { panel: [STUB, STUB, STUB], synth: "opencode-go/not-a-real-model", thinking: THINKING, debugLog: false },
    PROMPT,
  );
  expect(result.ok).toBe(false);
  expect("answer" in result).toBe(false);
}, 180_000);

// Cancellation (PNL-016). Pre-aborted: every agent short-circuits before any model call,
// so this is fast and deterministic — proves the signal is threaded end-to-end.
test("fuse honors an already-aborted signal", async () => {
  const result = await fuse(GOOD, PROMPT, { signal: AbortSignal.abort() });
  expect(result.ok).toBe(false);
}, 30_000);

// In-flight: abort shortly after start cancels the running agents (had the signal been
// dropped, the run would complete and return ok:true) — the actual "stop burning credits".
integrationTest("aborting mid-run cancels the fusion", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 400);
  const result = await fuse(GOOD, PROMPT, { signal: ac.signal });
  expect(result.ok).toBe(false);
}, 180_000);
