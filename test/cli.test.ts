import { test, expect } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "../src/cli-args.ts";

test("a single positional becomes the prompt (read-only by default)", () => {
  expect(parseCliArgs(["hello"])).toEqual({ kind: "prompt", text: "hello", fullTools: false });
});

test("multi-word positionals join into one prompt", () => {
  expect(parseCliArgs(["what", "is", "this"])).toEqual({
    kind: "prompt",
    text: "what is this",
    fullTools: false,
  });
});

test("-f / --file yields a file intent", () => {
  expect(parseCliArgs(["-f", "p.txt"])).toEqual({ kind: "file", path: "p.txt", fullTools: false });
  expect(parseCliArgs(["--file", "p.txt"])).toEqual({
    kind: "file",
    path: "p.txt",
    fullTools: false,
  });
});

test("--unsafe and --full are synonyms that enable the full tool set", () => {
  expect(parseCliArgs(["--unsafe", "hello"])).toEqual({
    kind: "prompt",
    text: "hello",
    fullTools: true,
  });
  expect(parseCliArgs(["--full", "hello"])).toEqual({
    kind: "prompt",
    text: "hello",
    fullTools: true,
  });
  expect(parseCliArgs(["--unsafe", "-f", "p.txt"])).toEqual({
    kind: "file",
    path: "p.txt",
    fullTools: true,
  });
  // Order-independent: the flag may follow the prompt source too.
  expect(parseCliArgs(["-f", "p.txt", "--full"])).toEqual({
    kind: "file",
    path: "p.txt",
    fullTools: true,
  });
});

test("-h / --help yields help", () => {
  expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
});

test("-f together with a positional is an error", () => {
  expect(parseCliArgs(["-f", "p.txt", "extra"]).kind).toBe("error");
});

test("no positional and no -f means read from stdin", () => {
  expect(parseCliArgs([])).toEqual({ kind: "stdin", fullTools: false });
  // flags-only (no prompt source) is still stdin; the flag rides along
  expect(parseCliArgs(["--unsafe"])).toEqual({ kind: "stdin", fullTools: true });
  expect(parseCliArgs(["--full"])).toEqual({ kind: "stdin", fullTools: true });
});

test("an unknown flag is an error, not a throw", () => {
  expect(parseCliArgs(["--nope"]).kind).toBe("error");
});

// Testing-only --prompt-add-N: a per-panel prompt suffix, index-aligned with the panel (0-based,
// undefined in unset slots). It parses on any prompt source and alongside the other flags.
test("--prompt-add-N attaches a per-panel suffix, both forms, with gaps", () => {
  // Separate-token and = forms are equivalent.
  expect(parseCliArgs(["--prompt-add-1", "be terse", "hello"])).toEqual({
    kind: "prompt",
    text: "hello",
    fullTools: false,
    promptAdds: ["be terse"],
  });
  expect(parseCliArgs(["--prompt-add-1=be terse", "hello"])).toEqual({
    kind: "prompt",
    text: "hello",
    fullTools: false,
    promptAdds: ["be terse"],
  });

  // Gaps are undefined slots: only panels 1 and 3 steered.
  expect(parseCliArgs(["--prompt-add-1", "a", "--prompt-add-3", "c", "hello"])).toEqual({
    kind: "prompt",
    text: "hello",
    fullTools: false,
    promptAdds: ["a", undefined, "c"],
  });

  // Rides on stdin and -f too, and combines with --unsafe.
  expect(parseCliArgs(["--prompt-add-2", "x", "--unsafe"])).toEqual({
    kind: "stdin",
    fullTools: true,
    promptAdds: [undefined, "x"],
  });
  expect(parseCliArgs(["-f", "p.txt", "--prompt-add-1", "x"])).toEqual({
    kind: "file",
    path: "p.txt",
    fullTools: false,
    promptAdds: ["x"],
  });
});

test("--prompt-add-N rejects a 0 index, a missing value, and a duplicate", () => {
  expect(parseCliArgs(["--prompt-add-0", "x", "hello"]).kind).toBe("error");
  expect(parseCliArgs(["--prompt-add-1"]).kind).toBe("error");
  expect(parseCliArgs(["--prompt-add-1", "a", "--prompt-add-1", "b", "hello"]).kind).toBe("error");
});

test("-f without a value is an error, not a throw", () => {
  expect(parseCliArgs(["-f"]).kind).toBe("error");
});

// Real-bin smoke test for the stdin guard: empty stdin must fail (exit 1, the single
// non-zero failure code), not hang, not run the panel. This path short-circuits before
// config/fuse, so it needs no API key — but it does need the built bin, so it's skipped
// when ./bin/fusion.js hasn't been built. The TTY-true branch can't be exercised here
// (a spawned child's stdin is a pipe, never a terminal).
const BIN = fileURLToPath(new URL("../bin/fusion.js", import.meta.url));

test.skipIf(!existsSync(BIN))("built bin: empty stdin fails (exit 1) without hanging", () => {
  for (const input of ["", "   \n  "]) {
    const run = spawnSync(process.execPath, [BIN], { input, encoding: "utf8", timeout: 10_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("stdin");
  }
});
