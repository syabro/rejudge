import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ActivitySink } from "./events.ts";

/** A per-run debug-log sink. `write` never throws — a logging failure must not break a run. */
export interface DebugLog {
  /** Append one record as a JSON line. Adds `t` (ms) — caller supplies the rest. */
  write(record: Record<string, unknown>): void;
}

const HEAD_LINES = 3;
const TAIL_LINES = 3;
const MAX_CHARS = 2000;

/**
 * Truncate bulky tool I/O for the log: keep the first {@link HEAD_LINES} and last
 * {@link TAIL_LINES} lines (with an "N lines omitted" marker), then hard-cap the result
 * at {@link MAX_CHARS} so a single huge line (a minified blob, one long bash line) can't
 * blow up the log. The record's `chars`/`lines` fields still carry the true full size.
 */
export function truncate(s: string): string {
  const lines = s.split("\n");
  let out = s;
  if (lines.length > HEAD_LINES + TAIL_LINES) {
    const omitted = lines.length - HEAD_LINES - TAIL_LINES;
    out = [
      ...lines.slice(0, HEAD_LINES),
      `… ${omitted} lines omitted …`,
      ...lines.slice(-TAIL_LINES),
    ].join("\n");
  }
  if (out.length > MAX_CHARS) {
    out = `${out.slice(0, MAX_CHARS)}… (${out.length - MAX_CHARS} more chars)`;
  }
  return out;
}

/** Stringify a tool's args/result for the log without ever throwing (circular refs etc.). */
function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Char + line count of the full (pre-truncation) content — the "what bloats context" signal. */
function size(s: string): { chars: number; lines: number } {
  return { chars: s.length, lines: s.split("\n").length };
}

/**
 * Open a per-run debug log at `<cwd>/.pi/fusion-logs/<timestamp>.jsonl`. Returns a sink,
 * or `undefined` if the directory can't be created (never throws — a debug log must never
 * abort a real run). Records are appended synchronously; writes are bounded (one per
 * activity, not per token), so appendFileSync is fine.
 *
 * Notices (the log path, a creation/write failure) go through the optional `emit` sink as
 * `diagnostic` events rather than straight to stderr — so when fusion runs as the
 * `fusion_agents` tool inside a host Pi, they surface in the tool's own block instead of
 * corrupting the host's output. With no sink, notices are dropped (the engine stays silent).
 */
export function createDebugLog(cwd: string, emit?: ActivitySink): DebugLog | undefined {
  const note = (severity: "info" | "warn" | "error", message: string): void => {
    emit?.({ kind: "diagnostic", t: Date.now(), severity, message });
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  const path = join(cwd, ".pi", "fusion-logs", `${stamp}-${rand}.jsonl`);
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (err) {
    note("warn", `could not create debug log (${String(err)}) — continuing without it`);
    return undefined;
  }
  // The debug log path (the block renders this diagnostic dimmed/grey).
  note("info", `debug log → ${path}`);
  let warned = false;
  return {
    write(record) {
      try {
        appendFileSync(path, `${JSON.stringify(record)}\n`);
      } catch (err) {
        if (!warned) {
          warned = true;
          note("warn", `debug log write failed (${String(err)}) — further failures suppressed`);
        }
      }
    },
  };
}

/**
 * Subscribe one agent's session to the shared {@link DebugLog}. Records thinking and
 * assistant text in full, tool args/results truncated (head/tail + char cap) with their
 * true size, plus the context/slowness signals (compaction, retry, agent end). Returns an
 * unsubscribe function. The whole per-event handler is wrapped so a logging error never
 * propagates into the SDK's event dispatch.
 */
export function attachDebugLog(session: AgentSession, modelId: string, log: DebugLog): () => void {
  const model = modelId.slice(modelId.lastIndexOf("/") + 1);
  return session.subscribe((event) => {
    try {
      const rec = recordFor(event);
      if (rec) {
        log.write({ t: Date.now(), model, ...rec });
      }
    } catch {
      // Never let a logging failure break the agent run.
    }
  });
}

/** Map a session event to its log record (without `t`/`model`), or `null` to skip it. */
function recordFor(event: AgentSessionEvent): Record<string, unknown> | null {
  switch (event.type) {
    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e.type === "thinking_end") return { kind: "thinking", ...size(e.content), content: e.content };
      if (e.type === "text_end") return { kind: "text", ...size(e.content), content: e.content };
      return null;
    }
    case "tool_execution_start": {
      const s = stringify(event.args);
      return { kind: "tool_call", tool: event.toolName, toolCallId: event.toolCallId, ...size(s), content: truncate(s) };
    }
    case "tool_execution_end": {
      const s = stringify(event.result);
      return {
        kind: "tool_result",
        tool: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
        ...size(s),
        content: truncate(s),
      };
    }
    case "compaction_start":
      return { kind: "compaction_start", reason: event.reason };
    case "compaction_end":
      return { kind: "compaction_end", reason: event.reason, aborted: event.aborted, willRetry: event.willRetry };
    case "auto_retry_start":
      return {
        kind: "retry_start",
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      };
    case "auto_retry_end":
      return {
        kind: "retry_end",
        success: event.success,
        attempt: event.attempt,
        ...(event.finalError ? { finalError: event.finalError } : {}),
      };
    case "agent_end": {
      const last = event.messages.findLast(
        (m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant",
      );
      return { kind: "agent_end", willRetry: event.willRetry, stopReason: last?.stopReason };
    }
    default:
      return null;
  }
}
