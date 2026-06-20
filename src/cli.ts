#!/usr/bin/env node
// fusion — local CLI for pi-fusion-agents. Ask a question, get the single fused answer
// (a panel of >= 2 models + 1-model synthesis). Built into ./bin via `bun run build:cli`.
//
//   fusion "your question here"
//   fusion -f prompt.txt
//
// Config: reads <cwd>/.pi/fusion-agents.json, else ~/.config/fusion-agents.json.
// Key: Pi reads OPENCODE_API_KEY from the environment (or its stored auth) on its own —
// the CLI never touches the key. Note: the built bin resolves its dependencies from THIS
// repo's node_modules, so it is not portable outside the repo tree.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseCliArgs, USAGE } from "./cli-args.ts";
import { resolveFusionConfig } from "./config.ts";
import { formatFailure, fuse } from "./fusion.ts";
import { createStderrSink } from "./stderr-sink.ts";

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read the whole of stdin as UTF-8 text. Used when the prompt is piped/heredoc'd in. */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.resume(); // make flowing-mode intent explicit (survives a future refactor)
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.kind === "help") {
    console.log(USAGE);
    return 0;
  }
  if (args.kind === "error") {
    console.error(`fusion: ${args.message}\n\n${USAGE}`);
    return 1;
  }

  // Resolve the prompt text from its source: a positional, a file (-f), or stdin.
  // All of this runs before config resolution, so a bad/empty prompt fails early.
  let prompt: string;
  if (args.kind === "file") {
    try {
      prompt = readFileSync(args.path, "utf8");
    } catch (err) {
      console.error(`fusion: cannot read prompt file ${args.path} (${msg(err)})`);
      return 1;
    }
    if (prompt.trim() === "") {
      console.error(`fusion: prompt file is empty: ${args.path}`);
      return 1;
    }
  } else if (args.kind === "stdin") {
    // A bare interactive terminal has nothing to read — print usage instead of
    // hanging on stdin waiting for input that will never come.
    if (process.stdin.isTTY) {
      console.error(`fusion: no prompt given\n\n${USAGE}`);
      return 1;
    }
    try {
      prompt = await readStdin();
    } catch (err) {
      console.error(`fusion: cannot read prompt from stdin (${msg(err)})`);
      return 1;
    }
    if (prompt.trim() === "") {
      console.error("fusion: prompt on stdin is empty");
      return 1;
    }
  } else {
    prompt = args.text;
  }

  // Resolve config: project's .pi/, else ~/.config/. A missing/invalid config is a setup
  // error the user must fix; like every failure it exits non-zero with the reason printed.
  const cwd = process.cwd();
  let config, path;
  try {
    ({ config, path } = resolveFusionConfig(cwd));
  } catch (err) {
    console.error(`fusion: ${msg(err)}\n\n${USAGE}`);
    return 1;
  }

  console.error(`config: ${path}`);
  console.error(`panel: ${config.panel.join(", ")} | synth: ${config.synth}`);
  if (args.resume) {
    // On resume the tool policy comes from the saved run's manifest, not these flags — so don't
    // print the read-only/unsafe label (it would misreport).
    console.error(`resuming run ${args.resume} (this takes a few minutes)…`);
  } else {
    console.error(
      args.fullTools
        ? "unsafe: inner agents can edit/write/run bash in this directory"
        : "read-only: inner agents limited to read/grep/find/ls",
    );
    console.error("running fusion on real models (this takes a few minutes)…");
  }

  // Live progress to stderr (durations per step + a total); the fused answer owns stdout.
  const result = await fuse(config, prompt, {
    cwd,
    fullTools: args.fullTools,
    resumeRunId: args.resume,
    activitySink: createStderrSink(),
  });
  if (result.isErr()) {
    console.error(`fusion: ${formatFailure(result.error)}`);
    return 1;
  }
  console.log(result.value.answer);
  // Surface the run id so a later, separate invocation can follow up (SYN-029). A resume extends
  // the same run rather than saving a new one.
  const id = result.value.runId;
  console.error(
    args.resume
      ? `run ${id} extended — follow up again: fusion --resume ${id} "<question>"`
      : `run saved as ${id} — follow up: fusion --resume ${id} "<question>"`,
  );
  return 0;
}

// Run only when executed as the entry, not when imported (defensive — the pure logic
// lives in cli-args.ts, so nothing should import this module). pathToFileURL works on
// every Node version, unlike `import.meta.main` (Node 24+, would silently no-op older).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`fusion: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      process.exit(1);
    },
  );
}
