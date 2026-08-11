// Pure CLI argument handling — no I/O, no side effects, so it can be unit-tested.
// `cli.ts` (the bin entry) imports these and does the actual file/config/review I/O.
import { parseArgs } from "node:util";

export const USAGE = `usage: rejudge ["your question"] | rejudge -f <file>
       command | rejudge ["instruction"]
       rejudge setup ollama

  positional       the question/instruction; when stdin is piped, it comes first
                   and the piped content follows after a blank line
  -f, --file       read the prompt from a file instead of the command line
  (stdin)          with no -f, stdin is the prompt or the positional payload
                   (e.g. \`cmd | rejudge\` or \`cmd | rejudge "instruction"\`)
      --unsafe,    give reviewers the full tool set (edit/write/bash) — they can
      --full       change files and run shell in the cwd; default is read-only
                   (read/grep/find/ls)
      --resume ID  follow up on a prior run: resume its reviewer and judge sessions
                   with their earlier context (the prompt is the follow-up).
                   Run directories become eligible for best-effort cleanup after
                   ~24h when a later fresh run starts; cleanup is not guaranteed.
  -h, --help       show this help

setup ollama       declare a Pi provider for the models your local Ollama daemon
                   reports, and a panel to go with it. Nothing is pulled and no
                   catalog is fetched — which models you keep is yours to decide.
      --project    write the panel to <cwd>/.rejudge/config.json instead of the
                   user-wide config
      --dry-run    print what would be written, write nothing
      --force      replace an existing Rejudge config instead of keeping it

Config: <cwd>/.rejudge/config.json, else ~/.config/rejudge/config.json.
Auth:   whatever Pi is set up with — an API key in the environment, a stored
        \`pi login\`, or a local server that needs neither.`;

/** The provider `rejudge setup` knows how to configure. */
export const SETUP_TARGETS = ["ollama"] as const;
export type SetupTarget = (typeof SETUP_TARGETS)[number];

/** Parsed CLI intent. `fullTools`/`resume`/`promptAdds` ride on the prompt/file/stdin kinds (orthogonal to the source). */
export type CliArgs =
  | { kind: "help" }
  | { kind: "prompt"; text: string; fullTools: boolean; resume?: string; promptAdds?: (string | undefined)[] }
  | { kind: "file"; path: string; fullTools: boolean; resume?: string; promptAdds?: (string | undefined)[] }
  | { kind: "stdin"; fullTools: boolean; resume?: string; promptAdds?: (string | undefined)[] }
  | { kind: "setup"; target: SetupTarget; project: boolean; dryRun: boolean; force: boolean }
  | { kind: "error"; message: string };

export function combinePromptInput(instruction: string, input: string): string {
  return input.trim() === "" ? instruction : `${instruction}\n\n${input}`;
}

/** Matches a `--prompt-add-<N>` flag, optionally with an `=value`. The `s` flag lets a `=value` span newlines. */
const PROMPT_ADD_RE = /^--prompt-add-(\d+)(?:=(.*))?$/s;

/**
 * TESTING-ONLY (not a product feature, never exposed by the `rejudge` tool): pull
 * `--prompt-add-<N>` flags out of argv before {@link parseArgs} sees them (it would reject them as
 * unknown). Each appends a per-panel instruction to the otherwise byte-identical prompt of panel
 * member N (1-based) — the only sanctioned way to break the "every agent gets the same input"
 * invariant, used to force panel divergence and reproduce cross-examination scenarios.
 *
 * Returns the remaining argv plus a `promptAdds` array index-aligned with the panel (0-based;
 * `undefined` in unset slots), or an `error` message. The N-vs-panel-size check needs the config,
 * so it happens later in `cli.ts`; here we only reject a 0 index, a missing value, or a duplicate.
 */
function extractPromptAdds(
  argv: string[],
): { rest: string[]; promptAdds?: (string | undefined)[] } | { error: string } {
  const rest: string[] = [];
  const byIndex = new Map<number, string>();

  for (let i = 0; i < argv.length; i++) {
    const match = PROMPT_ADD_RE.exec(argv[i]);
    if (!match) {
      rest.push(argv[i]);
      continue;
    }

    const n = Number(match[1]);
    if (n < 1) {
      return { error: `--prompt-add-${match[1]} must use a 1-based panel index (the first panel member is --prompt-add-1)` };
    }

    let value: string;
    if (match[2] !== undefined) {
      value = match[2];
    } else {
      if (i + 1 >= argv.length) return { error: `--prompt-add-${n} needs a text value` };
      value = argv[++i];
    }

    const idx = n - 1;
    if (byIndex.has(idx)) return { error: `--prompt-add-${n} given more than once` };
    byIndex.set(idx, value);
  }

  if (byIndex.size === 0) return { rest };

  const length = Math.max(...byIndex.keys()) + 1;
  const promptAdds = Array.from({ length }, (_, i) => byIndex.get(i));
  return { rest, promptAdds };
}

