import { err, ok, type Result } from "neverthrow";
import type { FusionConfig } from "./config.ts";
import { runPanel } from "./panel.ts";
import { synthesize } from "./synth.ts";
import type { AgentFailure, RunPanelAgentOptions } from "./runner.ts";
import type { RunStatus } from "./events.ts";
import { createDebugLog } from "./debug-log.ts";

/**
 * Why a fusion failed (PNL-017). The result stays all-or-nothing — no partial/degraded
 * answer — but a failure says which stage broke, which model, the error text, and whether
 * it was a deliberate abort rather than a model fault.
 */
export interface FusionFailure {
  /** Which stage failed. */
  stage: "panel" | "synth";
  /** The "provider/model" id that broke. */
  model: string;
  /** Human-readable failure reason. */
  error: string;
  /** True when the cancel signal fired — a user-initiated abort, not a model fault. */
  aborted: boolean;
}

/**
 * Fusion outcome (neverthrow {@link Result}). `ok(answer)` is the single final text;
 * `err(failure)` carries the {@link FusionFailure}. There is no partial/degraded path: a
 * partial panel or synthesis-on-partial never happens.
 */
export type FusionResult = Result<string, FusionFailure>;

/** Widen an {@link AgentFailure} (model + error) to a {@link FusionFailure} with the stage and abort flag. */
function toFusionFailure(
  stage: "panel" | "synth",
  failure: AgentFailure,
  aborted: boolean,
): FusionFailure {
  return { stage, model: failure.model, error: failure.error, aborted };
}

/** One-line, human-readable rendering of a failure for CLI/tool output. */
export function formatFailure(f: FusionFailure): string {
  const where = `${f.stage} (${f.model})`;
  return f.aborted ? `${where} aborted` : `${where} failed: ${f.error}`;
}

/**
 * Run the full fusion — panel fan-out, then one synthesis call — all-or-nothing.
 *
 * Returns `ok(answer)` only when all panels AND synthesis complete without a technical
 * (model/tool/runtime) error. Any failure yields `err(failure)` naming the stage/model;
 * synthesis is never attempted on a partial panel. "Success" is technical completion, not
 * answer quality.
 */
export async function fuse(
  config: FusionConfig,
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<FusionResult> {
  const sink = options.activitySink;
  const runStart = Date.now();

  // One per-run debug log shared by every agent (when config.debugLog is on). It rides
  // through `options`; runPanelAgent attaches each agent to it. createDebugLog never
  // throws — a logging failure must not break the run. Its notices ride the same sink as
  // diagnostic events (never raw stderr), so they don't corrupt a host Pi's output.
  const debugLog = config.debugLog ? createDebugLog(options.cwd ?? process.cwd(), sink) : undefined;
  // Whether the cancel signal fired — distinguishes a user abort from a model fault.
  const aborted = (): boolean => Boolean(options.signal?.aborted);

  // Recorded on whichever path we exit by, then emitted once as the total event below.
  let status: RunStatus = "error";
  try {
    // runPanel is all-or-nothing: it returns err (and cleans up its own sessions) unless
    // every panel agent completes — so we never synthesize on a partial panel. The config's
    // per-stage thinking level wins over anything a caller passed (spread first, then set).
    const panel = await runPanel(config.panel, prompt, {
      ...options,
      debugLog,
      role: "panel",
      thinkingLevel: config.thinking.panel,
    });
    if (panel.isErr()) {
      status = aborted() ? "cancelled" : "error";
      return err(toFusionFailure("panel", panel.error, aborted()));
    }
    const panelEnd = Date.now();
    sink?.({ kind: "stage_end", t: panelEnd, stage: "panel", durationMs: panelEnd - runStart });

    const synthStart = Date.now();
    try {
      // synthesize owns its synth session; it only reads the panel outputs (text), never
      // the panel sessions. Synthesis runs at its own configured level.
      const synth = await synthesize(config.synth, prompt, panel.value, {
        ...options,
        debugLog,
        role: "synth",
        thinkingLevel: config.thinking.synth,
      });
      if (synth.isErr()) {
        status = aborted() ? "cancelled" : "error";
        return err(toFusionFailure("synth", synth.error, aborted()));
      }
      const synthEnd = Date.now();
      sink?.({ kind: "stage_end", t: synthEnd, stage: "synth", durationMs: synthEnd - synthStart });
      status = "done";
      return ok(synth.value);
    } finally {
      // Single-shot fusion owns the panel lifecycle and disposes once synthesis has
      // consumed the outputs. SYN-011 (multi-round judge re-query) is the task that
      // needs the panels alive across rounds — it moves this disposal out.
      for (const r of panel.value) r.session.dispose();
    }
  } finally {
    if (sink) {
      const t = Date.now();
      sink({ kind: "total", t, durationMs: t - runStart, status });
    }
  }
}
