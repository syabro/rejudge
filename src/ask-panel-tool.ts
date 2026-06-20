import { Type } from "typebox";
import { defineTool, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { PanelAgentResult } from "./runner.ts";

/**
 * The custom `ask_panel` tool (SYN-011). It lets the synth/"judge" agent re-query one panel
 * member's LIVE session for a second round — to cross-examine a disagreement or pressure a
 * disputed finding — before it produces the fused answer. Re-prompting the SAME session keeps
 * that panel's round-1 context, so it answers the follow-up remembering what it already said.
 *
 * Delegating the deep re-verification back to the panels this way is what lets the judge be a
 * cheaper model than the panel.
 *
 * It's a factory: it closes over the live panel results so the tool can reach their sessions
 * (the SDK only hands `execute` its params/signal/ctx, never our sessions). Whether and whom to
 * re-query is the judge's call; the caller steers it through the question/output instructions.
 * Like every inner tool it returns failures as text, never throws — so the no-throw fusion
 * contract holds even if a re-query breaks.
 */

export const ASK_PANEL_TOOL_NAME = "ask_panel";

/** The only stop reason that means a clean completion; everything else is a partial/failed turn. */
const CLEAN_STOP = "stop";

/** The session's most recent assistant message, or undefined if it has none yet. */
function lastAssistant(session: AgentSession) {
  return [...session.state.messages]
    .reverse()
    .find((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");
}

export function makeAskPanelTool(panel: PanelAgentResult[]) {
  const models = panel.map((p) => p.modelId);

  const parameters = Type.Object({
    model: Type.String({
      description:
        "Which panel member to re-query, by its exact provider/model id. One of: " +
        models.join(", "),
    }),
    question: Type.String({
      description:
        "The follow-up to put to that panel — e.g. another panel's finding to react to, or a " +
        "disputed point to defend or concede. It still remembers its own earlier answer.",
    }),
  });

  return defineTool({
    name: ASK_PANEL_TOOL_NAME,
    label: "ask panel",
    description: `Re-query one panel member's session for a second round (cross-examine a disagreement or pressure a disputed point). Valid models: ${models.join(", ")}.`,
    parameters,
    async execute(_toolCallId, params, signal) {
      const fail = (t: string) => ({
        content: [{ type: "text" as const, text: t }],
        details: { model: params.model },
      });

      const target = panel.find((p) => p.modelId === params.model);
      if (!target) {
        return fail(`Unknown panel model "${params.model}". Valid panel models: ${models.join(", ")}.`);
      }

      const session: AgentSession = target.session;

      // Bridge the tool-call signal (the one the SDK hands us — the synth turn's signal, which
      // fires when the whole fusion is cancelled) to this panel session, mirroring how runner.ts
      // cancels a run: session.prompt() takes no signal of its own.
      const onAbort = () => void session.abort();
      signal?.addEventListener("abort", onAbort, { once: true });

      // Everything that touches the live session is inside this try, so ANY throw — an SDK error
      // from prompt(), or even a state access on a disposed/corrupted session — becomes a
      // tool-error VALUE. The fusion no-throw contract must hold even if a re-query breaks.
      try {
        // A session that already ended in an abort is in a terminal state — don't re-prompt it.
        if (lastAssistant(session)?.stopReason === "aborted") {
          return fail(`Panel "${params.model}" was cancelled and can't be re-queried.`);
        }

        await session.prompt(params.question);

        const last = lastAssistant(session);
        if (!last) {
          return fail(`Panel "${params.model}" produced no response.`);
        }
        if (last.stopReason !== CLEAN_STOP) {
          const detail = last.errorMessage ? `: ${last.errorMessage}` : "";
          return fail(`Panel "${params.model}" did not answer cleanly (stopReason: ${last.stopReason})${detail}.`);
        }

        const answer = session.getLastAssistantText();
        if (!answer || answer.trim() === "") {
          return fail(`Panel "${params.model}" returned empty text.`);
        }

        return {
          content: [{ type: "text" as const, text: answer }],
          details: { model: params.model, stopReason: last.stopReason },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return fail(`Re-querying "${params.model}" failed: ${msg}`);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}
