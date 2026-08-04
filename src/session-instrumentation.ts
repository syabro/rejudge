import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { attachActivityLog } from "./activity.ts";
import { attachDebugLog, type DebugLog } from "./debug-log.ts";
import type { ActivitySink, RoleKey } from "./events.ts";

interface SessionLogOptions {
  session: AgentSession;
  roleKey: RoleKey;
  modelId: string;
  activitySink?: ActivitySink;
  debugLog?: DebugLog;
}

export function attachSessionLogs(options: SessionLogOptions): () => void {
  let detachActivity = (): void => {};
  let detachDebug = (): void => {};

  try {
    if (options.activitySink) {
      detachActivity = attachActivityLog(options.session, options.roleKey, options.modelId, options.activitySink);
    }
    if (options.debugLog) {
      detachDebug = attachDebugLog(
        options.session,
        options.roleKey,
        options.modelId,
        options.debugLog,
      );
    }
  } catch (error) {
    try {
      detachDebug();
    } finally {
      detachActivity();
    }
    throw error;
  }

  return () => {
    try {
      detachDebug();
    } finally {
      detachActivity();
    }
  };
}

export function bridgeSessionAbort(session: AgentSession, signal?: AbortSignal): () => void {
  if (!signal) return () => {};

  const onAbort = (): void => {
    session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}
