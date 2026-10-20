import { test, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReview } from "../src/review.ts";
import type { RejudgeConfig } from "../src/config.ts";
import { listRunHistory, newRunId, readManifest, runDir, writeManifest } from "../src/run-store.ts";
import type { ProgressEvent } from "../src/events.ts";
import { integrationTest } from "./integration.ts";

const STUB = "opencode-go/glm-5.3-flash";
const SPEC = { id: STUB, level: "minimal" } as const;
const GOOD: RejudgeConfig = { reviewers: [SPEC, SPEC], judge: SPEC, debugLog: false };
const DEBUG_GOOD: RejudgeConfig = { ...GOOD, debugLog: true };

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
    version: 4,
    runId,
    cwd: "/totally/different/project",
    createdAt: new Date(0).toISOString(),
    fullTools: false,
    reviewers: [{ roleKey: "panel-1", modelId: STUB, level: "minimal", file: "/nope.jsonl" }],
    judge: { roleKey: "judge", modelId: STUB, level: "minimal", file: "/nope.jsonl" },
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
    version: 4,
    runId,
    cwd: process.cwd(),
    createdAt: new Date(0).toISOString(),
    fullTools: false,
    reviewers: [{ roleKey: "panel-1", modelId: STUB, level: "minimal", file: `${runDir(runId)}/gone-reviewer.jsonl` }],
    judge: { roleKey: "judge", modelId: STUB, level: "minimal", file: `${runDir(runId)}/gone-judge.jsonl` },
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
  const verificationMarker = "X9Q7-KELP-418";
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-history-resume-"));
  const conversationId = `conversation-${cwd}`;

  const first = await runReview(GOOD, `Repeat this token exactly: ${verificationMarker}`, {
    cwd, conversationId, title: "Remember token",
  });
  expect(first.isOk()).toBe(true);
  if (!first.isOk()) {
    rmSync(cwd, { recursive: true, force: true });
    return;
  }
  const runId = first.value.runId;

  try {
    const before = readManifest(runId)!;
    expect(before.conversationId).toBe(conversationId);
    expect(listRunHistory(cwd, conversationId).runs[0].runId).toBe(runId);
    // Follow-up in a fresh runReview call: it must recall the token from restored context.
    const followUp = await runReview(GOOD, "What was the token? Reply with just the token.", {
      cwd, conversationId: "another-conversation", title: "Do not replace original title",
      resumeRunId: runId,
    });
    expect(followUp.isOk()).toBe(true);
    if (followUp.isOk()) {
      expect(followUp.value.answer).toContain(verificationMarker);
      expect(followUp.value.runId).toBe(runId);
      const after = readManifest(runId)!;
      expect(after.conversationId).toBe(conversationId);
      expect(after.title).toBe("Remember token");
      expect(after.originalQuestion).toBe(before.originalQuestion);
      expect(Date.parse(after.lastRequestAt!)).toBeGreaterThan(Date.parse(before.lastRequestAt!));
      expect(listRunHistory(cwd, conversationId).runs[0].lastRequestAt).toBe(after.lastRequestAt);

      const cancelled = await runReview(GOOD, "cancelled follow-up", { cwd, resumeRunId: runId, signal: AbortSignal.abort() });
      expect(cancelled.isErr()).toBe(true);
      expect(readManifest(runId)?.lastRequestAt).toBe(after.lastRequestAt);
    }

    // Control: the SAME question as a fresh run (no resume) can't know the token — proving the
    // follow-up's recall came from restored context, not the model guessing.
    const control = await runReview(GOOD, "What was the token? Reply with just the token.", { cwd });
    expect(control.isOk()).toBe(true);
    if (control.isOk()) {
      expect(control.value.answer).not.toContain(verificationMarker);
      rmSync(runDir(control.value.runId), { recursive: true, force: true });
    }
  } finally {
    rmSync(runDir(runId), { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}, 300_000);

integrationTest("a resumed duplicate-model run re-queries only the persisted panel role", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-role-resume-"));
  const first = await runReview(DEBUG_GOOD, "Reply with exactly: BASE", { cwd });
  expect(first.isOk()).toBe(true);
  if (!first.isOk()) {
    rmSync(cwd, { recursive: true, force: true });
    return;
  }

  const runId = first.value.runId;
  try {
    const manifest = readManifest(runId);
    expect(manifest).toBeDefined();
    if (!manifest) return;

    const beforeSizes = manifest.reviewers.map((reviewer) => statSync(reviewer.file).size);
    const logDir = join(cwd, ".rejudge", "logs");
    const logsBefore = new Set(readdirSync(logDir));
    const events: ProgressEvent[] = [];

    const followUp = await runReview(
      DEBUG_GOOD,
      "Before answering, call ask_panel exactly once with one query for role panel-2. Ask it to reply with exactly ROUTED. Do not query any other role. Then reply with exactly ROUTED.",
      { cwd, resumeRunId: runId, activitySink: (event) => events.push(event) },
    );
    expect(followUp.isOk()).toBe(true);

    const afterSizes = manifest.reviewers.map((reviewer) => statSync(reviewer.file).size);
    expect(afterSizes[0]).toBe(beforeSizes[0]);
    expect(afterSizes[1]).toBeGreaterThan(beforeSizes[1]);

    const reviewerStarts = events.filter(
      (event): event is Extract<ProgressEvent, { kind: "model_start" }> =>
        event.kind === "model_start" && event.role === "reviewer",
    );
    expect(reviewerStarts.map((event) => event.roleKey)).toEqual(["panel-2"]);
    expect(reviewerStarts[0]).toMatchObject({ model: STUB });

    const resumedLog = readdirSync(logDir).find((file) => !logsBefore.has(file));
    expect(resumedLog).toBeDefined();
    if (resumedLog) {
      const records = readFileSync(join(logDir, resumedLog), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const reviewerRoles = new Set(
        records
          .map((record) => record.roleKey)
          .filter((roleKey): roleKey is string => typeof roleKey === "string" && roleKey.startsWith("panel-")),
      );
      expect(reviewerRoles).toEqual(new Set(["panel-2"]));
    }
  } finally {
    rmSync(runDir(runId), { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}, 300_000);
