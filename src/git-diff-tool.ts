import { spawn } from "node:child_process";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

/**
 * The custom read-only `git_diff` tool (TLS-026). It lets a read-only inner agent fetch the
 * working-tree diff itself for a code review, instead of depending on the diff being pasted
 * into the prompt. It only ever reads git state — never modifies the repo.
 *
 * Shape: `mode` picks the detail level, `ref` the comparison base, `path` scopes a single
 * file. The diff is ALWAYS "working tree vs `ref`" — the full uncommitted change, staged or
 * not — never a commit range.
 */

export const GIT_DIFF_TOOL_NAME = "git_diff";

/**
 * Per-mode size caps (bytes). Over the cap the tool returns a hard stop with guidance and
 * NO diff content — there is deliberately no truncation (a chopped unified diff is malformed
 * and silently drops files; TLS-026). `stat` is the cheap map, so its cap is mostly a
 * pathological-repo backstop.
 */
export const STAT_CAP_BYTES = 100_000;
export const FULL_CAP_BYTES = 200_000;
export const FILE_CAP_BYTES = 100_000;

export type GitDiffMode = "stat" | "full" | "file";

const parameters = Type.Object({
  mode: Type.Optional(
    Type.Union([Type.Literal("stat"), Type.Literal("full"), Type.Literal("file")], {
      default: "stat",
      description:
        "stat (default) = the change map: which files changed, line counts, and untracked " +
        "files. full = the entire unified diff. file = the diff of one file/dir (needs path).",
    }),
  ),
  ref: Type.Optional(
    Type.String({
      default: "HEAD",
      description:
        "What to diff the working tree against — a branch name or commit hash. " +
        "Default HEAD (all uncommitted changes). Use e.g. a base branch to review committed work.",
    }),
  ),
  path: Type.Optional(
    Type.String({
      description: "File or directory to scope the diff to. Only used with mode=file.",
    }),
  ),
});

/**
 * Build the argv for one `git diff` run. `-M` detects renames (else a rename reads as a
 * delete + add), `--ignore-submodules=all` keeps submodule churn out, and for `file` mode the
 * `--` separator makes the agent-supplied path a pathspec, never an option (injection-safe).
 * Pure.
 */
export function buildDiffArgs(mode: GitDiffMode, ref: string, path?: string): string[] {
  const base = ["diff", ref, "-M", "--no-color", "--ignore-submodules=all"];
  if (mode === "stat") return [...base, "--numstat"];
  if (mode === "file") return [...base, "--", path as string];
  return base;
}

/**
 * Sum a `--numstat` block into totals. Each row is `insertions\tdeletions\tpath`; a binary
 * file shows `-` for both, counted as a changed file but not as lines. Pure.
 */
export function summarizeNumstat(numstat: string): {
  files: number;
  insertions: number;
  deletions: number;
} {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    if (line.trim() === "") continue;
    files++;
    const [ins, del] = line.split("\t");
    if (ins !== "-") {
      insertions += Number(ins) || 0;
    }
    if (del !== "-") {
      deletions += Number(del) || 0;
    }
  }
  return { files, insertions, deletions };
}

/**
 * Render `stat` output: a shortstat-style summary line, the numstat table, then any untracked
 * files (new files git diff never shows on its own — the agent reads their content with the
 * `read` tool). Pure.
 */
export function formatStat(numstat: string, untracked: string[]): string {
  const { files, insertions, deletions } = summarizeNumstat(numstat);
  if (files === 0 && untracked.length === 0) {
    return "No changes against the requested ref.";
  }

  const plural = (n: number) => (n === 1 ? "" : "s");
  const parts: string[] = [];

  if (files === 0) {
    parts.push("No tracked changes.");
  } else {
    parts.push(
      `${files} file${plural(files)} changed, ${insertions} insertion${plural(insertions)}(+), ${deletions} deletion${plural(deletions)}(-)`,
    );
    const table = numstat.trim();
    if (table) {
      parts.push(table);
    }
  }

  if (untracked.length) {
    parts.push("untracked (new files, not yet in git — read them with the read tool):");
    parts.push(...untracked.map((p) => `  ${p}`));
  }

  return parts.join("\n");
}

interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: NodeJS.ErrnoException;
}

