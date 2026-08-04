import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { err, ok, type Result } from "neverthrow";
import type { DebugLog } from "./debug-log.ts";
import {
  JUDGE_ROLE_KEY,
  panelRoleKey,
  type ActivitySink,
  type ModelRole,
  type RoleKey,
  type RunStatus,
} from "./events.ts";
import { gitDiffTool, GIT_DIFF_TOOL_NAME } from "./git-diff-tool.ts";
import { DANGEROUS_REVIEWER_TOOLS } from "./review-mode.ts";
import { attachSessionLogs, bridgeSessionAbort } from "./session-instrumentation.ts";

/**
 * The read-only subset (the SDK's read-only tools): read plus the dedicated
 * grep/find/ls search-and-list tools, with no edit/write/bash. This is the default
 * set — used unless the caller opts into the full set via `fullTools` — so an agent
 * reviewing a project cannot modify files or run shell commands in its cwd by
 * default; only read and search.
 */
export const READONLY_TOOLS = ["read", "grep", "find", "ls"] as const;

/**
 * The full local built-in tool set. It extends the read-only tools with the shared dangerous-tool
 * tuple so session policy and warning styling cannot diverge.
 */
export const REVIEWER_TOOLS = [...READONLY_TOOLS, ...DANGEROUS_REVIEWER_TOOLS] as const;

/**
 * A host extension tool the inner agents opt into when the host provides it: `web_search`.
 * It's read-only, so it rides on top of either tool set — but only when actually available
 * (detected per run from the loaded extensions). Environments without it simply don't get it,
 * instead of every run naming a tool that isn't there.
 */
export const WEB_SEARCH_TOOL = "web_search";

/**
 * Host extension tools an inner agent is allowed to opt into. Only the host extensions that
 * provide one of these are loaded into an inner session (see {@link runAgent}); every
 * other host extension is filtered out so its lifecycle handlers never fire for a reviewer or
 * judge — which is what made a host like Herdr or a session indicator flash on each inner
 * agent's completion. Today the only opt-in is `web_search`.
 */
const OPT_IN_HOST_TOOLS = new Set<string>([WEB_SEARCH_TOOL]);

/** Exact reviewer allow-list for one safety mode and the host tools available to this run. */
export function reviewerToolNames(fullTools: boolean, hostTools: readonly string[]): string[] {
  const tools = [...READONLY_TOOLS, GIT_DIFF_TOOL_NAME];
  if (fullTools) {
    tools.push(...DANGEROUS_REVIEWER_TOOLS);
  }
  if (hostTools.includes(WEB_SEARCH_TOOL)) {
    tools.push(WEB_SEARCH_TOOL);
  }
  return tools;
}

function innerResourceLoader(cwd: string): { resourceLoader: DefaultResourceLoader; settingsManager: SettingsManager } {
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
  return { resourceLoader, settingsManager };
}

function availableHostTools(resourceLoader: DefaultResourceLoader): string[] {
  return resourceLoader.getExtensions().extensions
    .flatMap((extension) => [...extension.tools.keys()])
    .filter((name) => OPT_IN_HOST_TOOLS.has(name));
}

/** Resolve the exact reviewer tools before a live block is first painted. */
export async function resolveReviewerToolNames(cwd: string, fullTools: boolean): Promise<string[]> {
  const { resourceLoader } = innerResourceLoader(cwd);
  await resourceLoader.reload();
  return reviewerToolNames(fullTools, availableHostTools(resourceLoader));
}

const EMPTY_VISIBLE_TEXT_RETRY_PROMPT =
  "Your previous turn had no visible final answer. Please provide the final answer now in visible assistant text only. Do not use hidden thinking as the answer.";

export interface AgentResult {
  /** Stable internal address for this agent slot. */
  roleKey: RoleKey;
  /** The "provider/model" id this agent ran on. */
  modelId: string;
  /** The agent's finished answer text. */
  text: string;
  /** Live session, left open for a later prompt; the caller disposes it. */
  session: AgentSession;
}

