import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { err, ok, type Result } from "neverthrow";
import { attachActivityLog } from "./activity.ts";
import { attachDebugLog, type DebugLog } from "./debug-log.ts";

/**
 * The full local tool set: the SDK's built-ins — read, the dedicated grep/find/ls
 * search-and-list tools, and edit/write/bash. Used only when the caller opts into
 * write access (`fullTools`); the default is the read-only subset below. grep/find/ls
 * are wired in so agents search and list with the dedicated tools rather than
 * shelling out through bash (slow and noisy). Host extensions are not inherited —
 * only these built-in tools are exposed (which also keeps the agent from re-entering
 * `fusion_agents`).
 */
export const PANEL_TOOLS = ["read", "grep", "find", "ls", "edit", "write", "bash"] as const;

/**
 * The read-only subset (the SDK's read-only tools): read plus the dedicated
 * grep/find/ls search-and-list tools, with no edit/write/bash. This is the default
 * set — used unless the caller opts into the full set via `fullTools` — so an agent
 * reviewing a project cannot modify files or run shell commands in its cwd by
 * default; only read and search.
 */
export const READONLY_TOOLS = ["read", "grep", "find", "ls"] as const;

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
  /**
   * Give the agent the full local tool set ({@link PANEL_TOOLS}: adds edit/write/bash
   * on top of read/grep/find/ls) so it can change files and run shell commands in its
   * cwd. `fuse` forwards it to every panel and synth agent. Default: false →
   * {@link READONLY_TOOLS}. Read-only is the safe default; writing is an explicit opt-in.
   */
  fullTools?: boolean;
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
 * A failure from a single inner agent: which model broke and why. Carried in the `Err`
 * arm of {@link runPanelAgent}'s result so a caller reports the failing model as
 * structured data instead of parsing a message.
 */
export interface AgentFailure {
  /** The "provider/model" id that failed. */
  model: string;
  /** Human-readable failure reason. */
  error: string;
}

/**
 * Run one panel agent end-to-end on a single model.
 *
 * The agent runs in the local environment with the read-only {@link READONLY_TOOLS}
 * set by default, or the full {@link PANEL_TOOLS} set when `fullTools` is passed. Returns
 * `ok(result)` only on a clean run; any model/tool/runtime failure (or a cancel) becomes
 * `err({ model, error })` — never a throw, never a silent partial. On success the session
 * is left open (the caller disposes it) so a later synthesis/judge step can re-query it.
 *
 * While it runs, a line is logged to stderr each time the agent's activity changes
 * (with the time of the change) — see {@link attachActivityLog}.
 */
export async function runPanelAgent(
  modelId: string,
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<Result<PanelAgentResult, AgentFailure>> {
  const fail = (error: string): Result<PanelAgentResult, AgentFailure> =>
    err({ model: modelId, error });
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  let session: AgentSession;
  try {
    options.signal?.throwIfAborted(); // already cancelled → don't even spin up a session
    const model = resolveModel(modelId);
    // Read-only is the default (CLI-023): the agent gets read/grep/find/ls unless the
    // caller opts into the full local set (edit/write/bash) via `fullTools`. Same
    // selection for every inner agent (panel and synth).
    const tools = options.fullTools ? PANEL_TOOLS : READONLY_TOOLS;
    ({ session } = await createAgentSession({
      model,
      cwd: options.cwd ?? process.cwd(),
      tools: [...tools],
      // Reasoning level comes from the caller (fuse threads it per stage from the
      // config); default "xhigh" for direct callers that don't set one. Pi clamps
      // the level to what each model actually supports.
      thinkingLevel: options.thinkingLevel ?? "xhigh",
    }));
  } catch (e) {
    // resolveModel / createAgentSession / a pre-start abort: nothing to dispose yet.
    return fail(message(e));
  }

  // Cleanup handles are assigned inside the try below so that a throw from the setup
  // calls (attach*/addEventListener) is caught too — keeping the no-throw contract that
  // runPanel's Promise.all relies on. Declared here so `finally` can always run them.
  let detach: () => void = () => {};
  let detachDebug: (() => void) | undefined;
  const onAbort = () => void session.abort();
  try {
    // Log this agent's activity changes to stderr; persist a richer per-run debug log
    // when fuse enabled it (config.debugLog); bridge the cancel signal to session.abort()
    // (an abort makes prompt() resolve with stopReason "aborted", caught as a failed run).
    detach = attachActivityLog(session, modelId);
    if (options.debugLog) {
      detachDebug = attachDebugLog(session, modelId, options.debugLog);
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    // If the signal fired during the async createAgentSession above, the listener's
    // session.abort() is a no-op (prompt() hasn't created an abortable run yet), so
    // throw here to cancel. Once prompt() is running, the listener does the work.
    options.signal?.throwIfAborted();
    await session.prompt(prompt);

    // Failures don't throw — the stream contract encodes them as the final assistant
    // message with stopReason "error"/"aborted". Turn them into err().
    const last = [...session.state.messages]
      .reverse()
      .find((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");

    // Only "stop" is a clean completion. "length" (truncated), "toolUse" (loop ended
    // mid tool-cycle), "error" and "aborted" are all partial/failed runs.
    let outcome: Result<PanelAgentResult, AgentFailure>;
    if (!last) {
      outcome = fail(`produced no response`);
    } else if (last.stopReason !== "stop") {
      const detail = last.errorMessage ? `: ${last.errorMessage}` : "";
      outcome = fail(`did not complete cleanly (stopReason: ${last.stopReason})${detail}`);
    } else {
      const text = session.getLastAssistantText();
      outcome =
        !text || text.trim() === "" ? fail(`returned empty text`) : ok({ modelId, text, session });
    }

    // Keep the session alive only on success; the caller disposes it then.
    if (outcome.isErr()) {
      session.dispose();
    }
    return outcome;
  } catch (e) {
    session.dispose();
    return fail(message(e));
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (detachDebug) {
      detachDebug();
    }
    detach();
  }
}
