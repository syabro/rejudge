import { Result } from "neverthrow";
import type { ModelSpec } from "./config.ts";
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
 *
 * Each {@link ModelSpec} carries its own reasoning level (CFG-030), so an agent runs at its
 * model's `level` — the panel need not be uniform.
 */
export async function runPanel(
  models: ModelSpec[],
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<Result<PanelAgentResult[], AgentFailure>> {
  // runPanelAgent never throws (it returns a Result), so plain Promise.all is safe:
  // every agent runs to completion and we get one Result each. When the caller persists the run
  // (SYN-029) it passes one disk-backed session manager per model in `sessionManagers`; we hand
  // each agent its own by index (absent → each agent defaults to an in-memory session). The
  // per-model reasoning level rides in each spec and overrides any options.thinkingLevel.
  const managers = options.sessionManagers;
  const results = await Promise.all(
    models.map((m, i) =>
      runPanelAgent(m.id, prompt, { ...options, thinkingLevel: m.level, sessionManager: managers?.[i] }),
    ),
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
