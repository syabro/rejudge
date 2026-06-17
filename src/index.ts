import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadFusionConfig } from "./config.ts";
import { fuse } from "./fusion.ts";

const parameters = Type.Object({
  question: Type.String({
    description: "The question or instruction to run across the panel and fuse into one answer.",
  }),
  outputInstructions: Type.Optional(
    Type.String({
      description:
        "Optional output/format instructions for the final answer (e.g. a requested structure" +
        " or P0/P1/P2/P3 buckets). Honored by every panel agent and the final synthesis.",
    }),
  ),
});

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

/**
 * Registers the single external tool `fusion_agents`.
 *
 * Explicit invocation only; the tool result is final answer text only. The
 * caller's optional output instructions are carried end-to-end to both the panel
 * agents and synthesis (see {@link buildInvocationPrompt}).
 */
export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "fusion_agents",
    label: "Fusion Agents",
    description:
      "Run the same question across a panel of models and fuse their answers into one. Call explicitly with a question or instruction.",
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Gate: refuse to start on a missing/invalid config — loadFusionConfig
      // throws a clear error, which surfaces as a tool error (not a fake answer).
      const config = loadFusionConfig(ctx.cwd);
      const prompt = buildInvocationPrompt(params.question, params.outputInstructions);
      // Thread the cancel signal end-to-end: aborting stops every in-flight agent.
      const result = await fuse(config, prompt, { cwd: ctx.cwd, signal });
      if (!result.ok) {
        // No fabricated answer on a technical failure — surface as a tool error.
        throw new Error("fusion_agents: the panel or synthesis did not complete");
      }
      return { content: [{ type: "text", text: result.answer }], details: {} };
    },
  });
}
