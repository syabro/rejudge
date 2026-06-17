// Pure CLI argument handling — no I/O, no side effects, so it can be unit-tested.
// `cli.ts` (the bin entry) imports these and does the actual file/config/fuse I/O.
import { parseArgs } from "node:util";

export const USAGE = `usage: fusion ["your question"] | fusion -f <file>

  positional    the question/instruction (quote multi-word questions)
  -f, --file    read the prompt from a file instead of the command line
  -h, --help    show this help

Config: <cwd>/.pi/fusion-agents.json, else ~/.config/fusion-agents.json.
Key:    set OPENCODE_API_KEY in the environment (or use Pi's stored auth).`;

/** Parsed CLI intent. */
export type CliArgs =
  | { kind: "help" }
  | { kind: "prompt"; text: string }
  | { kind: "file"; path: string }
  | { kind: "error"; message: string };

/**
 * Parse argv (without the node/script prefix) into an intent. Never throws — a parse
 * failure (unknown flag, `-f` without a value) comes back as `{ kind: "error" }`.
 * A prompt comes from EITHER a positional question OR `-f`, never both.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  let values: { file?: string; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        file: { type: "string", short: "f" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }

  if (values.help) return { kind: "help" };

  const fileVal = values.file;
  const question = positionals.join(" ").trim();

  if (fileVal !== undefined && question !== "") {
    return { kind: "error", message: "use either -f <file> or a positional question, not both" };
  }
  if (fileVal !== undefined) {
    const path = fileVal.trim();
    if (path === "") return { kind: "error", message: "-f needs a file path" };
    return { kind: "file", path };
  }
  if (question === "") return { kind: "error", message: "no question given" };
  return { kind: "prompt", text: question };
}
