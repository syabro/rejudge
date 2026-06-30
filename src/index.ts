import type {
  AgentToolResult,
  ExtensionAPI,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveFusionConfig } from "./config.ts";
import type { ActivitySink } from "./events.ts";
import { formatFailure, fuse } from "./fusion.ts";
import {
  applyEvent,
  createProgressState,
  progressComponent,
  type ProgressSnapshot,
} from "./progress.ts";

const parameters = Type.Object({
  question: Type.String({
    description: "The question or instruction to run across the panel and fuse into one answer.",
  }),
  title: Type.Optional(
    Type.String({
      description:
        "A short title (a few words) for what this run is about — shown as the live progress" +
        " header, e.g. 'review the runner change' or 'pick a caching strategy'.",
    }),
  ),
  outputInstructions: Type.Optional(
    Type.String({
      description:
        "Optional output/format instructions for the final answer (e.g. a requested structure" +
        " or P0/P1/P2/P3 buckets). Honored by every panel agent and the final synthesis.",
    }),
  ),
  resumeRunId: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Resume a prior fusion run instead of starting a fresh panel. Use the run id returned" +
        " by an earlier successful fusion_agents call.",
    }),
  ),
});

/** A short header title — the caller's `title`, else a trimmed first line of the question. */
function progressTitle(question: string, title?: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit;

  const firstLine = question.trim().split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
}

/**
 * Compose the caller's question and optional output instructions into the single
 * prompt that is fanned out to the panel and threaded into synthesis.
 *
 * The requested format is carried end-to-end simply by living in this prompt:
 * every panel agent receives it verbatim, and the synthesis step embeds the task
 * and is told to obey its format. Blank/omitted instructions return the question
 * unchanged.
 */
export function buildInvocationPrompt(question: string, outputInstructions?: string): string {
  const instr = outputInstructions?.trim();
  if (!instr) return question;
  return [question, "", "## Output instructions", instr].join("\n");
}

/** Join a tool result's text content into one string. */
function textContent(result: AgentToolResult<ProgressSnapshot>): string {
  return result.content
    .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * Registers the single external tool `fusion_agents`.
 *
 * Explicit invocation only; the tool result content is the fused answer plus the run id for
 * follow-ups. While it runs, a live 3-level progress block (root → judge → panel models)
 * is streamed through
 * `onUpdate` and drawn by {@link renderProgress} — the engine writes nothing to the host's
 * stdout/stderr. The caller's optional output instructions are carried end-to-end to both
 * the panel agents and synthesis (see {@link buildInvocationPrompt}).
 */
export default function (pi: ExtensionAPI): void {
  pi.registerTool<typeof parameters, ProgressSnapshot>({
    name: "fusion_agents",
    label: "Fusion Agents",
    description:
      "Run the same question across a panel of models and fuse their answers into one. For follow-up questions, pass resumeRunId from a prior result.",
    parameters,
    // The tool draws its own multi-line block; don't wrap it in the default tool shell.
    renderShell: "self",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // Gate: refuse to start on a missing/invalid config. Resolve the project's
      // .pi/fusion-agents.json, else the user-global ~/.config one. A clear throw on
      // neither surfaces as a tool error, not a fake answer.
      const { config } = resolveFusionConfig(ctx.cwd);
      const prompt = buildInvocationPrompt(params.question, params.outputInstructions);

      // Live progress, scoped to this tool call (a second invocation starts clean). The tree
      // is seeded with every panel + judge row up front, "waiting…" until each model starts.
      const state = createProgressState(
        config.panel.map((m) => m.id),
        config.synth.id,
        progressTitle(params.question, params.title),
        prompt,
      );

      // Each update carries an immutable clone in `details` (a late render must never see
      // mutated state); `content` stays empty until the final answer (progress is for the UI,
      // not the model's context).
      const pushUpdate = (): void => onUpdate?.({ content: [], details: structuredClone(state) });
      const sink: ActivitySink = (event) => {
        applyEvent(state, event);
        pushUpdate();
      };

      // Refresh once a second so the live clock advances even during a long step with no
      // events. unref so the timer never keeps the host process alive.
      const ticker = setInterval(pushUpdate, 1000);
      if (typeof ticker.unref === "function") {
        ticker.unref();
      }

      try {
        // Thread the cancel signal end-to-end: aborting stops every in-flight agent.
        // Read-only by default (no `fullTools`) — the tool is a Q&A/review surface, so a
        // calling agent can't get edit/write/bash behind the user's back.
        const resumeRunId = params.resumeRunId?.trim();
        if (params.resumeRunId !== undefined && !resumeRunId) {
          return {
            content: [{ type: "text", text: "fusion_agents failed: resumeRunId must be a non-empty string" }],
            details: structuredClone(state),
          };
        }

        const result = await fuse(config, prompt, { cwd: ctx.cwd, signal, activitySink: sink, resumeRunId });
        // Don't throw on failure — throwing makes the host discard the whole rendered block.
        // Return instead: the final snapshot stays in `details` so the block keeps its failed
        // (red/cancelled) rows, and the failure is surfaced as the content text (no fabricated
        // answer — it names the stage/model that broke).
        const text = result.isErr()
          ? `fusion_agents failed: ${formatFailure(result.error)}`
          : [
              result.value.answer,
              "",
              resumeRunId
                ? `Run ID: ${result.value.runId} (resumed). Follow up again with resumeRunId: ${JSON.stringify(result.value.runId)}.`
                : `Run ID: ${result.value.runId}. Follow up with resumeRunId: ${JSON.stringify(result.value.runId)}.`,
            ].join("\n");
        return { content: [{ type: "text", text }], details: structuredClone(state) };
      } finally {
        clearInterval(ticker);
      }
    },
    renderResult(result, options: ToolRenderResultOptions, theme: Theme) {
      const s = result.details;
      const text = textContent(result);
      // No snapshot (shouldn't happen mid-run) → just show whatever text there is.
      if (!s || !Array.isArray(s.models)) return new Text(text);

      // Width-aware: the component lays the tree out for the host's viewport on each render
      // (detail column trims to fit, no wrapping). Expanded (Ctrl+O) shows the full query in
      // the header and appends the fused answer.
      return progressComponent(s, theme, options.expanded, text);
    },
  });
}
