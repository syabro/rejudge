import { err, ok, type Result } from "neverthrow";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { RejudgeConfig } from "./config.ts";
import { runPanel } from "./panel.ts";
import { runJudge } from "./judge.ts";
import { makeAskPanelTool } from "./ask-panel-tool.ts";
import {
  createInnerSession,
  runReviewer,
  type AgentFailure,
  type ReviewerResult,
  type RunReviewerOptions,
} from "./runner.ts";
import type { RunStatus } from "./events.ts";
import { createDebugLog } from "./debug-log.ts";
import {
  gcExpired,
  newRunId,
  readManifest,
  runDir,
  writeManifest,
  type RunManifest,
} from "./run-store.ts";

/**
 * Why a review run failed. The result stays all-or-nothing, but a failure says which stage
 * broke, which model, the error text, and whether it was a deliberate abort.
 */
export interface ReviewFailure {
  /** Which stage failed. `resume` covers setup errors such as a missing run or cwd mismatch. */
  stage: "panel" | "judge" | "resume";
  /** The "provider/model" id that broke (or the runId for a `resume` failure). */
  model: string;
  /** Human-readable failure reason. */
  error: string;
  /** True when the cancel signal fired — a user-initiated abort, not a model fault. */
  aborted: boolean;
}

/** A successful review: one final answer plus the run id for a later follow-up. */
export interface ReviewSuccess {
  answer: string;
  /** The id of this run — pass it back as {@link ReviewOptions.resumeRunId} to follow up. */
  runId: string;
}

/** All-or-nothing review outcome. There is no partial/degraded path. */
export type ReviewResult = Result<ReviewSuccess, ReviewFailure>;

