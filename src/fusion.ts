import type { FusionConfig } from "./config.ts";
import { runPanel } from "./panel.ts";
import {
  runPanelAgent,
  type PanelAgentResult,
  type RunPanelAgentOptions,
} from "./runner.ts";

/**
 * Binary fusion outcome. Success carries the single final answer; failure carries
 * nothing — which stage failed is deliberately not reported (deferred). There is
 * no partial/degraded path: a 2-of-3 panel or synthesis-on-partial never happens.
 */
export type FusionResult = { ok: true; answer: string } | { ok: false };

/**
 * Deliberately minimal synthesis prompt: just enough to combine the panel outputs
 * into one answer so the all-or-nothing contract can run end to end. This is the
 * seam SYN-010 replaces with the real synthesis (threading the original output
 * instructions, preserving the requested format, surfacing only final text).
 */
function buildSynthesisPrompt(prompt: string, panel: PanelAgentResult[]): string {
  const answers = panel.map((p, i) => `### Answer ${i + 1}\n${p.text}`).join("\n\n");
  return [
    "You are given several independent answers to the same question.",
    "Combine them into a single best final answer.",
    "",
    "## Question",
    prompt,
    "",
    "## Answers",
    answers,
  ].join("\n");
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
  let panel: PanelAgentResult[];
  try {
    // runPanel is itself all-or-nothing: it throws (and cleans up its own
    // sessions) unless every panel agent completes — so we never synthesize on a
    // partial panel.
    panel = await runPanel(config.panel, prompt, options);
  } catch {
    return { ok: false };
  }

  try {
    const synth = await runPanelAgent(config.synth, buildSynthesisPrompt(prompt, panel), options);
    const answer = synth.text;
    synth.session.dispose();
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
