import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { err, ok, type Result } from "neverthrow";
import { attachActivityLog } from "./activity.ts";
import { attachDebugLog, type DebugLog } from "./debug-log.ts";
import type { ActivitySink, ModelRole, RunStatus } from "./events.ts";
import { gitDiffTool, GIT_DIFF_TOOL_NAME } from "./git-diff-tool.ts";

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

/**
 * A host extension tool the inner agents opt into when the host provides it: `web_search`.
 * It's read-only, so it rides on top of either tool set — but only when actually available
 * (detected per run from the loaded extensions). Environments without it simply don't get it,
 * instead of every run naming a tool that isn't there.
 */
export const WEB_SEARCH_TOOL = "web_search";

/**
 * Host extension tools an inner agent is allowed to opt into. Only the host extensions that
 * provide one of these are loaded into an inner session (see {@link runPanelAgent}); every
 * other host extension is filtered out so its lifecycle handlers never fire for a panel/synth
 * agent — which is what made a host like Herdr or a session indicator flash on each inner
 * agent's completion. Today the only opt-in is `web_search`.
 */
const OPT_IN_HOST_TOOLS = new Set<string>([WEB_SEARCH_TOOL]);

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
  /**
   * Progress sink. When set, this agent emits `model_start`/`activity`/`model_end`
   * {@link ActivitySink} events through it so a consumer can render live progress. When
   * omitted the agent is silent — it writes nothing to stdout/stderr itself. `fuse`
   * forwards it (and tags each stage's {@link role}) to every panel and synth agent.
   */
  activitySink?: ActivitySink;
  /** This agent's role, stamped on its progress events. Default: "panel". */
  role?: ModelRole;
  /**
   * Extra custom tools to expose to THIS agent on top of the built-in `git_diff` — their names
   * are added to the allow-list and the tools to `customTools`. `fuse` uses this to give the
   * synth/"judge" agent the `ask_panel` tool (SYN-011), so it can re-query a panel for a second
   * round; panel agents pass none. Default: none.
   */
  extraTools?: ToolDefinition[];
  /**
   * Where this agent's session is persisted. Default: {@link SessionManager.inMemory} — nothing
   * on disk, so the host's `/resume` list stays clean. `fuse` passes a disk-backed manager
   * (`SessionManager.create(cwd, runDir)` for a fresh run, `SessionManager.open(file)` to resume)
   * when persisting a run for later follow-up (SYN-029).
   */
  sessionManager?: SessionManager;
  /**
   * Per-agent session managers for {@link runPanel} only — index-aligned with `models`. runPanel
   * distributes `sessionManagers[i]` into each agent's {@link sessionManager}. Ignored elsewhere.
   */
  sessionManagers?: SessionManager[];
  /**
   * TESTING-ONLY ({@link runPanel} only; never set by the `fusion_agents` tool). A per-panel prompt
   * suffix, index-aligned with `models` (`undefined` = no suffix for that slot). When set, runPanel
   * appends `promptAdds[i]` to agent `i`'s prompt — deliberately breaking the "every agent gets the
   * byte-identical prompt" invariant to force panel divergence and reproduce cross-examination
   * scenarios. Driven by the CLI's `--prompt-add-N` flag; ignored by every other caller.
   */
  promptAdds?: (string | undefined)[];
  /**
   * A pre-built, possibly already-populated session to prompt instead of constructing a new one.
   * `fuse` uses this to resume a synth/"judge" session opened from disk (SYN-029): the run skips
   * {@link createInnerSession} and prompts the supplied session, which already carries round-1
   * context. Default: build a fresh session.
   */
  existingSession?: AgentSession;
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
 * Build one inner-agent session (no prompt). Resolves the model, loads the host's extensions but
 * keeps only those that provide an opt-in tool ({@link OPT_IN_HOST_TOOLS}, today just
 * `web_search`) — everything else is dropped at load so its lifecycle handlers (a Herdr/terminal
 * notifier, a session indicator, even `fusion_agents` itself) never fire for a panel/synth agent —
 * then creates the session with the right tool set.
 *
 * Read-only is the default (CLI-023): read/grep/find/ls plus the custom `git_diff` (TLS-026),
 * unless `fullTools` opts into edit/write/bash. `extraTools` (e.g. `ask_panel`, SYN-011) are added
 * to both the allow-list and `customTools`. The session is in-memory unless a `sessionManager` is
 * given (SYN-029 persists/resumes via a disk-backed one). Shared by {@link runPanelAgent} (which
 * then prompts) and the resume path (which opens panel sessions without prompting).
 */
