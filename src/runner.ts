import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { attachActivityLog } from "./activity.ts";
import { attachDebugLog, type DebugLog } from "./debug-log.ts";

/**
 * The hand-picked tool set every panel agent runs with: the SDK's full built-in
 * local tools — read, the dedicated grep/find/ls search-and-list tools, and
 * edit/write/bash — in the trusted environment. grep/find/ls are wired in so
 * agents search and list with the dedicated tools rather than shelling out
 * through bash (slow and noisy). Host extensions are not inherited — only these
 * built-in tools are exposed (which also keeps the agent from re-entering
 * `fusion_agents`).
 */
export const PANEL_TOOLS = ["read", "grep", "find", "ls", "edit", "write", "bash"] as const;

export interface PanelAgentResult {
  /** The "provider/model" id this agent ran on. */
  modelId: string;
  /** The agent's finished answer text. */
  text: string;
  /** Live session, left open for a later judge/synthesis re-query; the caller disposes it. */
  session: AgentSession;
}

export interface RunPanelAgentOptions {
  /** Working directory the agent's tools operate in. Default: process.cwd(). */
  cwd?: string;
  /** Reasoning level for this agent. Default: "xhigh". */
  thinkingLevel?: ThinkingLevel;
  /**
   * Cancellation signal. `fuse` forwards it unchanged to every panel agent and the
   * synthesis agent; aborting it stops all in-flight agents (and short-circuits ones
   * not yet started), so a cancelled fusion returns `{ ok: false }` instead of
   * leaving agents running and burning credits.
   */
  signal?: AbortSignal;
  /**
   * Per-run debug log to record this agent's activity into. `fuse` creates one shared log
   * (when `config.debugLog` is set) and forwards it to every agent. Omitted → no logging.
   */
  debugLog?: DebugLog;
}

/**
 * Resolve a `"provider/model"` id (e.g. `opencode-go/kimi-k2.6`) into a pi model.
 * Throws a clear error on a malformed id or an unknown model.
 */
export function resolveModel(modelId: string): Model<any> {
  const slash = modelId.indexOf("/");
  if (slash < 1 || slash === modelId.length - 1) {
    throw new Error(`Invalid model id "${modelId}" (expected "provider/model")`);
  }
  const provider = modelId.slice(0, slash);
  const id = modelId.slice(slash + 1);
  const model = ModelRegistry.create(AuthStorage.create()).find(provider, id);
  if (!model) throw new Error(`Unknown model "${modelId}"`);
  return model;
}

/**
 * Run one panel agent end-to-end on a single model and return its finished text.
 *
 * The agent runs in the trusted local environment with the fixed {@link PANEL_TOOLS}
 * set. Any model/tool/runtime failure surfaces as a thrown error, never a silent
 * partial result. On success the session is left open (the caller disposes it) so
 * a later synthesis/judge step can re-query the same agent.
 *
 * While it runs, a line is logged to stderr each time the agent's activity changes
 * (with the time of the change) — see {@link attachActivityLog}.
 */
export async function runPanelAgent(
  modelId: string,
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<PanelAgentResult> {
  options.signal?.throwIfAborted(); // already cancelled → don't even spin up a session
  const model = resolveModel(modelId);
  const { session } = await createAgentSession({
    model,
    cwd: options.cwd ?? process.cwd(),
    tools: [...PANEL_TOOLS],
    // Reasoning level comes from the caller (fuse threads it per stage from the
    // config); default "xhigh" for direct callers that don't set one. Pi clamps
    // the level to what each model actually supports.
    thinkingLevel: options.thinkingLevel ?? "xhigh",
  });
  // Log this agent's activity changes to stderr. Detached in `finally`; on the error
  // path dispose() has already removed the listener, so detach is then a no-op.
  const detach = attachActivityLog(session, modelId);
  // Persist a richer per-run debug log when fuse enabled it (config.debugLog).
  const detachDebug = options.debugLog && attachDebugLog(session, modelId, options.debugLog);
  // Bridge the cancel signal to the SDK's session.abort() for the in-flight run. An
  // abort makes prompt() resolve with stopReason "aborted", which the check below
  // surfaces as a thrown error → the whole fusion fails, never a silent partial.
  const onAbort = () => void session.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // If the signal fired during the async createAgentSession above, the listener's
    // session.abort() is a no-op (prompt() hasn't created an abortable run yet), so
    // throw here to cancel. Once prompt() is running, the listener does the work.
    options.signal?.throwIfAborted();
    await session.prompt(prompt);

    // Failures don't throw — the stream contract encodes them as the final
    // assistant message with stopReason "error"/"aborted". Surface them loudly.
    const last = [...session.state.messages]
      .reverse()
      .find((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");
    if (!last) {
      throw new Error(`Panel agent ${modelId} produced no response`);
    }
    // Only "stop" is a clean completion. "length" (truncated), "toolUse" (loop
    // ended mid tool-cycle), "error" and "aborted" are all partial/failed runs —
    // surface them instead of returning a silent partial answer.
    if (last.stopReason !== "stop") {
      const detail = last.errorMessage ? `: ${last.errorMessage}` : "";
      throw new Error(
        `Panel agent ${modelId} did not complete cleanly (stopReason: ${last.stopReason})${detail}`,
      );
    }

    const text = session.getLastAssistantText();
    if (!text || text.trim() === "") {
      throw new Error(`Panel agent ${modelId} returned empty text`);
    }
    return { modelId, text, session };
  } catch (err) {
    session.dispose();
    throw err;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (detachDebug) detachDebug();
    detach();
  }
}
