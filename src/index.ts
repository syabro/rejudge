import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadFusionConfig } from "./config.ts";

const parameters = Type.Object({
  question: Type.String({
    description: "The question or instruction to run across the panel and fuse into one answer.",
  }),
});

/**
 * Registers the single external tool `fusion_agents`.
 *
 * Explicit invocation only; the tool result is final answer text only.
 * Panel fan-out (CFG/PNL) and synthesis (SYN) arrive in later tasks — for now
 * the handler echoes the question so the tool is reachable end to end.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "fusion_agents",
    label: "Fusion Agents",
    description:
      "Run the same question across a panel of models and fuse their answers into one. Call explicitly with a question or instruction.",
    parameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Gate: refuse to start on a missing/invalid config — loadFusionConfig
      // throws a clear error, which surfaces as a tool error (not a fake answer).
      const config = loadFusionConfig(ctx.cwd);
      const text =
        `fusion_agents ready (panel: ${config.panel.join(", ")}; synth: ${config.synth}).` +
        ` Received: ${params.question}\n(panel fan-out + synthesis not implemented yet)`;
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
