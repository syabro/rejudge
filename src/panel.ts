import { Result } from "neverthrow";
import {
  runPanelAgent,
  type AgentFailure,
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
 * All-or-nothing, never a silent partial panel: if any agent fails (malformed model
 * id, model/tool/runtime error, incomplete run, empty output, or a cancel), the agents
 * that did finish are disposed and the first failure is returned as `err`.
 */
export async function runPanel(
  models: string[],
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<Result<PanelAgentResult[], AgentFailure>> {
  // runPanelAgent never throws (it returns a Result), so plain Promise.all is safe:
  // every agent runs to completion and we get one Result each.
  const results = await Promise.all(
    models.map((modelId) => runPanelAgent(modelId, prompt, options)),
  );

  // combine → ok([all results]) when every agent succeeded, else the first err.
  const combined = Result.combine(results);

  // On any failure, dispose the sessions that DID succeed so nothing leaks.
  if (combined.isErr()) {
    for (const r of results) {
      if (r.isErr()) continue;
      r.value.session.dispose();
    }
  }

  return combined;
}
