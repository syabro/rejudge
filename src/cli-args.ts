// Pure CLI argument handling — no I/O, no side effects, so it can be unit-tested.
// `cli.ts` (the bin entry) imports these and does the actual file/config/fuse I/O.
import { parseArgs } from "node:util";

export const USAGE = `usage: fusion ["your question"] | fusion -f <file>

  positional     the question/instruction (quote multi-word questions)
  -f, --file     read the prompt from a file instead of the command line
      --readonly restrict inner agents to read/grep/find/ls (no edit/write/bash)
  -h, --help     show this help

Config: <cwd>/.pi/fusion-agents.json, else ~/.config/fusion-agents.json.
Key:    set OPENCODE_API_KEY in the environment (or use Pi's stored auth).`;

/** Parsed CLI intent. `readOnly` rides on the prompt/file kinds (orthogonal to the source). */
export type CliArgs =
  | { kind: "help" }
  | { kind: "prompt"; text: string; readOnly: boolean }
  | { kind: "file"; path: string; readOnly: boolean }
  | { kind: "error"; message: string };

/**
 * Parse argv (without the node/script prefix) into an intent. Never throws — a parse
 * failure (unknown flag, `-f` without a value) comes back as `{ kind: "error" }`.
 * A prompt comes from EITHER a positional question OR `-f`, never both. `--readonly`
 * is independent of the prompt source and defaults to false.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  let values: { file?: string; help?: boolean; readonly?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        file: { type: "string", short: "f" },
        help: { type: "boolean", short: "h" },
        readonly: { type: "boolean" },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }

  if (values.help) return { kind: "help" };

  const readOnly = values.readonly ?? false;
  const fileVal = values.file;
  const question = positionals.join(" ").trim();

  if (fileVal !== undefined && question !== "") {
    return { kind: "error", message: "use either -f <file> or a positional question, not both" };
  }
  if (fileVal !== undefined) {
    const path = fileVal.trim();
    if (path === "") return { kind: "error", message: "-f needs a file path" };
    return { kind: "file", path, readOnly };
  }
  if (question === "") return { kind: "error", message: "no question given" };
  return { kind: "prompt", text: question, readOnly };
}
