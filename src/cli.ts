#!/usr/bin/env node
// rejudge — local CLI for Rejudge. Ask a question and get one independently reviewed answer.
// Built into ./bin via `bun run build:cli`.
//
//   rejudge "your question here"
//   rejudge -f prompt.txt
//
// Config: reads <cwd>/.rejudge/config.json, else ~/.config/rejudge/config.json.
// Key: Pi reads OPENCODE_API_KEY from the environment (or its stored auth) on its own —
// the CLI never touches the key. Note: the built bin resolves its dependencies from THIS
// repo's node_modules, so it is not portable outside the repo tree.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseCliArgs, USAGE } from "./cli-args.ts";
import { resolveRejudgeConfig } from "./config.ts";
import { formatFailure, runReview } from "./review.ts";
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
    console.error(`rejudge: ${args.message}\n\n${USAGE}`);
    return 1;
  }

  // Resolve the prompt text from its source: a positional, a file (-f), or stdin.
  // All of this runs before config resolution, so a bad/empty prompt fails early.
  let prompt: string;
  if (args.kind === "file") {
    try {
      prompt = readFileSync(args.path, "utf8");
    } catch (err) {
      console.error(`rejudge: cannot read prompt file ${args.path} (${msg(err)})`);
      return 1;
    }
    if (prompt.trim() === "") {
      console.error(`rejudge: prompt file is empty: ${args.path}`);
      return 1;
    }
  } else if (args.kind === "stdin") {
    // A bare interactive terminal has nothing to read — print usage instead of
    // hanging on stdin waiting for input that will never come.
    if (process.stdin.isTTY) {
      console.error(`rejudge: no prompt given\n\n${USAGE}`);
      return 1;
    }
    try {
      prompt = await readStdin();
    } catch (err) {
      console.error(`rejudge: cannot read prompt from stdin (${msg(err)})`);
      return 1;
    }
    if (prompt.trim() === "") {
      console.error("rejudge: prompt on stdin is empty");
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
    ({ config, path } = resolveRejudgeConfig(cwd));
  } catch (err) {
    console.error(`rejudge: ${msg(err)}\n\n${USAGE}`);
    return 1;
  }

  console.error(`config: ${path}`);
  const showSpec = (m: { id: string; level: string }): string => `${m.id}@${m.level}`;
  console.error(`reviewers: ${config.reviewers.map(showSpec).join(", ")} | judge: ${showSpec(config.judge)}`);

  // Testing-only --prompt-add-N validation needs the resolved panel size. A resume doesn't re-run
  // the panel, so a per-panel add would be silently ignored — reject the combination loudly.
  const promptAdds = args.promptAdds;
  if (promptAdds) {
    if (args.resume) {
      console.error("rejudge: --prompt-add-N can't be combined with --resume (a resume doesn't re-run the panel)");
      return 1;
    }
    for (let i = 0; i < promptAdds.length; i++) {
      if (promptAdds[i] !== undefined && i >= config.reviewers.length) {
        console.error(`rejudge: --prompt-add-${i + 1} is out of range — the panel has ${config.reviewers.length} reviewers`);
        return 1;
      }
    }
  }
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
    console.error("running Rejudge on real models (this takes a few minutes)…");
  }

  // Live progress goes to stderr; the review answer owns stdout.
  const result = await runReview(config, prompt, {
    cwd,
    fullTools: args.fullTools,
    resumeRunId: args.resume,
    promptAdds,
    activitySink: createStderrSink(),
  });
  if (result.isErr()) {
    console.error(`rejudge: ${formatFailure(result.error)}`);
    return 1;
  }
  console.log(result.value.answer);
  // Surface the run id so a later, separate invocation can follow up (SYN-029). A resume extends
  // the same run rather than saving a new one.
  const id = result.value.runId;
  console.error(
    args.resume
      ? `run ${id} extended — follow up again: rejudge --resume ${id} "<question>"`
      : `run saved as ${id} — follow up: rejudge --resume ${id} "<question>"`,
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
      console.error(`rejudge: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      process.exit(1);
    },
  );
}
