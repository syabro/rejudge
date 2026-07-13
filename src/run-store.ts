import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { VALID_THINKING_LEVELS } from "./config.ts";
import { JUDGE_ROLE_KEY, panelRoleKey, type RoleKey } from "./events.ts";

/**
 * SYN-029 run store. A persisted review run lives in the OS temp dir so a later, separate
 * invocation can resume the same reviewer and judge sessions. The session
 * JSONL is written and restored by the SDK's SessionManager; this module owns only the
 * run-level grouping the SDK doesn't know about: the runId, the per-run directory, a small
 * manifest (which role and model own each file, plus the run's config), and TTL garbage collection.
 *
 * Everything here is best-effort — a persistence failure must never break a live run, so the
 * writes swallow their errors. Temp by design: runs are ephemeral, GC'd after {@link RUN_TTL_MS},
 * and the OS clears /tmp on its own. The host's `/resume` list (which scans
 * `~/.pi/agent/sessions/<encoded-cwd>/`) never sees these — different directory entirely.
 */

/** How long a run stays resumable. After this it's GC'd. */
export const RUN_TTL_MS = 24 * 60 * 60 * 1000; // 24h — SYN-029.

/** A runId: an ISO timestamp with `:`/`.` turned into `-` (see newRunId), then `-<rand>`. The
 *  shape is exact (`YYYY-MM-DDTHH-MM-SS-mmmZ-rand`) so GC only ever rm's our own run dirs. */
const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{1,8}$/;

const MANIFEST = "manifest.json";

export interface RunSessionRef {
  /** Stable internal address for this session. */
  roleKey: RoleKey;
  /** The bare `provider/model` id this session ran on. */
  modelId: string;
  /** Reasoning level the session ran at — re-applied on resume (CFG-030). */
  level: ThinkingLevel;
  /** Absolute path to the session JSONL the SDK wrote. */
  file: string;
}

/** Current manifest format version. Version 4 persists stable role keys. */
const MANIFEST_VERSION = 4;

export interface RunManifest {
  /** Format version, so incompatible ephemeral runs fail closed instead of resuming incorrectly. */
  version: typeof MANIFEST_VERSION;
  runId: string;
  /** Resolved cwd the run operated in — the resume guard (must match the resuming cwd). */
  cwd: string;
  createdAt: string;
  /** Whether the run used the full (write) tool set — re-applied on resume, never widened. */
  fullTools: boolean;
  reviewers: RunSessionRef[];
  judge: RunSessionRef;
}

/** Root for all persisted runs, e.g. `/tmp/rejudge/runs`. */
export function runsRoot(): string {
  return join(tmpdir(), "rejudge", "runs");
}

/** The directory for one run. The SDK writes each session's JSONL into here. */
export function runDir(runId: string): string {
  return join(runsRoot(), runId);
}

/**
 * A sortable, unique runId: an ISO timestamp (`:`/`.` → `-`) plus a short random tail — the
 * same scheme {@link createDebugLog} uses, so a run's sessions and its debug log can share an id.
 */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

/** Write the manifest as the LAST step of a run — its presence marks the run complete/resumable. */
export function writeManifest(manifest: RunManifest): void {
  try {
    const dir = runDir(manifest.runId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, MANIFEST);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    renameSync(tmp, path); // atomic commit — a reader never sees a half-written manifest.
  } catch {
    // Best-effort: a manifest write failure just means this run won't be resumable.
  }
}

/** True if x has the shape of a {@link RunSessionRef}, including a valid reasoning level. */
function isSessionRef(x: unknown): x is RunSessionRef {
  const ref = x as RunSessionRef;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof ref.roleKey === "string" &&
    typeof ref.modelId === "string" &&
    typeof ref.file === "string" &&
    typeof ref.level === "string" &&
    (VALID_THINKING_LEVELS as readonly string[]).includes(ref.level)
  );
}

/**
 * Read a run's manifest, or undefined if missing / unreadable / malformed. Validates EVERY field
 * the resume path then uses unguarded (version, cwd, fullTools, reviewer/judge refs and levels)
 * — a malformed or older manifest must read as "no such run", never let resume use stale role data.
 * Runs are ephemeral, so incompatible versions simply read as expired.
 */
export function readManifest(runId: string): RunManifest | undefined {
  try {
    const m = JSON.parse(readFileSync(join(runDir(runId), MANIFEST), "utf8")) as RunManifest;
    const valid =
      m &&
      m.version === MANIFEST_VERSION &&
      typeof m.runId === "string" &&
      typeof m.cwd === "string" &&
      typeof m.fullTools === "boolean" &&
      Array.isArray(m.reviewers) &&
      m.reviewers.every(
        (reviewer, index) => isSessionRef(reviewer) && reviewer.roleKey === panelRoleKey(index),
      ) &&
      isSessionRef(m.judge) &&
      m.judge.roleKey === JUDGE_ROLE_KEY;
    return valid ? m : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Delete run dirs whose last activity is older than ttlMs. Cheap — one statSync per dir (the dir
 * mtime), no content reads. Only touches dirs whose name matches the runId pattern, so anything
 * else under the temp root is left alone (also reaps a crashed run that never wrote a manifest).
 * Best-effort: a concurrent GC racing to rm the same dir just hits ENOENT, which is swallowed.
 */
export function gcExpired(now: number, ttlMs: number = RUN_TTL_MS): void {
  let entries: string[];
  try {
    entries = readdirSync(runsRoot());
  } catch {
    return; // root doesn't exist yet — nothing to GC.
  }
  for (const name of entries) {
    if (!RUN_ID_RE.test(name)) continue;
    try {
      const dir = join(runsRoot(), name);
      if (now - statSync(dir).mtimeMs > ttlMs) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // A vanished dir or a permission hiccup must not break the run.
    }
  }
}
