import type { FusionConfig } from "./config.ts";
import { runPanel } from "./panel.ts";
import { synthesize } from "./synth.ts";
import type { PanelAgentResult, RunPanelAgentOptions } from "./runner.ts";
import { createDebugLog } from "./debug-log.ts";

/**
 * Binary fusion outcome. Success carries the single final answer; failure carries
 * nothing — which stage failed is deliberately not reported (deferred). There is
 * no partial/degraded path: a 2-of-3 panel or synthesis-on-partial never happens.
 */
export type FusionResult = { ok: true; answer: string } | { ok: false };

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
  } catch {
    return { ok: false };
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
  } catch {
    return { ok: false };
  } finally {
    // Single-shot fusion owns the panel lifecycle and disposes once synthesis has
    // consumed the outputs. SYN-011 (multi-round judge re-query) is the task that
    // needs the panels alive across rounds — it moves this disposal out.
    for (const r of panel) r.session.dispose();
  }
}
