import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildDiffArgs,
  summarizeNumstat,
  formatStat,
  gitDiffTool,
  FILE_CAP_BYTES,
  FULL_CAP_BYTES,
} from "../src/git-diff-tool.ts";

// --- pure helpers (deterministic, no git) ---

test("buildDiffArgs shapes the git argv per mode", () => {
  expect(buildDiffArgs("stat", "HEAD")).toEqual([
    "diff", "HEAD", "-M", "--no-color", "--ignore-submodules=all", "--numstat",
  ]);
  expect(buildDiffArgs("full", "HEAD")).toEqual([
    "diff", "HEAD", "-M", "--no-color", "--ignore-submodules=all",
  ]);
  // file mode puts the agent-supplied path after `--` so it can't be read as an option.
  expect(buildDiffArgs("file", "main", "src/x.ts")).toEqual([
    "diff", "main", "-M", "--no-color", "--ignore-submodules=all", "--", "src/x.ts",
  ]);
});

test("summarizeNumstat totals rows; binary rows count as files, not lines", () => {
  expect(summarizeNumstat("1\t2\ta\n3\t4\tb")).toEqual({ files: 2, insertions: 4, deletions: 6 });
  expect(summarizeNumstat("-\t-\tbin\n5\t0\tc")).toEqual({ files: 2, insertions: 5, deletions: 0 });
  expect(summarizeNumstat("")).toEqual({ files: 0, insertions: 0, deletions: 0 });
});

test("formatStat renders summary, table, and untracked listing", () => {
  const out = formatStat("1\t1\ta.txt", ["new.txt"]);
  expect(out).toContain("1 file changed, 1 insertion(+), 1 deletion(-)");
  expect(out).toContain("1\t1\ta.txt");
  expect(out).toContain("new.txt");
  expect(formatStat("", [])).toBe("No changes against the requested ref.");
});

test("formatStat with only untracked files does not claim '0 files changed'", () => {
  const out = formatStat("", ["new.txt"]);
  expect(out).toContain("No tracked changes.");
  expect(out).toContain("new.txt");
  expect(out).not.toContain("0 files changed");
});

// --- real git smoke (no mocks, no model key) ---

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "rejudge-gitdiff-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.txt"), "line1\nline2\n");
  execFileSync("git", ["add", "a.txt"], { cwd: repo });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: repo },
  );
  return repo;
}

async function run(cwd: string, params: { mode?: string; ref?: string; path?: string }): Promise<string> {
  const res = await gitDiffTool.execute("t", params as never, undefined, undefined, { cwd } as never);
  return (res.content[0] as { text: string }).text;
}

test("stat lists the tracked change and the untracked file", async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "a.txt"), "line1\nCHANGED\n");
  writeFileSync(join(repo, "new.txt"), "brand new\n");

  const out = await run(repo, { mode: "stat" });
  expect(out).toContain("a.txt");
  expect(out).toContain("1 file changed");
  expect(out).toContain("new.txt"); // untracked, surfaced separately
});

test("full returns the unified diff; file scopes to one path", async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "a.txt"), "line1\nCHANGED\n");

  const full = await run(repo, { mode: "full" });
  expect(full).toContain("diff --git a/a.txt b/a.txt");
  expect(full).toContain("+CHANGED");

  const file = await run(repo, { mode: "file", path: "a.txt" });
  expect(file).toContain("+CHANGED");
});

test("mode=file without a path is rejected with guidance", async () => {
  const repo = makeRepo();
  const out = await run(repo, { mode: "file" });
  expect(out.toLowerCase()).toContain("requires a path");
});

test("stat with only an untracked file reports no tracked changes plus the new file", async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "new.txt"), "brand new\n");
  const out = await run(repo, { mode: "stat" });
  expect(out).toContain("No tracked changes.");
  expect(out).toContain("new.txt");
});

test("a commit-range ref is rejected (working-tree-vs-single-ref only)", async () => {
  const repo = makeRepo();
  const out = await run(repo, { mode: "full", ref: "HEAD..HEAD" });
  expect(out).toContain("commit ranges aren't supported");
});

test("a ref that looks like an option is rejected", async () => {
  const repo = makeRepo();
  const out = await run(repo, { mode: "full", ref: "--upload-pack=evil" });
  expect(out.toLowerCase()).toContain("invalid ref");
});

test("path is rejected with stat/full (it only applies to mode=file)", async () => {
  const repo = makeRepo();
  const out = await run(repo, { mode: "stat", path: "a.txt" });
  expect(out).toContain("path only applies to mode=file");
});

test("an unknown ref returns a clean message, not a throw", async () => {
  const repo = makeRepo();
  const out = await run(repo, { mode: "full", ref: "no-such-branch" });
  expect(out).toContain('Cannot diff against "no-such-branch"');
});

test("not a git repository returns a clean message, not a throw", async () => {
  const notRepo = mkdtempSync(join(tmpdir(), "rejudge-notgit-"));
  const out = await run(notRepo, { mode: "stat" });
  expect(out).toBe("Not a git repository.");
});

test("an oversized full diff hard-stops and points at stat/file (no truncation)", async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "big.txt"), "small\n");
  execFileSync("git", ["add", "big.txt"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add big"], { cwd: repo });
  const big = Array.from({ length: 9000 }, (_, i) => `new line ${i} with some padding text`).join("\n");
  writeFileSync(join(repo, "big.txt"), big);
  expect(Buffer.byteLength(big)).toBeGreaterThan(FULL_CAP_BYTES);

  const out = await run(repo, { mode: "full" });
  expect(out).toContain("too large");
  expect(out).toContain("mode=stat");
  expect(out).not.toContain("new line 0");
});

test("an oversized single-file diff hard-stops and points at read (no truncation)", async () => {
  const repo = makeRepo();
  // big.txt must be TRACKED for `git diff HEAD` to show a change to it.
  writeFileSync(join(repo, "big.txt"), "small\n");
  execFileSync("git", ["add", "big.txt"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add big"], { cwd: repo });
  // Now modify it with a change comfortably larger than the file cap.
  const big = Array.from({ length: 5000 }, (_, i) => `new line ${i} with some padding text`).join("\n");
  writeFileSync(join(repo, "big.txt"), big);
  expect(Buffer.byteLength(big)).toBeGreaterThan(FILE_CAP_BYTES);

  const out = await run(repo, { mode: "file", path: "big.txt" });
  expect(out).toContain("too large");
  expect(out).toContain("read");
  expect(out).not.toContain("new line 0"); // hard stop: no diff content leaked
});