/**
 * Recognize `rejudge setup <target>` and its flags, or return undefined when this argv is not a
 * setup invocation.
 *
 * The trigger is a bare first positional `setup`, which does take that word away from questions:
 * `rejudge setup the staging box` no longer asks anything. The error says how to get it back —
 * quoting the question keeps it a single positional — because a silent reinterpretation would be
 * worse than a message. Review-run flags are rejected here rather than ignored.
 */
function parseSetup(
  values: { unsafe?: boolean; full?: boolean; file?: string; resume?: string; project?: boolean; "dry-run"?: boolean; force?: boolean },
  positionals: string[],
): CliArgs | undefined {
  if (positionals[0] !== "setup") return undefined;

  const targets = SETUP_TARGETS.map((t) => `"${t}"`).join(", ");
  const requested = positionals.slice(1);
  if (requested.length === 0) {
    return { kind: "error", message: `rejudge setup needs a target (${targets})` };
  }

  const target = requested[0];
  if (requested.length > 1 || !(SETUP_TARGETS as readonly string[]).includes(target)) {
    return {
      kind: "error",
      message:
        `unknown setup target "${requested.join(" ")}" — supported: ${targets}.` +
        ` To ask a question that starts with "setup", quote the whole thing:` +
        ` rejudge "${positionals.join(" ")}"`,
    };
  }

  const review = (["unsafe", "full", "file", "resume"] as const).find((flag) => values[flag] !== undefined && values[flag] !== false);
  if (review) {
    return { kind: "error", message: `--${review} belongs to a review run, not \`rejudge setup\`` };
  }

  return {
    kind: "setup",
    target: target as SetupTarget,
    project: values.project ?? false,
    dryRun: values["dry-run"] ?? false,
    force: values.force ?? false,
  };
}

/**
 * Parse argv (without the node/script prefix) into an intent. Never throws — a parse
 * failure (unknown flag, `-f` without a value) comes back as `{ kind: "error" }`.
 * A prompt comes from a positional question, `-f`, or stdin. A positional question can also
 * carry piped stdin as its payload; `cli.ts` does the actual read and combines both parts.
 * With no positional and no `-f`, stdin is the whole prompt.
 * `--unsafe` and `--full` are synonyms that enable the full tool set; absent → false
 * (read-only default).
 */
export function parseCliArgs(argv: string[]): CliArgs {
  // Pull the testing-only --prompt-add-N flags out first; parseArgs would reject them as unknown.
  const extracted = extractPromptAdds(argv);
  if ("error" in extracted) return { kind: "error", message: extracted.error };
  const { rest, promptAdds } = extracted;

  let values: {
    file?: string;
    help?: boolean;
    unsafe?: boolean;
    full?: boolean;
    resume?: string;
    project?: boolean;
    "dry-run"?: boolean;
    force?: boolean;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: rest,
      options: {
        file: { type: "string", short: "f" },
        help: { type: "boolean", short: "h" },
        unsafe: { type: "boolean" },
        full: { type: "boolean" },
        resume: { type: "string" },
        project: { type: "boolean" },
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }

  if (values.help) return { kind: "help" };

  const setup = parseSetup(values, positionals);
  if (setup) return setup;

  // The setup-only flags mean nothing on a review run. Reject them instead of accepting them
  // silently, so a misplaced flag is a message rather than a surprise.
  const misplaced = (["project", "dry-run", "force"] as const).find((flag) => values[flag]);
  if (misplaced) {
    return { kind: "error", message: `--${misplaced} belongs to \`rejudge setup\`, not a review run` };
  }

  // --unsafe and --full are synonyms: either one opts into the full (write) tool set.
  const fullTools = (values.unsafe ?? false) || (values.full ?? false);
  const fileVal = values.file;
  const question = positionals.join(" ").trim();

  // --resume <id>: follow up on a prior run. A follow-up still needs a prompt (the question),
  // so an empty --resume value is an error; the prompt itself is validated by the source below.
  let resume: string | undefined;
  if (values.resume !== undefined) {
    resume = values.resume.trim();
    if (resume === "") return { kind: "error", message: "--resume needs a run id" };
  }

  if (fileVal !== undefined && question !== "") {
    return { kind: "error", message: "use either -f <file> or a positional question, not both" };
  }
  if (fileVal !== undefined) {
    const path = fileVal.trim();
    if (path === "") return { kind: "error", message: "-f needs a file path" };
    return { kind: "file", path, fullTools, resume, promptAdds };
  }

  // No positional and no -f → the prompt comes from stdin. The actual read and the
  // "is this a bare interactive terminal?" guard live in cli.ts (this stays I/O-free).
  if (question === "") return { kind: "stdin", fullTools, resume, promptAdds };
  return { kind: "prompt", text: question, fullTools, resume, promptAdds };
}
