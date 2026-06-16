import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

/**
 * The hand-picked tool set every panel agent runs with: full local
 * read/edit/write/bash in the trusted environment. Host extensions are not
 * inherited — only these built-in tools are exposed (which also keeps the
 * agent from re-entering `fusion_agents`).
 */
export const PANEL_TOOLS = ["read", "edit", "write", "bash"] as const;

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
 */
export async function runPanelAgent(
  modelId: string,
  prompt: string,
  options: RunPanelAgentOptions = {},
): Promise<PanelAgentResult> {
  const model = resolveModel(modelId);
  const { session } = await createAgentSession({
    model,
    cwd: options.cwd ?? process.cwd(),
    tools: [...PANEL_TOOLS],
  });
  try {
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
  }
}