interface CommonAgentOptions {
  /** Working directory the agent's tools operate in. Default: process.cwd(). */
  cwd?: string;
  /** Reasoning level for this agent. Default: "xhigh". */
  thinkingLevel?: ThinkingLevel;
  /**
   * Cancellation signal. `runReview` forwards it unchanged to every reviewer and the
   * judge; aborting it stops all in-flight agents (and short-circuits ones not yet
   * started) instead of leaving agents running and burning credits.
   */
  signal?: AbortSignal;
  /**
   * Per-run debug log to record this agent's activity into. `runReview` creates one shared log
   * (when `config.debugLog` is set) and forwards it to every agent. Omitted → no logging.
   */
  debugLog?: DebugLog;
  /**
   * Progress sink. When set, this agent emits `model_start`/`activity`/`model_end`
   * {@link ActivitySink} events through it so a consumer can render live progress. When
   * omitted the agent is silent — it writes nothing to stdout/stderr itself. `runReview`
   * forwards it (and tags each agent's {@link role}) to every reviewer and the judge.
   */
  activitySink?: ActivitySink;
  /** Stable internal address for this agent slot. Defaults to `judge` or `panel-1`. */
  roleKey?: RoleKey;
  /**
   * Where this agent's session is persisted. Default: {@link SessionManager.inMemory} — nothing
   * on disk, so the host's `/resume` list stays clean. `runReview` passes a disk-backed manager
   * (`SessionManager.create(cwd, runDir)` for a fresh run, `SessionManager.open(file)` to resume)
   * when persisting a run for later follow-up (SYN-029).
   */
  sessionManager?: SessionManager;
  /**
   * A pre-built, possibly already-populated session to prompt instead of constructing a new one.
   * `runReview` uses this to resume a judge session opened from disk (SYN-029): the run skips
   * {@link createInnerAgentSession} and prompts the supplied session, which already carries round-1
   * context. Default: build a fresh session.
   */
  existingSession?: AgentSession;
}

interface ReviewerAgentOptions {
  role?: "reviewer";
  /**
   * Give a reviewer the full local tool set ({@link REVIEWER_TOOLS}: adds edit/write/bash
   * on top of read/grep/find/ls). Default: false → {@link READONLY_TOOLS}.
   */
  fullTools?: boolean;
  /** Exact pre-resolved reviewer tools; keeps the rendered policy and session allow-list identical. */
  reviewerTools?: readonly string[];
}

interface JudgeAgentOptions {
  role: "judge";
  /** The judge's only tool, `ask_panel`. */
  askPanel?: ToolDefinition;
}

export type RunAgentOptions = CommonAgentOptions & (ReviewerAgentOptions | JudgeAgentOptions);

/**
 * Resolve a `"provider/model"` id (e.g. `opencode-go/kimi-k2.6`) into a pi model.
 * Throws a clear error on a malformed id or an unknown model.
 */
export async function resolveModel(modelId: string, modelRuntime: ModelRuntime): Promise<Model<any>> {
  const slash = modelId.indexOf("/");
  if (slash < 1 || slash === modelId.length - 1) {
    throw new Error(`Invalid model id "${modelId}" (expected "provider/model")`);
  }
  const provider = modelId.slice(0, slash);
  const id = modelId.slice(slash + 1);
  const model = modelRuntime.getModel(provider, id);
  if (!model) throw new Error(`Unknown model "${modelId}"`);
  return model;
}

/**
 * A failure from a single inner agent: which model broke and why. Carried in the `Err`
 * arm of {@link runAgent}'s result so a caller reports the failing model as
 * structured data instead of parsing a message.
 */
export interface AgentFailure {
  /** The "provider/model" id that failed. */
  model: string;
  /** Human-readable failure reason. */
  error: string;
  /** True only when this failure was caused by the abort signal. */
  aborted: boolean;
}

/**
 * Build one inner-agent session (no prompt). Resolves the model, loads the host's extensions but
 * keeps only those that provide an opt-in tool ({@link OPT_IN_HOST_TOOLS}, today just
 * `web_search`) — everything else is dropped at load so its lifecycle handlers (a Herdr/terminal
 * notifier, a session indicator, even `rejudge` itself) never fire for a reviewer or judge —
 * then creates the session with the right tool set.
 *
 * A reviewer gets the local tool set: read/grep/find/ls + `git_diff` (TLS-026), `fullTools` adds
 * edit/write/bash, plus `web_search` when the host has it. The judge gets only `askPanel`.
 * In-memory unless a `sessionManager` is given (SYN-029). Shared by {@link runAgent}
 * and the resume path.
 */
