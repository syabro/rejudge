import { err, ok, type Result } from "neverthrow";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { FusionConfig } from "./config.ts";
import { runPanel } from "./panel.ts";
import { synthesize } from "./synth.ts";
import { makeAskPanelTool } from "./ask-panel-tool.ts";
import {
  createInnerSession,
  runPanelAgent,
  type AgentFailure,
  type PanelAgentResult,
  type RunPanelAgentOptions,
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
 * Why a fusion failed (PNL-017). The result stays all-or-nothing — no partial/degraded
 * answer — but a failure says which stage broke, which model, the error text, and whether
 * it was a deliberate abort rather than a model fault.
 */
export interface FusionFailure {
  /** Which stage failed. `resume` covers SYN-029 setup errors (run not found, cwd mismatch). */
  stage: "panel" | "synth" | "resume";
  /** The "provider/model" id that broke (or the runId for a `resume` failure). */
  model: string;
  /** Human-readable failure reason. */
  error: string;
  /** True when the cancel signal fired — a user-initiated abort, not a model fault. */
  aborted: boolean;
}

/** A successful fusion: the single final text plus the run's id (for a later follow-up, SYN-029). */
export interface FusionSuccess {
  answer: string;
  /** The id of this run — pass it back as {@link FuseOptions.resumeRunId} to follow up. */
  runId: string;
}

/**
 * Fusion outcome (neverthrow {@link Result}). `ok({answer, runId})` is the single final text and
 * the run id; `err(failure)` carries the {@link FusionFailure}. There is no partial/degraded path.
 */
export type FusionResult = Result<FusionSuccess, FusionFailure>;

/** Options for {@link fuse}: the per-agent options plus the fuse-level resume handle. */
export type FuseOptions = RunPanelAgentOptions & {
  /** Resume a prior persisted run instead of starting fresh (SYN-029): the `prompt` is the
   *  follow-up, sent to that run's restored synth session (which can re-query its panels). */
  resumeRunId?: string;
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Widen an {@link AgentFailure} (model + error) to a {@link FusionFailure} with the stage and abort flag. */
function toFusionFailure(
  stage: "panel" | "synth",
  failure: AgentFailure,
  aborted: boolean,
): FusionFailure {
  return { stage, model: failure.model, error: failure.error, aborted };
}

/** A resume setup failure (run not found, cwd mismatch, missing files) — never an abort/model fault. */
function resumeFailure(runId: string, error: string): FusionFailure {
  return { stage: "resume", model: runId, error, aborted: false };
}

/** One-line, human-readable rendering of a failure for CLI/tool output. */
export function formatFailure(f: FusionFailure): string {
  const where = `${f.stage} (${f.model})`;
  return f.aborted ? `${where} aborted` : `${where} failed: ${f.error}`;
}

/**
 * Run the full fusion — panel fan-out, then one synthesis call — all-or-nothing.
 *
 * Returns `ok({answer, runId})` only when all panels AND synthesis complete without a technical
 * error; any failure yields `err(failure)` naming the stage/model. With `resumeRunId` set it
 * resumes a prior run instead (SYN-029). "Success" is technical completion, not answer quality.
 */
export async function fuse(
  config: FusionConfig,
  prompt: string,
  options: FuseOptions = {},
): Promise<FusionResult> {
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
 * A fresh run: gc expired runs, fan out to the panel, then synthesize — persisting every session
 * to its own temp dir so the run can be resumed later (SYN-029). The manifest is written LAST, as
 * the commit marker; a failed run leaves no manifest and is reaped by {@link gcExpired} by age.
 */
async function freshRun(
  config: FusionConfig,
  prompt: string,
  options: FuseOptions,
): Promise<FusionResult> {
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
  const panelManagers = config.panel.map(() => SessionManager.create(cwd, dir));
  const synthManager = SessionManager.create(cwd, dir);

  const panel = await runPanel(config.panel, prompt, {
    ...options,
    cwd,
    debugLog,
    role: "panel",
    sessionManagers: panelManagers,
  });
  if (panel.isErr()) {
    return err(toFusionFailure("panel", panel.error, aborted()));
  }
  const panelEnd = Date.now();
  sink?.({ kind: "stage_end", t: panelEnd, stage: "panel", durationMs: panelEnd - runStart });

  // SYN-011: the judge can re-query a live panel via ask_panel before fusing.
  const askPanel = makeAskPanelTool(panel.value);

  const synthStart = Date.now();
  try {
    const synth = await synthesize(config.synth.id, panel.value, askPanel, {
      ...options,
      cwd,
      debugLog,
      role: "synth",
      thinkingLevel: config.synth.level,
      sessionManager: synthManager,
    });
    if (synth.isErr()) {
      return err(toFusionFailure("synth", synth.error, aborted()));
    }
    const synthEnd = Date.now();
    sink?.({ kind: "stage_end", t: synthEnd, stage: "synth", durationMs: synthEnd - synthStart });

    // Run complete → write the manifest (the commit marker) so this run is resumable.
    writeManifest({
      version: 2,
      runId,
      cwd,
      createdAt: new Date().toISOString(),
      fullTools: Boolean(options.fullTools),
      panel: config.panel.map((m, i) => ({
        modelId: m.id,
        level: m.level,
        file: panelManagers[i].getSessionFile() ?? "",
      })),
      synth: { modelId: config.synth.id, level: config.synth.level, file: synthManager.getSessionFile() ?? "" },
    });
    return ok({ answer: synth.value, runId });
  } finally {
    // The panel sessions stay alive THROUGH synthesis (ask_panel) and are disposed here, once.
    // Disposal is memory-only — the persisted JSONL on disk survives for a later resume.
    for (const r of panel.value) r.session.dispose();
  }
}

/**
 * Resume a prior run (SYN-029): reopen its panel sessions (live, NOT re-prompted) so the judge
 * can re-query them, reopen its synth session, and prompt that synth with the raw follow-up — its
 * history already holds round 1, so we deliberately do NOT rebuild a synthesis prompt (that would
 * duplicate the panel outputs). The reopened managers keep appending, so a further follow-up
 * resumes the extended context.
 */
async function resumeRun(
  config: FusionConfig,
  prompt: string,
  runId: string,
  options: FuseOptions,
): Promise<FusionResult> {
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
  const files = [manifest.synth.file, ...manifest.panel.map((p) => p.file)];
  if (files.some((f) => !f || !existsSync(f))) {
    return err(resumeFailure(runId, "session files missing (expired or partially cleaned)"));
  }

  const debugLog = config.debugLog ? createDebugLog(cwd, sink) : undefined;
  const aborted = (): boolean => Boolean(options.signal?.aborted);

  // Reopen panel sessions — live but unprompted — so ask_panel can re-query them. Restored with
  // the SAME tool policy the run used (manifest.fullTools); resume never widens it.
  const panel: PanelAgentResult[] = [];
  try {
    for (const ref of manifest.panel) {
      const session = await createInnerSession(ref.modelId, {
        cwd,
        fullTools: manifest.fullTools,
        thinkingLevel: ref.level,
        sessionManager: SessionManager.open(ref.file),
      });
      // SessionManager.open on an empty/corrupt file silently starts a fresh, contextless session
      // (zero messages). Reject that — a resume with no restored context is a wrong answer, not OK.
      if (session.state.messages.length === 0) {
        session.dispose();
        throw new Error(`panel "${ref.modelId}" session is empty`);
      }
      panel.push({ modelId: ref.modelId, text: session.getLastAssistantText() ?? "", session });
    }
  } catch (e) {
    for (const r of panel) r.session.dispose();
    return err(resumeFailure(runId, `could not reopen panel sessions: ${message(e)}`));
  }

  const askPanel = makeAskPanelTool(panel);
  const synthStart = Date.now();
  try {
    // Reopen the synth session as the judge (role "synth" → ask_panel is its only tool), then prompt
    // it with the raw follow-up.
    let synthSession: AgentSession;
    try {
      synthSession = await createInnerSession(manifest.synth.modelId, {
        cwd,
        role: "synth",
        thinkingLevel: manifest.synth.level,
        askPanel,
        sessionManager: SessionManager.open(manifest.synth.file),
      });
    } catch (e) {
      return err(resumeFailure(runId, `could not reopen synth session: ${message(e)}`));
    }
    if (synthSession.state.messages.length === 0) {
      synthSession.dispose();
      return err(resumeFailure(runId, "synth session is empty (corrupt or wiped)"));
    }

    // runPanelAgent prompts the supplied session (it attaches the activity/debug logs and the
    // abort bridge, emits model_start/model_end). On failure it disposes the session itself.
    const synth = await runPanelAgent(manifest.synth.modelId, prompt, {
      ...options,
      cwd,
      debugLog,
      role: "synth",
      thinkingLevel: manifest.synth.level,
      existingSession: synthSession,
    });
    if (synth.isErr()) {
      return err(toFusionFailure("synth", synth.error, aborted()));
    }
    const synthEnd = Date.now();
    sink?.({ kind: "stage_end", t: synthEnd, stage: "synth", durationMs: synthEnd - synthStart });
    synth.value.session.dispose();
    return ok({ answer: synth.value.text, runId });
  } finally {
    for (const r of panel) r.session.dispose();
  }
}
