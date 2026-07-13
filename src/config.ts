import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-ai";

/** The reasoning levels Pi accepts (lowercase only; "off" is not one of them). */
export const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/**
 * One model to run plus the reasoning level to run it at. In the config file the two are written
 * as a single string, `provider/model@level` (CFG-030, e.g. `opencode-go/glm-5.1@high`);
 * {@link parseModelSpec} splits them. The level is REQUIRED — there is no default, because a
 * forgotten level would quietly run a model with reasoning off.
 */
export interface ModelSpec {
  /** The bare `provider/model` id (no `@level` suffix). */
  id: string;
  /** Reasoning level to run this model at, parsed from the `@level` suffix. */
  level: ThinkingLevel;
}

/** Two or more reviewers plus one judge, each carrying its own reasoning level. */
export interface RejudgeConfig {
  reviewers: ModelSpec[];
  judge: ModelSpec;
  /** When true, write a per-run JSONL debug log of inner-agent activity. Default false. */
  debugLog: boolean;
}

export function configPath(cwd: string): string {
  return join(cwd, ".rejudge", "config.json");
}

/**
 * Path to the user-global config, used as a fallback when the project has no
 * `.rejudge/config.json`. Honors `XDG_CONFIG_HOME`, else `~/.config`.
 */
export function globalConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "rejudge", "config.json");
}

/** A loaded config plus the file it came from (for CLI diagnostics). */
export interface ResolvedConfig {
  config: RejudgeConfig;
  path: string;
}

/**
 * Resolve config: prefer the project's `<cwd>/.rejudge/config.json`, else fall back to the
 * user-global {@link globalConfigPath}. Throws a clear error naming both paths when neither exists.
 */
export function resolveRejudgeConfig(cwd: string): ResolvedConfig {
  const local = configPath(cwd);
  if (existsSync(local)) return { config: loadRejudgeConfigFromPath(local), path: local };
  const global = globalConfigPath();
  if (existsSync(global)) return { config: loadRejudgeConfigFromPath(global), path: global };
  throw new Error(`no config found: looked in ${local} and ${global}`);
}

/**
 * Load and validate `<cwd>/.rejudge/config.json`.
 *
 * Valid = at least 2 non-empty reviewer model IDs + 1 non-empty judge ID in full
 * provider/model form. Throws a clear error on a missing file, malformed JSON,
 * too few reviewers, or a missing judge — Rejudge must not run on a bad config.
 */
export function loadRejudgeConfig(cwd: string): RejudgeConfig {
  return loadRejudgeConfigFromPath(configPath(cwd));
}

/** Load and validate a config from an explicit file path. See {@link loadRejudgeConfig}. */
export function loadRejudgeConfigFromPath(path: string): RejudgeConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`config not found at ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`config at ${path} is not valid JSON`);
  }

  const cfg = (parsed ?? {}) as Record<string, unknown>;
  const reviewers = cfg.reviewers;
  const judge = cfg.judge;

  if ("panel" in cfg || "synth" in cfg) {
    throw new Error(`config keys "panel" and "synth" are no longer supported — use "reviewers" and "judge"`);
  }

  // The old per-stage `thinking` block is gone (CFG-030) — reasoning level now lives in each model
  // id as a `@level` suffix. A leftover `thinking` key is a half-migrated config: hard-error with a
  // migration hint rather than silently ignore it (the same "silent reasoning off" footgun the
  // suffix exists to prevent).
  if ("thinking" in cfg) {
    throw new Error(
      `config "thinking" is no longer supported — set the reasoning level per model with a "@level" suffix (e.g. "opencode-go/glm-5.1@high")`,
    );
  }

  if (!Array.isArray(reviewers) || reviewers.length < 2 || !reviewers.every((m) => typeof m === "string" && m.trim() !== "")) {
    throw new Error(`config "reviewers" must be at least 2 non-empty model IDs`);
  }
  if (typeof judge !== "string" || judge.trim() === "") {
    throw new Error(`config "judge" must be a non-empty model ID`);
  }

  return {
    reviewers: (reviewers as string[]).map((m, i) => parseModelSpec(m, `reviewers[${i}]`)),
    judge: parseModelSpec(judge, "judge"),
    debugLog: parseDebugLog(cfg.debugLog),
  };
}

/**
 * Resolve the optional `debugLog` flag. Omitted/`null` → `false` (off). A present value
 * must be a boolean; anything else is a config error and throws, consistent with the rest
 * of config validation.
 */
function parseDebugLog(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  throw new Error(`config "debugLog" must be a boolean (got: ${JSON.stringify(value)})`);
}

/**
 * Split a `provider/model@level` config string into a {@link ModelSpec}.
 *
 * The `@level` suffix is REQUIRED (CFG-030): a bare `provider/model` is a config error, not a
 * silent default — forgetting it would quietly run the model with reasoning off. The level after
 * the `@` must be a valid lowercase {@link ThinkingLevel} (`off` is not one). The `provider/model`
 * shape is also checked here as a cheap fail-fast (a typo fails at config-load, not deep inside
 * `resolveModel`, which stays as defense-in-depth). `field` names the offending entry in errors.
 */
function parseModelSpec(raw: string, field: string): ModelSpec {
  const at = raw.lastIndexOf("@");
  if (at === -1) {
    throw new Error(
      `config ${field} "${raw}" must include a reasoning level suffix, e.g. "${raw}@high" (one of: ${VALID_THINKING_LEVELS.join(", ")})`,
    );
  }
  if (at === 0) {
    throw new Error(`config ${field} "${raw}" has an empty model id before the "@level" suffix`);
  }

  const id = raw.slice(0, at);
  const level = raw.slice(at + 1);
  if (!(VALID_THINKING_LEVELS as readonly string[]).includes(level)) {
    throw new Error(
      `config ${field} "${raw}" has an invalid reasoning level "${level}" — must be one of: ${VALID_THINKING_LEVELS.join(", ")}`,
    );
  }

  // Mirror resolveModel's shape check so a malformed id (missing/edge "/") fails at config-load.
  const slash = id.indexOf("/");
  if (slash < 1 || slash === id.length - 1) {
    throw new Error(`config ${field} "${raw}" has a malformed model id "${id}" (expected "provider/model@level")`);
  }

  return { id, level: level as ThinkingLevel };
}