export async function createInnerSession(
  modelId: string,
  options: RunPanelAgentOptions = {},
): Promise<AgentSession> {
  const model = resolveModel(modelId);
  const cwd = options.cwd ?? process.cwd();

  const builtins = options.fullTools ? PANEL_TOOLS : READONLY_TOOLS;
  const extra = options.extraTools ?? [];
  const tools = [...builtins, GIT_DIFF_TOOL_NAME, ...extra.map((t) => t.name)];

  // Build and reload the loader ourselves so we can read the surviving host tools, then hand the
  // same instance to createAgentSession.
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionsOverride: (base) => ({
      ...base,
      extensions: base.extensions.filter((e) =>
        [...e.tools.keys()].some((name) => OPT_IN_HOST_TOOLS.has(name)),
      ),
    }),
  });
  await resourceLoader.reload();
  const hostTools = new Set(
    resourceLoader.getExtensions().extensions.flatMap((e) => [...e.tools.keys()]),
  );
  if (hostTools.has(WEB_SEARCH_TOOL)) {
    tools.push(WEB_SEARCH_TOOL);
  }

  const { session } = await createAgentSession({
    model,
    cwd,
    tools,
    customTools: [gitDiffTool, ...extra],
    resourceLoader,
    settingsManager,
    // Reasoning level comes from the caller (fuse threads it per stage); default "xhigh" for
    // direct callers. Pi clamps it to what each model supports.
    thinkingLevel: options.thinkingLevel ?? "xhigh",
    // In-memory by default so an inner agent never floods the host's /resume list; a disk-backed
    // manager (SYN-029) persists the run for later follow-up, in our own temp dir.
    sessionManager: options.sessionManager ?? SessionManager.inMemory(cwd),
  });
  return session;
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
 * When an `activitySink` is given the agent emits `model_start`/`activity`/`model_end`
 * progress events through it (see {@link attachActivityLog}); with no sink it is silent and
 * writes nothing to stdout/stderr.
 */
export async function runPanelAgent(
  modelId: string,
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<Result<PanelAgentResult, AgentFailure>> {
  const fail = (error: string): Result<PanelAgentResult, AgentFailure> =>
    err({ model: modelId, error });
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  // A cancel reads as "cancelled", anything else as "error" — used for the model_end status.
  const endStatusFor = (): RunStatus => (options.signal?.aborted ? "cancelled" : "error");

  const sink = options.activitySink;
  const role = options.role ?? "panel";
  const startedAt = Date.now();
  sink?.({ kind: "model_start", t: startedAt, model: modelId, role });

  // Recorded on whichever path we exit by, then emitted once as model_end in the outer
  // finally — so the event fires exactly once no matter how the run ends.
  let endStatus: RunStatus = "error";
  let endError: string | undefined;

  try {
    let session: AgentSession;
    try {
      options.signal?.throwIfAborted(); // already cancelled → don't even spin up a session
      // Resume (SYN-029) supplies a session opened from disk; otherwise build a fresh one.
      session = options.existingSession ?? (await createInnerSession(modelId, options));
    } catch (e) {
      // resolveModel / createAgentSession / a pre-start abort. A freshly built session didn't
      // survive to assignment, but a caller-supplied existingSession (resume) is ours now —
      // dispose it so a failed resume doesn't leak the reopened synth session.
      if (options.existingSession) {
        options.existingSession.dispose();
      }
      const error = message(e);
      endStatus = endStatusFor();
      endError = error;
      return fail(error);
    }

    // Cleanup handles are assigned inside the try below so that a throw from the setup
    // calls (attach*/addEventListener) is caught too — keeping the no-throw contract that
    // runPanel's Promise.all relies on. Declared here so `finally` can always run them.
    let detach: () => void = () => {};
    let detachDebug: (() => void) | undefined;
    const onAbort = () => void session.abort();
    try {
      // Emit this agent's activity changes through the sink (only when one is set — the
      // engine is otherwise silent); persist a richer per-run debug log when fuse enabled
      // it (config.debugLog); bridge the cancel signal to session.abort() (an abort makes
      // prompt() resolve with stopReason "aborted", caught as a failed run).
      if (sink) {
        detach = attachActivityLog(session, modelId, sink);
      }
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
        endStatus = endStatusFor();
        endError = outcome.error.error;
      } else {
        endStatus = "done";
      }
      return outcome;
    } catch (e) {
      session.dispose();
      const error = message(e);
      endStatus = endStatusFor();
      endError = error;
      return fail(error);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      if (detachDebug) {
        detachDebug();
      }
      // Flush still-open activity steps (emits their aborted ends) before model_end below.
      detach();
    }
  } finally {
    if (sink) {
      const t = Date.now();
      sink({
        kind: "model_end",
        t,
        model: modelId,
        role,
        status: endStatus,
        durationMs: t - startedAt,
        ...(endError ? { error: endError } : {}),
      });
    }
  }
}