/** Options for {@link runReview}, including the persisted-run resume handle. */
export type ReviewOptions = RunReviewerOptions & {
  /** Resume a prior run instead of starting fresh; `prompt` is the follow-up for its judge. */
  resumeRunId?: string;
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Add stage and abort context to one inner-agent failure. */
function toReviewFailure(
  stage: "panel" | "judge",
  failure: AgentFailure,
  aborted: boolean,
): ReviewFailure {
  return { stage, model: failure.model, error: failure.error, aborted };
}

/** A resume setup failure (run not found, cwd mismatch, missing files) — never an abort/model fault. */
function resumeFailure(runId: string, error: string): ReviewFailure {
  return { stage: "resume", model: runId, error, aborted: false };
}

/** One-line, human-readable rendering of a failure for CLI/tool output. */
export function formatFailure(f: ReviewFailure): string {
  const where = `${f.stage} (${f.model})`;
  return f.aborted ? `${where} aborted` : `${where} failed: ${f.error}`;
}

/**
 * Run a full review — reviewer fan-out, then the judge — all-or-nothing.
 *
 * Returns `ok({answer, runId})` only when the whole panel and judge complete without a technical
 * error. With `resumeRunId` set it resumes a prior run. Success means technical completion,
 * not answer quality.
 */
export async function runReview(
  config: RejudgeConfig,
  prompt: string,
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const sink = options.activitySink;
  const runStart = Date.now();

  // Recorded on whichever path we exit by, then emitted once as the total event below.
  let status: RunStatus = "error";
  try {
    const result = options.resumeRunId
      ? await resumeRun(config, prompt, options.resumeRunId, options)
      : await freshRun(config, prompt, options);
    status = result.isOk() ? "done" : options.signal?.aborted ? "cancelled" : "error";
    return result;
  } finally {
    if (sink) {
      const t = Date.now();
      sink({ kind: "total", t, durationMs: t - runStart, status });
    }
  }
}

/**
 * A fresh run: collect the panel, then run the judge, persisting every session
 * to its own temp dir so the run can be resumed later (SYN-029). The manifest is written LAST, as
 * the commit marker; a failed run leaves no manifest and is reaped by {@link gcExpired} by age.
 */
async function freshRun(
  config: RejudgeConfig,
  prompt: string,
  options: ReviewOptions,
): Promise<ReviewResult> {
  const sink = options.activitySink;
  const runStart = Date.now();
  const cwd = resolve(options.cwd ?? process.cwd());
  const aborted = (): boolean => Boolean(options.signal?.aborted);

  // One per-run debug log shared by every agent (when config.debugLog is on). Best-effort —
  // createDebugLog never throws; its notices ride the sink as diagnostics, not raw stderr.
  const debugLog = config.debugLog ? createDebugLog(cwd, sink) : undefined;

  // Reap runs past the TTL before adding one, then persist this run to its own temp dir. The SDK
  // writes each session's JSONL into `dir`; we read each file path back for the manifest.
  gcExpired(Date.now());
  const runId = newRunId();
  const dir = runDir(runId);
  const reviewerManagers = config.reviewers.map(() => SessionManager.create(cwd, dir));
  const judgeManager = SessionManager.create(cwd, dir);

  const panel = await runPanel(config.reviewers, prompt, {
    ...options,
    cwd,
    debugLog,
    role: "reviewer",
    sessionManagers: reviewerManagers,
  });
  if (panel.isErr()) {
    return err(toReviewFailure("panel", panel.error, aborted()));
  }
  const panelEnd = Date.now();
  sink?.({ kind: "stage_end", t: panelEnd, stage: "panel", durationMs: panelEnd - runStart });

  // SYN-011: the judge can re-query a live panel via ask_panel before fusing.
  const askPanel = makeAskPanelTool(panel.value, sink);

  const judgeStart = Date.now();
  try {
    const judge = await runJudge(config.judge.id, panel.value, askPanel, {
      ...options,
      cwd,
      debugLog,
      role: "judge",
      thinkingLevel: config.judge.level,
      sessionManager: judgeManager,
    });
    if (judge.isErr()) {
      return err(toReviewFailure("judge", judge.error, aborted()));
    }
    const judgeEnd = Date.now();
    sink?.({ kind: "stage_end", t: judgeEnd, stage: "judge", durationMs: judgeEnd - judgeStart });

    // Run complete → write the manifest (the commit marker) so this run is resumable.
    writeManifest({
      version: 3,
      runId,
      cwd,
      createdAt: new Date().toISOString(),
      fullTools: Boolean(options.fullTools),
      reviewers: config.reviewers.map((model, i) => ({
        modelId: model.id,
        level: model.level,
        file: reviewerManagers[i].getSessionFile() ?? "",
      })),
      judge: { modelId: config.judge.id, level: config.judge.level, file: judgeManager.getSessionFile() ?? "" },
    });
    return ok({ answer: judge.value, runId });
  } finally {
    // The reviewer sessions stay alive through the judge step (ask_panel) and are disposed here.
    // Disposal is memory-only — the persisted JSONL on disk survives for a later resume.
    for (const r of panel.value) r.session.dispose();
  }
}

/**
 * Resume a prior run: reopen its reviewer sessions (live, not re-prompted) so the judge can
 * re-query them, then prompt the restored judge with the raw follow-up. Its history already holds
 * round 1, so we deliberately do not rebuild the judge prompt (which would duplicate the reviewer
 * outputs). The reopened managers keep appending, so a further follow-up
 * resumes the extended context.
 */
async function resumeRun(
  config: RejudgeConfig,
  prompt: string,
  runId: string,
  options: ReviewOptions,
): Promise<ReviewResult> {
  const sink = options.activitySink;
  const cwd = resolve(options.cwd ?? process.cwd());

  const manifest = readManifest(runId);
  if (!manifest) {
    return err(resumeFailure(runId, "run not found or expired"));
  }
  if (resolve(manifest.cwd) !== cwd) {
    return err(resumeFailure(runId, `run belongs to a different project (${manifest.cwd})`));
  }
  // Every session file must still exist — SessionManager.open on a missing file silently creates
  // an EMPTY session, which would answer with no context. Fail loudly instead.
  const files = [manifest.judge.file, ...manifest.reviewers.map((reviewer) => reviewer.file)];
  if (files.some((f) => !f || !existsSync(f))) {
    return err(resumeFailure(runId, "session files missing (expired or partially cleaned)"));
  }

  const debugLog = config.debugLog ? createDebugLog(cwd, sink) : undefined;
  const aborted = (): boolean => Boolean(options.signal?.aborted);

  // Reopen reviewer sessions — live but unprompted — so ask_panel can re-query them. Restore the
  // same tool policy the run used; resume never widens it.
  const panel: ReviewerResult[] = [];
  try {
    for (const ref of manifest.reviewers) {
      const session = await createInnerSession(ref.modelId, {
        cwd,
        role: "reviewer",
        fullTools: manifest.fullTools,
        thinkingLevel: ref.level,
        sessionManager: SessionManager.open(ref.file),
      });
      // SessionManager.open on an empty/corrupt file silently starts a fresh, contextless session.
      if (session.state.messages.length === 0) {
        session.dispose();
        throw new Error(`reviewer "${ref.modelId}" session is empty`);
      }
      panel.push({ modelId: ref.modelId, text: session.getLastAssistantText() ?? "", session });
    }
  } catch (e) {
    for (const reviewer of panel) reviewer.session.dispose();
    return err(resumeFailure(runId, `could not reopen reviewer sessions: ${message(e)}`));
  }

  const askPanel = makeAskPanelTool(panel, sink);
  const judgeStart = Date.now();
  try {
    let judgeSession: AgentSession;
    try {
      judgeSession = await createInnerSession(manifest.judge.modelId, {
        cwd,
        role: "judge",
        thinkingLevel: manifest.judge.level,
        askPanel,
        sessionManager: SessionManager.open(manifest.judge.file),
      });
    } catch (e) {
      return err(resumeFailure(runId, `could not reopen judge session: ${message(e)}`));
    }
    if (judgeSession.state.messages.length === 0) {
      judgeSession.dispose();
      return err(resumeFailure(runId, "judge session is empty (corrupt or wiped)"));
    }

    // runReviewer prompts the restored judge session and emits its normal lifecycle events.
    const judge = await runReviewer(manifest.judge.modelId, prompt, {
      ...options,
      cwd,
      debugLog,
      role: "judge",
      thinkingLevel: manifest.judge.level,
      existingSession: judgeSession,
    });
    if (judge.isErr()) {
      return err(toReviewFailure("judge", judge.error, aborted()));
    }
    const judgeEnd = Date.now();
    sink?.({ kind: "stage_end", t: judgeEnd, stage: "judge", durationMs: judgeEnd - judgeStart });
    judge.value.session.dispose();
    return ok({ answer: judge.value.text, runId });
  } finally {
    for (const reviewer of panel) reviewer.session.dispose();
  }
}
