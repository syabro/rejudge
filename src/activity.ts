import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/**
 * Log one stderr line each time an inner agent's activity changes:
 * `HH:MM:SS <model> <activity>`, where activity is `thinking`, the concrete tool it
 * runs (`bash`/`read`/…), `writing`, or `done`. The timestamp is the moment of the
 * change, so the gap to the next line is how long the previous activity took. Plain
 * append — no in-place redraw, no ticker, no TUI. Returns an unsubscribe function.
 */
export function attachActivityLog(session: AgentSession, modelId: string): () => void {
  const label = modelId.slice(modelId.lastIndexOf("/") + 1);
  let last: string | undefined;
  return session.subscribe((event) => {
    const activity = describeActivity(event);
    if (activity === null || activity === last) return; // only on a real change
    last = activity;
    console.error(`${new Date().toTimeString().slice(0, 8)} ${label} ${activity}`);
  });
}

/**
 * Map a session event to its activity label, or `null` if it is not an activity
 * signal. Tool activity is keyed off `tool_execution_start` (the tool actually
 * starting), not the `toolcall_*` deltas (the model merely *proposing* a call).
 */
function describeActivity(event: AgentSessionEvent): string | null {
  switch (event.type) {
    case "tool_execution_start":
      return event.toolName;
    case "message_update": {
      const kind = event.assistantMessageEvent.type;
      if (kind === "thinking_start" || kind === "thinking_delta") return "thinking";
      if (kind === "text_start" || kind === "text_delta") return "writing";
      return null;
    }
    case "agent_end": {
      if (event.willRetry) return null; // loop runs again (auto-retry) — not done
      // Only a clean "stop" is "done"; on a failed/partial run the runner throws with
      // detail, so don't print a misleading "done" right before that error.
      const last = event.messages.findLast(
        (m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant",
      );
      return last?.stopReason === "stop" ? "done" : null;
    }
    default:
      return null;
  }
}
