// PNL-009 end-to-end demo: run the real 3-panel + 1-synth fusion on one research
// question about this project, in the trusted local environment. The panel agents
// have full local tools, so they read the repo to answer.
//
// Reproducible: reads .pi/fusion-agents.json from the repo root and prints the
// single fused answer to stdout (progress goes to stderr). Run from the repo root:
//
//   bun scripts/demo.ts
//
import { loadFusionConfig } from "../src/config.ts";
import { fuse } from "../src/fusion.ts";

const QUESTION =
  "Based on this project's source code, explain what the pi-fusion-agents" +
  " extension does and how its all-or-nothing fusion (panel fan-out + synthesis)" +
  " works. Answer in 3-5 sentences.";

const cwd = process.cwd();
const config = loadFusionConfig(cwd);
console.error(`panel: ${config.panel.join(", ")} | synth: ${config.synth}`);
console.error("running fusion on real models (this takes a few minutes)…");

const result = await fuse(config, QUESTION, { cwd });
if (!result.ok) {
  console.error("fusion failed: the panel or synthesis did not complete");
  process.exit(1);
}
console.log(result.answer);