/**
 * Run `git <args>` in `cwd` and collect stdout/stderr. Never throws — a spawn failure (git
 * missing, abort) comes back as `spawnError`. The abort signal is wired to the child so a
 * cancelled agent doesn't leave git running.
 */
function runGit(args: string[], cwd: string, signal?: AbortSignal): Promise<GitResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", args, { cwd, signal });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: "", spawnError: e as NodeJS.ErrnoException });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: null, stdout, stderr, spawnError: e }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Map a non-clean git run to a human-readable message, or null when it succeeded. */
function gitError(r: GitResult, ref: string): string | null {
  if (r.spawnError) {
    if (r.spawnError.code === "ENOENT") return "git is not installed or not on PATH.";
    if (r.spawnError.name === "AbortError") return "git diff was cancelled.";
    return `git could not run: ${r.spawnError.message}`;
  }
  if (r.code !== 0) {
    const msg = r.stderr.trim() || `git exited with code ${r.code}`;
    if (/not a git repository/i.test(msg)) return "Not a git repository.";
    if (ref === "HEAD" && /ambiguous argument 'HEAD'|unknown revision/i.test(msg)) {
      return "No commits yet — nothing to diff against HEAD.";
    }
    if (/unknown revision|bad revision|ambiguous argument/i.test(msg)) {
      return `Cannot diff against "${ref}": ${msg}`;
    }
    return msg;
  }
  return null;
}

export const gitDiffTool = defineTool({
  name: GIT_DIFF_TOOL_NAME,
  label: "git diff",
  description:
    "Show git working-tree changes vs a ref (default HEAD) — for code review. Start with " +
    "mode=stat (default) to see WHICH files changed; then mode=full for the whole diff, or " +
    "mode=file with a path for one file/dir. New (untracked) files appear in the stat list — " +
    "read their content with the read tool. Read-only: never modifies the repo.",
  parameters,
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const cwd = ctx.cwd;
    const mode: GitDiffMode = (params.mode as GitDiffMode | undefined) ?? "stat";
    const ref = (params.ref ?? "HEAD").trim() || "HEAD";
    const path = params.path?.trim();

    const text = (t: string) => ({
      content: [{ type: "text" as const, text: t }],
      details: { mode, ref, path },
    });

    if (ref.startsWith("-")) {
      return text(`Invalid ref "${ref}": pass a branch name or commit hash, not an option.`);
    }
    if (ref.includes("..")) {
      return text(`Invalid ref "${ref}": commit ranges aren't supported — pass a single branch or commit.`);
    }
    if (path && mode !== "file") {
      return text("path only applies to mode=file — use mode=file to diff a single path, or drop path.");
    }
    if (mode === "file" && !path) {
      return text("mode=file requires a path — pass the file or directory to diff.");
    }

    if (mode === "stat") {
      const diff = await runGit(buildDiffArgs("stat", ref), cwd, signal);
      const failed = gitError(diff, ref);
      if (failed) return text(failed);

      const untrackedRun = await runGit(["ls-files", "--others", "--exclude-standard"], cwd, signal);
      const untracked = (untrackedRun.code === 0 ? untrackedRun.stdout : "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const out = formatStat(diff.stdout, untracked);
      if (Buffer.byteLength(out) > STAT_CAP_BYTES) {
        return text(
          `Change map too large (${Buffer.byteLength(out)} bytes). ` +
            "Use mode=file with a path to inspect specific parts of the tree.",
        );
      }
      return text(out);
    }

    const cap = mode === "file" ? FILE_CAP_BYTES : FULL_CAP_BYTES;
    const diff = await runGit(buildDiffArgs(mode, ref, path), cwd, signal);
    const failed = gitError(diff, ref);
    if (failed) return text(failed);

    const out = diff.stdout;
    if (out.trim() === "") {
      return text(mode === "file" ? `No changes in ${path} against ${ref}.` : `No changes against ${ref}.`);
    }
    if (Buffer.byteLength(out) > cap) {
      const guide =
        mode === "file"
          ? `Diff for ${path} is too large (${Buffer.byteLength(out)} bytes) — read the file directly with the read tool.`
          : `Diff is too large (${Buffer.byteLength(out)} bytes). Call mode=stat to see which files changed, then mode=file with a path to read specific ones.`;
      return text(guide);
    }
    return text(out);
  },
});
