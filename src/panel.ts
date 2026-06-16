import {
  runPanelAgent,
  type PanelAgentResult,
  type RunPanelAgentOptions,
} from "./runner.ts";

/**
 * Fan the identical prompt out to the whole panel and collect one finished
 * result per model.
 *
 * Every agent receives the byte-identical `prompt` — diversity comes only from
 * the model and the tool-use path it takes, never from the input. Agents run
 * concurrently; on success this returns one {@link PanelAgentResult} per model
 * in input order, each with its session left alive for a later synthesis/judge
 * step (the caller disposes them).
 *
 * Failure is loud, never a silent partial panel: if any agent fails (malformed
 * model id, model/tool/runtime error, incomplete run, or empty output), the
 * agents that did finish are disposed and the first error is surfaced.
 */
export async function runPanel(
  models: string[],
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<PanelAgentResult[]> {
  // allSettled (not Promise.all) so every agent finishes before we return: a
  // fast rejection under Promise.all would leave the still-running agents'
  // sessions un-disposed. Here we can deterministically clean up every success.
  const settled = await Promise.allSettled(
    models.map((modelId) => runPanelAgent(modelId, prompt, options)),
  );

  const ok: PanelAgentResult[] = [];
  const errors: unknown[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") ok.push(s.value);
    else errors.push(s.reason);
  }

  if (errors.length > 0) {
    for (const r of ok) r.session.dispose();
    const first = errors[0];
    throw first instanceof Error ? first : new Error(String(first));
  }

  return ok;
}
