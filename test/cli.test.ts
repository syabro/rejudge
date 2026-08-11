import { test, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { combinePromptInput, parseCliArgs } from "../src/cli-args.ts";

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

test("a positional instruction combines with non-empty piped input", () => {
  expect(combinePromptInput("review this change", "diff --git a/file b/file\n")).toBe(
    "review this change\n\ndiff --git a/file b/file\n",
  );
  expect(combinePromptInput("review this change", " \n ")).toBe("review this change");

  const args = parseCliArgs(["--resume", "run-123", "--unsafe", "check this"]);
  expect(args).toEqual({
    kind: "prompt",
    text: "check this",
    fullTools: true,
    resume: "run-123",
  });
  if (args.kind === "prompt") {
    expect(combinePromptInput(args.text, "payload")).toBe("check this\n\npayload");
  }
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

const SOURCE_CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("source CLI accepts a positional instruction with piped input", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-cli-combined-input-"));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(cwd, "home"), XDG_CONFIG_HOME: join(cwd, "xdg") };

  try {
    const run = spawnSync("bun", [SOURCE_CLI, "review this change"], {
      cwd,
      env,
      input: "diff payload\n",
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no config found");
    expect(run.stderr).not.toContain("cannot read prompt payload from stdin");
    expect(run.stderr).not.toContain("prompt on stdin is empty");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("source CLI reports fresh and resumed mode before starting review work", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-cli-mode-"));
  mkdirSync(join(cwd, ".rejudge"), { recursive: true });
  writeFileSync(
    join(cwd, ".rejudge", "config.json"),
    JSON.stringify({
      reviewers: ["missing/reviewer-a@minimal", "missing/reviewer-b@minimal"],
      judge: "missing/judge@minimal",
    }),
  );

  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(cwd, "home"), XDG_CONFIG_HOME: join(cwd, "xdg") };
  delete env.OPENCODE_API_KEY;

  try {
    const fresh = spawnSync("bun", [SOURCE_CLI, "review this"], { cwd, env, encoding: "utf8", timeout: 10_000 });
    expect(fresh.status).toBe(1);
    const freshMode = "Mode: fresh — new panel";
    const freshRunning = "running Rejudge on real models";
    expect(fresh.stderr.split("\n").slice(0, 5)).toEqual([
      `config: ${join(realpathSync(cwd), ".rejudge", "config.json")}`,
      "reviewers: missing/reviewer-a@minimal, missing/reviewer-b@minimal | judge: missing/judge@minimal",
      freshMode,
      "read-only: inner agents limited to read/grep/find/ls",
      "running Rejudge on real models (this takes a few minutes)…",
    ]);
    expect(fresh.stderr).toContain(freshMode);
    expect(fresh.stderr.indexOf(freshMode)).toBeLessThan(fresh.stderr.indexOf(freshRunning));
    expect(fresh.stderr.indexOf(freshRunning)).toBeLessThan(fresh.stderr.lastIndexOf("rejudge:"));

    const runId = "2020-01-01T00-00-00-000Z-gone12";
    const resumed = spawnSync("bun", [SOURCE_CLI, "--resume", runId, "follow up"], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(resumed.status).toBe(1);
    const resumedMode = `Mode: resumed — ${runId}`;
    const resumedRunning = `resuming run ${runId}`;
    expect(resumed.stderr).toContain(resumedMode);
    expect(resumed.stderr.indexOf(resumedMode)).toBeLessThan(resumed.stderr.indexOf(resumedRunning));
    expect(resumed.stderr.indexOf(resumedRunning)).toBeLessThan(resumed.stderr.lastIndexOf("rejudge:"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// Real-bin smoke test for the stdin guard: empty stdin must fail (exit 1, the single
// non-zero failure code), not hang, not run the panel. This path short-circuits before
// config/review, so it needs no API key — but it does need the built bin, so it's skipped
// when ./bin/rejudge.js hasn't been built. The TTY-true branch can't be exercised here
// (a spawned child's stdin is a pipe, never a terminal).
const BIN = fileURLToPath(new URL("../bin/rejudge.js", import.meta.url));

test.skipIf(!existsSync(BIN))("built bin: npm-style symlink runs the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "rejudge-bin-link-"));
  const link = join(dir, "rejudge");
  symlinkSync(BIN, link);

  try {
    const run = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8", timeout: 10_000 });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("usage: rejudge");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!existsSync(BIN))("built bin: empty stdin fails (exit 1) without hanging", () => {
  for (const input of ["", "   \n  "]) {
    const run = spawnSync(process.execPath, [BIN], { input, encoding: "utf8", timeout: 10_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("stdin");
  }
});

// --- `rejudge setup ollama` (CLI-087) ---------------------------------------

test("setup ollama is a subcommand, not a prompt", () => {
  expect(parseCliArgs(["setup", "ollama"])).toEqual({
    kind: "setup",
    target: "ollama",
    project: false,
    dryRun: false,
    force: false,
  });
});

test("setup takes --project, --dry-run and --force", () => {
  expect(parseCliArgs(["setup", "ollama", "--project", "--dry-run", "--force"])).toEqual({
    kind: "setup",
    target: "ollama",
    project: true,
    dryRun: true,
    force: true,
  });
});

test("setup without a target is an error that names the target", () => {
  const args = parseCliArgs(["setup"]);
  expect(args.kind).toBe("error");
  expect(args.kind === "error" && args.message).toMatch(/ollama/);
});

test("an unknown setup target is an error that suggests quoting a question", () => {
  const args = parseCliArgs(["setup", "the", "database"]);
  expect(args.kind).toBe("error");
  expect(args.kind === "error" && args.message).toMatch(/quote/i);
});

test("a quoted question starting with the word setup is still a prompt", () => {
  expect(parseCliArgs(["setup ollama for me"])).toEqual({
    kind: "prompt",
    text: "setup ollama for me",
    fullTools: false,
  });
});

test("the setup-only flags are rejected on a review run, instead of being ignored", () => {
  for (const flag of ["--project", "--dry-run", "--force"]) {
    const args = parseCliArgs([flag, "review this"]);
    expect(args.kind, flag).toBe("error");
    expect(args.kind === "error" && args.message, flag).toMatch(/setup/);
  }
});

test("review-run flags are rejected on setup, instead of being ignored", () => {
  for (const flag of ["--unsafe", "--full"]) {
    const args = parseCliArgs(["setup", "ollama", flag]);
    expect(args.kind, flag).toBe("error");
    expect(args.kind === "error" && args.message, flag).toMatch(/review run/);
  }
  expect(parseCliArgs(["setup", "ollama", "--resume", "x"]).kind).toBe("error");
});
