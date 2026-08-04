import { Type } from "typebox";
import { defineTool, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { DebugLog } from "./debug-log.ts";
import type { ActivitySink } from "./events.ts";
import { rerunAgent, type AgentResult } from "./runner.ts";

/**
 * The custom `ask_panel` tool lets the judge re-query the live sessions of one or more reviewers
 * for a second round — to cross-examine a disagreement
 * or pressure a disputed finding — before it produces the final answer. Re-prompting the SAME
 * session keeps that author's round-1 context, so it answers the follow-up remembering what it
 * already said.
 *
 * A single call takes a batch of `{ role, question }` queries. Different reviewers run in parallel;
 * repeated queries to one reviewer run sequentially in input order because one live session cannot
 * process concurrent prompts. Stable role keys keep duplicate model choices distinct.
 * Delegating the deep re-verification back to the authors
 * this way is what lets the judge be a cheaper model than the panel.
 *
 * It's a factory: it closes over the live reviewer results so the tool can reach their sessions (the
 * SDK only hands `execute` its params/signal/ctx, never our sessions). Whether and whom to re-query
 * is the judge's call; the caller steers it through the question/output instructions. Like every
 * inner tool it returns failures as text, never throws — so the no-throw review contract holds even
 * if a re-query breaks.
 */

export const ASK_PANEL_TOOL_NAME = "ask_panel";

/** The session's most recent assistant message, or undefined if it has none yet. */
function lastAssistant(session: AgentSession) {
  return [...session.state.messages]
    .reverse()
    .find((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");
}

export function makeAskPanelTool(
  panel: AgentResult[],
  activitySink?: ActivitySink,
  debugLog?: DebugLog,
) {
  const roles = panel.map((reviewer) => reviewer.roleKey);

  /**
   * Re-query one author's live session. Returns its answer (or the reason it couldn't answer),
   * labelled with its role key and model id so a batch result stays attributable. Never throws: any SDK error
   * or state access on a disposed/corrupted session becomes the labelled error text, so the
   * no-throw fusion contract holds and one bad author never sinks the others in the batch.
   */
  async function runOne(roleKey: string, question: string, signal?: AbortSignal): Promise<string> {
    const target = panel.find((reviewer) => reviewer.roleKey === roleKey);
    const label = (text: string): string =>
      `### ${target ? `${target.roleKey} (${target.modelId})` : roleKey}\n${text}`;
    if (!target) {
      return label(`Unknown reviewer role "${roleKey}". Valid roles: ${roles.join(", ")}.`);
    }

    const subject = `${target.roleKey} (${target.modelId})`;
    const session: AgentSession = target.session;

    // A session that already ended in an abort is terminal — don't re-prompt it. This is a
    // pre-flight refusal, not a re-query run, so it intentionally emits no lifecycle events.
    if (lastAssistant(session)?.stopReason === "aborted") {
      return label(`"${subject}" was cancelled and can't be re-queried.`);
    }

    if (signal?.aborted) {
      return label(`"${subject}" was cancelled and can't be re-queried.`);
    }

    const result = await rerunAgent(target, question, { signal, activitySink, debugLog });
    if (result.isErr()) {
      return label(`Re-querying "${subject}" failed: ${result.error.error}`);
    }
    return label(result.value.text);
  }

  const parameters = Type.Object({
    queries: Type.Array(
      Type.Object({
        role: Type.String({
          description: "Which reviewer to re-query, by stable role key. One of: " + roles.join(", "),
        }),
        question: Type.String({
          description:
            "The follow-up for that author — e.g. another author's point to react to, or a disputed " +
            "claim to defend or concede. It still remembers its own earlier analysis.",
        }),
      }),
      {
        minItems: 1,
        description:
          "Every follow-up to ask. Send all reviewers in a SINGLE call. Different reviewers run in " +
          "parallel; repeated queries to one reviewer run sequentially in input order.",
      },
    ),
  });

  return defineTool({
    name: ASK_PANEL_TOOL_NAME,
    label: "ask panel",
    description:
      "Re-query one or more analyses' authors for a second round (cross-examine a disagreement or " +
      "pressure a disputed point). Pass every follow-up in one call. Different authors run in parallel; " +
      `repeated queries to one author run sequentially. Valid roles: ${roles.join(", ")}.`,
    parameters,
    async execute(_toolCallId, params, signal) {
      // runOne never throws, so Promise.all never rejects; the outer guard is belt-and-suspenders so
      // even a synchronous mishap becomes tool-error text, never a throw out of the fusion chain.
      try {
        const answers = new Array<string>(params.queries.length);
        const queriesByRole = new Map<string, { index: number; question: string }[]>();
        params.queries.forEach((query, index) => {
          const queued = queriesByRole.get(query.role);
          if (queued) {
            queued.push({ index, question: query.question });
          } else {
            queriesByRole.set(query.role, [{ index, question: query.question }]);
          }
        });

        await Promise.all([...queriesByRole.entries()].map(async ([role, queries]) => {
          for (const query of queries) {
            answers[query.index] = await runOne(role, query.question, signal);
          }
        }));

        return {
          content: [{ type: "text" as const, text: answers.join("\n\n") }],
          details: { roles: params.queries.map((query) => query.role) },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: `ask_panel failed: ${msg}` }], details: { roles: [] } };
      }
    },
  });
}
