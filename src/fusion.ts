import type { FusionConfig } from "./config.ts";
import { runPanel } from "./panel.ts";
import { synthesize } from "./synth.ts";
import { PanelAgentError, type PanelAgentResult, type RunPanelAgentOptions } from "./runner.ts";
import { createDebugLog } from "./debug-log.ts";

/**
 * Why a fusion failed (PNL-017). The result stays all-or-nothing — no partial/degraded
 * answer — but a failure now says which stage broke, which model (when known), the error
 * text, and whether it was a deliberate abort rather than a model fault.
 */
export interface FusionFailure {
  /** Which stage failed. */
  stage: "panel" | "synth";
  /** The model id that broke, when the failure came from a specific inner agent. */
  model?: string;
  /** Human-readable failure reason. */
  error: string;
  /** True when the cancel signal fired — a user-initiated abort, not a model fault. */
  aborted: boolean;
}

/**
 * Fusion outcome. Success carries the single final answer; failure carries the
 * {@link FusionFailure} detail. There is no partial/degraded path: a 2-of-3 panel or
 * synthesis-on-partial never happens.
 */
export type FusionResult = { ok: true; answer: string } | { ok: false; failure: FusionFailure };

/** Build a {@link FusionFailure} from a thrown error, pulling the model id off a {@link PanelAgentError}. */
function toFailure(stage: "panel" | "synth", err: unknown, aborted: boolean): FusionFailure {
  return {
    stage,
    model: err instanceof PanelAgentError ? err.modelId : undefined,
    error: err instanceof Error ? err.message : String(err),
    aborted,
  };
}

/** One-line, human-readable rendering of a failure for CLI/tool output. */
export function formatFailure(f: FusionFailure): string {
  const where = f.model ? `${f.stage} (${f.model})` : f.stage;
  return f.aborted ? `${where} aborted` : `${where} failed: ${f.error}`;
}

/**
 * Run the full fusion — panel fan-out, then one synthesis call — all-or-nothing.
 *
 * Returns `{ ok: true, answer }` only when all panels AND synthesis complete
 * without a technical (model/tool/runtime) error. Any technical failure yields
 * `{ ok: false }` with no answer text; synthesis is never attempted on a partial
 * panel. "Success" is technical completion, not answer quality.
 */
export async function fuse(
  config: FusionConfig,
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<FusionResult> {
  // One per-run debug log shared by every agent (when config.debugLog is on). It rides
  // through `options`; runPanelAgent attaches each agent to it. createDebugLog never
  // throws — a logging failure must not break the run.
  const debugLog = config.debugLog ? createDebugLog(options.cwd ?? process.cwd()) : undefined;

  let panel: PanelAgentResult[];
  try {
    // runPanel is itself all-or-nothing: it throws (and cleans up its own
    // sessions) unless every panel agent completes — so we never synthesize on a
    // partial panel. The config's per-stage thinking level wins over anything a
    // caller passed in `options` (it's spread first, then overridden).
    panel = await runPanel(config.panel, prompt, {
      ...options,
      debugLog,
      thinkingLevel: config.thinking.panel,
    });
  } catch (err) {
    return { ok: false, failure: toFailure("panel", err, Boolean(options.signal?.aborted)) };
  }

  try {
    // synthesize owns its synth session; it only reads the panel outputs (text),
    // never the panel sessions. Synthesis runs at its own configured level.
    const answer = await synthesize(config.synth, prompt, panel, {
      ...options,
      debugLog,
      thinkingLevel: config.thinking.synth,
    });
    return { ok: true, answer };
  } catch (err) {
    return { ok: false, failure: toFailure("synth", err, Boolean(options.signal?.aborted)) };
  } finally {
    // Single-shot fusion owns the panel lifecycle and disposes once synthesis has
    // consumed the outputs. SYN-011 (multi-round judge re-query) is the task that
    // needs the panels alive across rounds — it moves this disposal out.
    for (const r of panel) r.session.dispose();
  }
}
