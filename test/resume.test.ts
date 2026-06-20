import { test, expect } from "vitest";
import { rmSync } from "node:fs";
import { fuse } from "../src/fusion.ts";
import type { FusionConfig } from "../src/config.ts";
import { newRunId, runDir, writeManifest } from "../src/run-store.ts";
import { integrationTest } from "./integration.ts";

const STUB = "opencode-go/kimi-k2.6";
const THINKING = { panel: "minimal", synth: "minimal" } as const;
const GOOD: FusionConfig = { panel: [STUB, STUB], synth: STUB, thinking: THINKING, debugLog: false };

// Deterministic — these fail at the resume guards before any model call, so no key needed.

test("resuming an unknown run fails with a resume error", async () => {
  const result = await fuse(GOOD, "follow up", { resumeRunId: "2020-01-01T00-00-00-000Z-gone12" });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.stage).toBe("resume");
    expect(result.error.error).toMatch(/not found|expired/i);
  }
});

test("resuming a run from a different cwd is refused", async () => {
  const runId = newRunId();
  writeManifest({
    version: 1,
    runId,
    cwd: "/totally/different/project",
    createdAt: new Date(0).toISOString(),
    fullTools: false,
    thinking: { panel: "minimal", synth: "minimal" },
    panel: [{ modelId: STUB, file: "/nope.jsonl" }],
    synth: { modelId: STUB, file: "/nope.jsonl" },
  });
  try {
    const result = await fuse(GOOD, "follow up", { resumeRunId: runId, cwd: process.cwd() });
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
    version: 1,
    runId,
    cwd: process.cwd(),
    createdAt: new Date(0).toISOString(),
    fullTools: false,
    thinking: { panel: "minimal", synth: "minimal" },
    panel: [{ modelId: STUB, file: `${runDir(runId)}/gone-a.jsonl` }],
    synth: { modelId: STUB, file: `${runDir(runId)}/gone-synth.jsonl` },
  });
  try {
    const result = await fuse(GOOD, "follow up", { resumeRunId: runId, cwd: process.cwd() });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.stage).toBe("resume");
      expect(result.error.error).toMatch(/missing/i);
    }
  } finally {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
});

// Real run, no mocks: the heart of SYN-029. A fresh run plants a fact only the run's sessions
// know; a SECOND, separate fuse({resumeRunId}) follow-up recalls it — proving the panel+synth
// sessions were persisted and restored WITH context. A control run (no resume) can't recall it.
integrationTest("a follow-up resumes a prior run and answers with its context", async () => {
  // Round 1: plant the secret in the run's sessions.
  const first = await fuse(GOOD, "Remember this exactly: the secret word is BANANA. Reply with just: OK", {
    cwd: process.cwd(),
  });
  expect(first.isOk()).toBe(true);
  if (!first.isOk()) return;
  const runId = first.value.runId;

  try {
    // Follow-up in a fresh fuse call, resuming the run: it must recall BANANA from context.
    const followUp = await fuse(GOOD, "What was the secret word I told you? Reply with just the word.", {
      cwd: process.cwd(),
      resumeRunId: runId,
    });
    expect(followUp.isOk()).toBe(true);
    if (followUp.isOk()) {
      expect(followUp.value.answer).toMatch(/banana/i);
      expect(followUp.value.runId).toBe(runId);
    }

    // Control: the SAME question as a fresh run (no resume) can't know the secret — proving the
    // follow-up's recall came from restored context, not the model guessing.
    const control = await fuse(GOOD, "What was the secret word I told you? Reply with just the word.", {
      cwd: process.cwd(),
    });
    expect(control.isOk()).toBe(true);
    if (control.isOk()) {
      expect(control.value.answer).not.toMatch(/banana/i);
      rmSync(runDir(control.value.runId), { recursive: true, force: true });
    }
  } finally {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
}, 300_000);
