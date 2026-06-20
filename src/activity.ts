import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ActivitySink } from "./events.ts";

/**
 * Subscribe one inner agent's session and emit an `activity` {@link ProgressEvent} for each
 * step it runs — a tool call, or the `thinking`/`writing` phases. Each step emits `start`
 * when it begins and `end` when it finishes; the end carries `durationMs` (paired from the
 * matching start). Nothing is written to stdout/stderr — events go only to `emit`.
 *
 * Returns a detach function that unsubscribes AND flushes: any step still open (a tool that
 * never reported its end, a thinking/writing phase cut off by an abort) is emitted as an
 * `end` with `aborted:true` and its partial duration, so a consumer never shows a ghost
 * "running" step after the agent is gone.
 */
export function attachActivityLog(session: AgentSession, modelId: string, emit: ActivitySink): () => void {
  // Steps in flight, keyed so parallel tools don't collide: a tool by its toolCallId, the
  // thinking/writing phases by a fixed key (only one of each runs at a time per agent). `buf`
  // accumulates a streamed thinking/writing text; `lastEmit` throttles its update events.
  const open = new Map<string, { activity: string; detail?: string; startedAt: number; buf?: string; lastEmit?: number }>();

  const start = (key: string, activity: string, detail?: string): void => {
    const t = Date.now();
    open.set(key, { activity, detail, startedAt: t });
    emit({ kind: "activity", t, model: modelId, activity, phase: "start", ...(detail ? { detail } : {}) });
  };

  // Append a streamed chunk to an open thinking/writing step and refresh its dimmed tail. The
  // detail is always kept current (so the eventual end carries the final tail), but the update
  // event is throttled — we don't re-render the host on every token.
  const append = (key: string, chunk: string): void => {
    const step = open.get(key);
    if (!step) return;

    step.buf = (step.buf ?? "") + chunk;
    step.detail = streamTail(step.buf);
    const t = Date.now();
    if (step.lastEmit !== undefined && t - step.lastEmit < UPDATE_THROTTLE_MS) return;
    step.lastEmit = t;
    emit({ kind: "activity", t, model: modelId, activity: step.activity, phase: "update", ...(step.detail ? { detail: step.detail } : {}) });
  };

  const end = (key: string, aborted = false): void => {
    const step = open.get(key);
    if (!step) return;

    open.delete(key);
    const t = Date.now();
    emit({
      kind: "activity",
      t,
      model: modelId,
      activity: step.activity,
      phase: "end",
      durationMs: t - step.startedAt,
      ...(step.detail ? { detail: step.detail } : {}),
      ...(aborted ? { aborted: true } : {}),
    });
  };

  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case "tool_execution_start":
        start(event.toolCallId, event.toolName, summarizeArgs(event.toolName, event.args));
        return;

      case "tool_execution_end":
        end(event.toolCallId);
        return;

      case "message_update": {
        const e = event.assistantMessageEvent;
        if (e.type === "thinking_start") {
          start("thinking", "thinking");
        } else if (e.type === "thinking_delta") {
          append("thinking", e.delta);
        } else if (e.type === "thinking_end") {
          end("thinking");
        } else if (e.type === "text_start") {
          start("writing", "writing");
        } else if (e.type === "text_delta") {
          append("writing", e.delta);
        } else if (e.type === "text_end") {
          end("writing");
        }
        return;
      }

      default:
        return;
    }
  });

  return () => {
    unsubscribe();

    // Flush whatever is still open as an aborted end (via `end`, the single event source), so
    // no step is left "running". Snapshot the keys first — `end` deletes as it goes.
    for (const key of [...open.keys()]) {
      end(key, true);
    }
  };
}

/** Longest param detail we surface on the live line. */
const DETAIL_MAX = 120;

/** Last N chars of a streamed thinking/writing text shown as the live tail. */
const STREAM_TAIL = 120;

/** Min gap between a step's streamed-tail update events — throttles host re-renders. */
const UPDATE_THROTTLE_MS = 200;

/** The live one-line tail of a streamed text: whitespace collapsed, last {@link STREAM_TAIL}
 *  chars, with a leading ellipsis when there's more before it. */
function streamTail(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > STREAM_TAIL ? `…${oneLine.slice(-STREAM_TAIL)}` : oneLine;
}

/**
 * A short, human-readable summary of a tool call's params for the progress line — the file a
 * `read` touches, `git_diff`'s mode/path, a `web_search` query, and so on. Picks the most
 * telling string field (a tiny git_diff special case; otherwise a priority of common keys,
 * then any string), trimmed to {@link DETAIL_MAX}. Returns undefined when there's nothing useful.
 */
function summarizeArgs(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  const str = (key: string): string | undefined => (typeof a[key] === "string" && a[key] ? String(a[key]) : undefined);

  let detail: string | undefined;
  if (toolName === "git_diff") {
    detail = [str("mode"), str("path") ?? str("ref")].filter(Boolean).join(" ") || undefined;
  } else {
    detail =
      str("path") ??
      str("file") ??
      str("filePath") ??
      str("query") ??
      str("pattern") ??
      str("command") ??
      str("url") ??
      Object.values(a).find((v): v is string => typeof v === "string" && v.length > 0);
  }
  if (!detail) return undefined;

  const oneLine = detail.replace(/\s+/g, " ").trim();
  return oneLine.length > DETAIL_MAX ? `${oneLine.slice(0, DETAIL_MAX - 1)}…` : oneLine;
}
