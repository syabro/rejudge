import { Type } from "typebox";
import { defineTool, type AgentSession } from "@earendil-works/pi-coding-agent";
import { attachActivityLog } from "./activity.ts";
import { attachDebugLog, type DebugLog } from "./debug-log.ts";
import type { ActivitySink, RunStatus } from "./events.ts";
import type { ReviewerResult } from "./runner.ts";

/**
 * The custom `ask_panel` tool lets the judge re-query the live sessions of one or more reviewers
 * for a second round — to cross-examine a disagreement
 * or pressure a disputed finding — before it produces the final answer. Re-prompting the SAME
 * session keeps that author's round-1 context, so it answers the follow-up remembering what it
 * already said.
 *
 * A single call takes a batch of `{ role, question }` queries and runs them in parallel, so the
 * judge re-queries every reviewer it wants in one shot without paying for serial
 * round-trips; it may also target just one. Stable role keys keep duplicate model choices distinct.
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

/** The only stop reason that means a clean completion; everything else is a partial/failed turn. */
const CLEAN_STOP = "stop";

/** The session's most recent assistant message, or undefined if it has none yet. */
function lastAssistant(session: AgentSession) {
  return [...session.state.messages]
    .reverse()
    .find((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");
}

export function makeAskPanelTool(
  panel: ReviewerResult[],
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

    const startedAt = Date.now();
    let detach: () => void = () => {};
    let detachDebug: () => void = () => {};
    let endStatus: RunStatus = "error";
    let endError: string | undefined;

    // Bridge the tool-call signal (the judge turn's signal — fires when the whole review is
    // cancelled) to this session; session.prompt() takes no signal of its own.
    const onAbort = () => void session.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    activitySink?.({
      kind: "model_start",
      t: startedAt,
      roleKey: target.roleKey,
      model: target.modelId,
      role: "reviewer",
    });

    try {
      if (activitySink) {
        detach = attachActivityLog(session, target.roleKey, target.modelId, activitySink);
      }
      if (debugLog) {
        detachDebug = attachDebugLog(session, target.roleKey, target.modelId, debugLog);
      }
      if (signal?.aborted) {
        endStatus = "cancelled";
        endError = `"${subject}" was cancelled and can't be re-queried.`;
        return label(endError);
      }
      await session.prompt(question);

      const last = lastAssistant(session);
      if (!last) {
        endError = `"${subject}" produced no response.`;
        return label(endError);
      }
      if (last.stopReason !== CLEAN_STOP) {
        const detail = last.errorMessage ? `: ${last.errorMessage}` : "";
        endStatus = signal?.aborted ? "cancelled" : "error";
        endError = `"${subject}" did not answer cleanly (stopReason: ${last.stopReason})${detail}.`;
        return label(endError);
      }

      const answer = session.getLastAssistantText();
      if (!answer || answer.trim() === "") {
        endError = `"${subject}" returned empty text.`;
        return label(endError);
      }

      endStatus = "done";
      return label(answer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      endStatus = signal?.aborted ? "cancelled" : "error";
      endError = `Re-querying "${subject}" failed: ${msg}`;
      return label(endError);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      detachDebug();
      detach();
      if (activitySink) {
        const t = Date.now();
        activitySink({
          kind: "model_end",
          t,
          roleKey: target.roleKey,
          model: target.modelId,
          role: "reviewer",
          status: endStatus,
          durationMs: t - startedAt,
          ...(endError ? { error: endError } : {}),
        });
      }
    }
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
          "One entry per author to re-query. Send every author you want in a SINGLE call — re-querying " +
          "all of them at once is the normal move; include just one entry if that's all you need. " +
          "Entries run in parallel.",
      },
    ),
  });

  return defineTool({
    name: ASK_PANEL_TOOL_NAME,
    label: "ask panel",
    description:
      "Re-query one or more analyses' authors for a second round (cross-examine a disagreement or " +
      `pressure a disputed point). Pass every author you want in one call; they run in parallel. Valid roles: ${roles.join(", ")}.`,
    parameters,
    async execute(_toolCallId, params, signal) {
      // runOne never throws, so Promise.all never rejects; the outer guard is belt-and-suspenders so
      // even a synchronous mishap becomes tool-error text, never a throw out of the fusion chain.
      try {
        const answers = await Promise.all(
          params.queries.map((query) => runOne(query.role, query.question, signal)),
        );
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