export async function createInnerAgentSession(
  modelId: string,
  options: RunAgentOptions = {},
): Promise<AgentSession> {
  const modelRuntime = await ModelRuntime.create();
  const model = await resolveModel(modelId, modelRuntime);
  const cwd = options.cwd ?? process.cwd();

  const { resourceLoader, settingsManager } = innerResourceLoader(cwd);
  await resourceLoader.reload();

  let customTools: ToolDefinition[];
  let tools: string[];
  if (options.role === "judge") {
    customTools = options.askPanel ? [options.askPanel] : [];
    tools = options.askPanel ? [options.askPanel.name] : [];
  } else {
    customTools = [gitDiffTool];
    tools = options.reviewerTools
      ? [...options.reviewerTools]
      : reviewerToolNames(Boolean(options.fullTools), availableHostTools(resourceLoader));
  }

  const { session } = await createAgentSession({
    model,
    modelRuntime,
    cwd,
    tools,
    customTools,
    resourceLoader,
    settingsManager,
    // Reasoning level comes from the caller (runReview threads it per role); default "xhigh" for
    // direct callers. Pi clamps it to what each model supports.
    thinkingLevel: options.thinkingLevel ?? "xhigh",
    // In-memory by default so an inner agent never floods the host's /resume list; a disk-backed
    // manager (SYN-029) persists the run for later follow-up, in our own temp dir.
    sessionManager: options.sessionManager ?? SessionManager.inMemory(cwd),
  });
  return session;
}

interface AgentExecutionPolicy {
  retryEmpty: boolean;
  disposeOnFailure: boolean;
}

