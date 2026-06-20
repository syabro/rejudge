// Fusion demo / CLI: run the real 3-panel + 1-synth fusion on a question and
// print the single fused answer.
//
//   bun scripts/demo.ts "your question here"
//   bun scripts/demo.ts                 # runs the default question about this project
//   bun scripts/demo.ts --help
//
// Reads .pi/fusion-agents.json from the current directory, prints the fused
// answer to stdout (progress/diagnostics to stderr). Needs OPENCODE_API_KEY in
// the environment. Panel agents run read-only by default (read/grep/find/ls) in the
// current dir, so asking about the repo lets them read it to answer; this demo does
// not opt into write tools.
import { loadFusionConfig } from "../src/config.ts";
import { formatFailure, fuse } from "../src/fusion.ts";
import { createStderrSink } from "../src/stderr-sink.ts";

const DEFAULT_QUESTION =
  "Based on this project's source code, explain what the pi-fusion-agents" +
  " extension does and how its all-or-nothing fusion (panel fan-out + synthesis)" +
  " works. Answer in 3-5 sentences.";

const args = process.argv.slice(2);
if (args[0] === "-h" || args[0] === "--help") {
  console.error('usage: bun scripts/demo.ts ["your question"]');
  console.error("  no question → runs the default question about this project");
  process.exit(0);
}

const question = args.join(" ").trim() || DEFAULT_QUESTION;
const cwd = process.cwd();
const config = loadFusionConfig(cwd);

console.error(`question: ${question}`);
console.error(`panel: ${config.panel.join(", ")} | synth: ${config.synth}`);
console.error("running fusion on real models (this takes a few minutes)…");

const result = await fuse(config, question, { cwd, activitySink: createStderrSink() });
if (result.isErr()) {
  console.error(`fusion failed: ${formatFailure(result.error)}`);
  process.exit(1);
}
console.log(result.value);
