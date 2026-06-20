// Pure CLI argument handling — no I/O, no side effects, so it can be unit-tested.
// `cli.ts` (the bin entry) imports these and does the actual file/config/fuse I/O.
import { parseArgs } from "node:util";

export const USAGE = `usage: fusion ["your question"] | fusion -f <file> | fusion <<'EOF' … EOF

  positional       the question/instruction (quote multi-word questions)
  -f, --file       read the prompt from a file instead of the command line
  (stdin)          with no positional and no -f, the prompt is read from stdin
                   (e.g. \`fusion <<'EOF' … EOF\` or \`cmd | fusion\`)
      --unsafe,    give inner agents the full tool set (edit/write/bash) — they can
      --full       change files and run shell in the cwd; default is read-only
                   (read/grep/find/ls)
      --resume ID  follow up on a prior run: resume its panel + synth sessions and
                   answer with their earlier context (the prompt is the follow-up).
                   A fresh run prints its ID; runs expire after ~24h.
  -h, --help       show this help

Config: <cwd>/.pi/fusion-agents.json, else ~/.config/fusion-agents.json.
Key:    set OPENCODE_API_KEY in the environment (or use Pi's stored auth).`;

/** Parsed CLI intent. `fullTools`/`resume` ride on the prompt/file/stdin kinds (orthogonal to the source). */
export type CliArgs =
  | { kind: "help" }
  | { kind: "prompt"; text: string; fullTools: boolean; resume?: string }
  | { kind: "file"; path: string; fullTools: boolean; resume?: string }
  | { kind: "stdin"; fullTools: boolean; resume?: string }
  | { kind: "error"; message: string };

/**
 * Parse argv (without the node/script prefix) into an intent. Never throws — a parse
 * failure (unknown flag, `-f` without a value) comes back as `{ kind: "error" }`.
 * A prompt comes from a positional question, `-f`, OR stdin, never more than one. With no
 * positional and no `-f` the source is stdin (`cli.ts` does the actual read + TTY guard).
 * `--unsafe` and `--full` are synonyms that enable the full tool set; absent → false
 * (read-only default).
 */
export function parseCliArgs(argv: string[]): CliArgs {
  let values: { file?: string; help?: boolean; unsafe?: boolean; full?: boolean; resume?: string };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        file: { type: "string", short: "f" },
        help: { type: "boolean", short: "h" },
        unsafe: { type: "boolean" },
        full: { type: "boolean" },
        resume: { type: "string" },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }

  if (values.help) return { kind: "help" };

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
    return { kind: "file", path, fullTools, resume };
  }

  // No positional and no -f → the prompt comes from stdin. The actual read and the
  // "is this a bare interactive terminal?" guard live in cli.ts (this stays I/O-free).
  if (question === "") return { kind: "stdin", fullTools, resume };
  return { kind: "prompt", text: question, fullTools, resume };
}