/** Execute one agent prompt with shared logging, abort, progress, and cleanup handling. */
async function executeAgent(
  modelId: string,
  prompt: string,
  options: RunAgentOptions,
  policy: AgentExecutionPolicy,
): Promise<Result<AgentResult, AgentFailure>> {
  const fail = (error: string, aborted = false): Result<AgentResult, AgentFailure> =>
    err({ model: modelId, error, aborted });
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const isSignalAbort = (e: unknown): boolean =>
    Boolean(options.signal?.aborted && e === options.signal.reason);

  const sink = options.activitySink;
  const role = options.role ?? "reviewer";
  const roleKey = options.roleKey ?? (role === "judge" ? JUDGE_ROLE_KEY : panelRoleKey(0));
  const startedAt = Date.now();
  sink?.({ kind: "model_start", t: startedAt, roleKey, model: modelId, role });

  // Recorded on whichever path we exit by, then emitted once as model_end in the outer
  // finally — so the event fires exactly once no matter how the run ends.
  let endStatus: RunStatus = "error";
  let endError: string | undefined;

  try {
    let session: AgentSession;
    try {
      options.signal?.throwIfAborted(); // already cancelled → don't even spin up a session
      // Resume (SYN-029) supplies a session opened from disk; otherwise build a fresh one.
      session = options.existingSession ?? (await createInnerAgentSession(modelId, options));
    } catch (e) {
      // resolveModel / createAgentSession / a pre-start abort. A freshly built session didn't
      // survive to assignment, but a caller-supplied existingSession (resume) is ours now —
      // dispose it so a failed resume doesn't leak the reopened judge session.
      if (options.existingSession && policy.disposeOnFailure) {
        options.existingSession.dispose();
      }
      const error = message(e);
      const aborted = isSignalAbort(e);
      endStatus = aborted ? "cancelled" : "error";
      endError = error;
      return fail(error, aborted);
    }

    // Cleanup handles are assigned inside the try below so that a throw from the setup
    // calls (attach*/addEventListener) is caught too — keeping the no-throw contract that
    // runPanel's Promise.all relies on. Declared here so `finally` can always run them.
    let detachLogs = (): void => {};
    let detachAbort = (): void => {};
    try {
      // Emit this agent's activity changes through the sink (only when one is set — the
      // engine is otherwise silent); persist a richer per-run debug log when runReview enabled
      // it (config.debugLog); bridge the cancel signal to session.abort() (an abort makes
      // prompt() resolve with stopReason "aborted", caught as a failed run).
      detachLogs = attachSessionLogs({
        session,
        roleKey,
        modelId,
        activitySink: sink,
        debugLog: options.debugLog,
      });
      detachAbort = bridgeSessionAbort(session, options.signal);

      // If the signal fired during the async createAgentSession above, the listener's
      // session.abort() is a no-op (prompt() hasn't created an abortable run yet), so
      // throw here to cancel. Once prompt() is running, the listener does the work.
      type PromptTurnOutcome =
        | { kind: "success"; text: string }
        | { kind: "empty" }
        | { kind: "failure"; error: string; aborted: boolean };

      const runPromptTurn = async (turnPrompt: string, retry: boolean): Promise<PromptTurnOutcome> => {
        const messageCount = session.state.messages.length;
        await session.prompt(turnPrompt);

        // Failures don't throw — the stream contract encodes them as the final assistant
        // message with stopReason "error"/"aborted". Turn them into err(). Only inspect
        // messages added by this prompt, so an existing/resumed session can't hide a bad turn.
        const last = [...session.state.messages.slice(messageCount)]
          .reverse()
          .find((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");

        // Only "stop" is a clean completion. "length" (truncated), "toolUse" (loop ended
        // mid tool-cycle), "error" and "aborted" are all partial/failed runs.
        if (!last) {
          return {
            kind: "failure",
            error: retry ? "empty-output retry produced no response" : "produced no response",
            aborted: false,
          };
        }
        if (last.stopReason !== "stop") {
          const detail = last.errorMessage ? `: ${last.errorMessage}` : "";
          const prefix = retry ? "empty-output retry did not complete cleanly" : "did not complete cleanly";
          return {
            kind: "failure",
            error: `${prefix} (stopReason: ${last.stopReason})${detail}`,
            aborted: last.stopReason === "aborted",
          };
        }

        const text = session.getLastAssistantText();
        if (!text || text.trim() === "") {
          return { kind: "empty" };
        }
        return { kind: "success", text };
      };

      options.signal?.throwIfAborted();
      const firstTurn = await runPromptTurn(prompt, false);

      let outcome: Result<AgentResult, AgentFailure>;
      if (firstTurn.kind === "success") {
        outcome = ok({ roleKey, modelId, text: firstTurn.text, session });
      } else if (firstTurn.kind === "failure") {
        outcome = fail(firstTurn.error, firstTurn.aborted);
      } else if (!policy.retryEmpty) {
        outcome = fail("returned empty text");
      } else {
        options.signal?.throwIfAborted();
        const retryTurn = await runPromptTurn(EMPTY_VISIBLE_TEXT_RETRY_PROMPT, true);
        if (retryTurn.kind === "success") {
          outcome = ok({ roleKey, modelId, text: retryTurn.text, session });
        } else if (retryTurn.kind === "empty") {
          outcome = fail("empty-output-after-retry: retry returned empty text");
        } else {
          outcome = fail(retryTurn.error, retryTurn.aborted);
        }
      }

      // Keep the session alive only on success; the caller disposes it then.
      if (outcome.isErr()) {
        if (policy.disposeOnFailure) {
          session.dispose();
        }
        endStatus = outcome.error.aborted ? "cancelled" : "error";
        endError = outcome.error.error;
      } else {
        endStatus = "done";
      }
      return outcome;
    } catch (e) {
      if (policy.disposeOnFailure) {
        session.dispose();
      }
      const error = message(e);
      const aborted = isSignalAbort(e);
      endStatus = aborted ? "cancelled" : "error";
      endError = error;
      return fail(error, aborted);
    } finally {
      detachAbort();
      // Flush still-open activity steps (emits their aborted ends) before model_end below.
      detachLogs();
    }
  } finally {
    if (sink) {
      const t = Date.now();
      sink({
        kind: "model_end",
        t,
        roleKey,
        model: modelId,
        role,
        status: endStatus,
        durationMs: t - startedAt,
        ...(endError ? { error: endError } : {}),
      });
    }
  }
}

/**
 * Run a reviewer or judge end-to-end. Returns a structured failure instead of throwing and
 * retains the session only on success so the caller can continue or dispose it.
 */
export function runAgent(
  modelId: string,
  prompt: string,
  options: RunAgentOptions = {},
): Promise<Result<AgentResult, AgentFailure>> {
  return executeAgent(modelId, prompt, options, { retryEmpty: true, disposeOnFailure: true });
}

/** Prompt a live reviewer session again without taking ownership of it. */
export function rerunAgent(
  agent: AgentResult,
  prompt: string,
  options: Pick<CommonAgentOptions, "signal" | "debugLog" | "activitySink"> = {},
): Promise<Result<AgentResult, AgentFailure>> {
  return executeAgent(agent.modelId, prompt, {
    ...options,
    role: "reviewer",
    roleKey: agent.roleKey,
    existingSession: agent.session,
  }, { retryEmpty: false, disposeOnFailure: false });
}
