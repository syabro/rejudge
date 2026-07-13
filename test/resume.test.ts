import { test, expect } from "vitest";
import { rmSync } from "node:fs";
import { runReview } from "../src/review.ts";
import type { RejudgeConfig } from "../src/config.ts";
import { newRunId, runDir, writeManifest } from "../src/run-store.ts";
import { integrationTest } from "./integration.ts";

const STUB = "opencode-go/kimi-k2.6";
const SPEC = { id: STUB, level: "minimal" } as const;
const GOOD: RejudgeConfig = { reviewers: [SPEC, SPEC], judge: SPEC, debugLog: false };

// Deterministic — these fail at the resume guards before any model call, so no key needed.

test("resuming an unknown run fails with a resume error", async () => {
  const result = await runReview(GOOD, "follow up", { resumeRunId: "2020-01-01T00-00-00-000Z-gone12" });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.stage).toBe("resume");
    expect(result.error.error).toMatch(/not found|expired/i);
  }
});

test("resuming a run from a different cwd is refused", async () => {
  const runId = newRunId();
  writeManifest({
    version: 3,
    runId,
    cwd: "/totally/different/project",
    createdAt: new Date(0).toISOString(),
    fullTools: false,
    reviewers: [{ modelId: STUB, level: "minimal", file: "/nope.jsonl" }],
    judge: { modelId: STUB, level: "minimal", file: "/nope.jsonl" },
  });
  try {
    const result = await runReview(GOOD, "follow up", { resumeRunId: runId, cwd: process.cwd() });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.stage).toBe("resume");
      expect(result.error.error).toMatch(/different project/i);
    }
  } finally {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
});

test("resuming a run whose session files are gone fails with a resume error", async () => {
  const runId = newRunId();
  writeManifest({
    version: 3,
    runId,
    cwd: process.cwd(),
    createdAt: new Date(0).toISOString(),
    fullTools: false,
    reviewers: [{ modelId: STUB, level: "minimal", file: `${runDir(runId)}/gone-reviewer.jsonl` }],
    judge: { modelId: STUB, level: "minimal", file: `${runDir(runId)}/gone-judge.jsonl` },
  });
  try {
    const result = await runReview(GOOD, "follow up", { resumeRunId: runId, cwd: process.cwd() });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.stage).toBe("resume");
      expect(result.error.error).toMatch(/missing/i);
    }
  } finally {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
});

// Real run, no mocks: the heart of SYN-029. A fresh run puts a unique token into visible
// run history; a second runReview({resumeRunId}) follow-up recalls it — proving the
// reviewer and judge sessions were persisted and restored with context. A control run (no resume)
// can't recall it.
integrationTest("a follow-up resumes a prior run and answers with its context", async () => {
  const token = "X9Q7-KELP-418";

  const first = await runReview(GOOD, `Repeat this token exactly: ${token}`, {
    cwd: process.cwd(),
  });
  expect(first.isOk()).toBe(true);
  if (!first.isOk()) return;
  const runId = first.value.runId;

  try {
    // Follow-up in a fresh runReview call: it must recall the token from restored context.
    const followUp = await runReview(GOOD, "What was the token? Reply with just the token.", {
      cwd: process.cwd(),
      resumeRunId: runId,
    });
    expect(followUp.isOk()).toBe(true);
    if (followUp.isOk()) {
      expect(followUp.value.answer).toContain(token);
      expect(followUp.value.runId).toBe(runId);
    }

    // Control: the SAME question as a fresh run (no resume) can't know the token — proving the
    // follow-up's recall came from restored context, not the model guessing.
    const control = await runReview(GOOD, "What was the token? Reply with just the token.", {
      cwd: process.cwd(),
    });
    expect(control.isOk()).toBe(true);
    if (control.isOk()) {
      expect(control.value.answer).not.toContain(token);
      rmSync(runDir(control.value.runId), { recursive: true, force: true });
    }
  } finally {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
}, 300_000);
