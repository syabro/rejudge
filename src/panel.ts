import { err, Result } from "neverthrow";
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
  // runPanelAgent never throws (it returns a Result), so Promise.all is safe. The panel still
  // owns its own abort controller: the caller's signal cancels the whole panel, and the first
  // agent failure also cancels every sibling through the same signal.
  const managers = options.sessionManagers;

  // Testing-only (CLI `--prompt-add-N`): a per-panel suffix appended to that one agent's prompt to
  // force divergence. Unset/empty → the byte-identical prompt, so a normal run is unaffected.
  const adds = options.promptAdds;

  const controller = new AbortController();
  const callerSignal = options.signal;
  const abortFromCaller = (): void => {
    controller.abort(callerSignal?.reason);
  };
  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason);
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  let firstFailure: AgentFailure | undefined;
  try {
    const results = await Promise.all(
      models.map(async (m, i) => {
        const add = adds?.[i];
        const agentPrompt = add ? `${prompt}\n\n${add}` : prompt;
        const result = await runPanelAgent(m.id, agentPrompt, {
          ...options,
          signal: controller.signal,
          thinkingLevel: m.level,
          sessionManager: managers?.[i],
        });

        if (result.isErr() && !firstFailure) {
          firstFailure = result.error;
          controller.abort();
        }
        return result;
      }),
    );

    // On any failure, dispose the sessions that DID succeed so nothing leaks. Failed/aborted
    // agents dispose themselves in runPanelAgent.
    if (firstFailure) {
      for (const r of results) {
        if (r.isErr()) continue;
        r.value.session.dispose();
      }
      return err(firstFailure);
    }

    return Result.combine(results);
  } finally {
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
