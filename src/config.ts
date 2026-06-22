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

/** A panel of >= 2 models + 1 synthesis model, each carrying its own reasoning level. */
export interface FusionConfig {
  panel: ModelSpec[];
  synth: ModelSpec;
  /** When true, write a per-run JSONL debug log of inner-agent activity. Default false. */
  debugLog: boolean;
}

export function configPath(cwd: string): string {
  return join(cwd, ".pi", "fusion-agents.json");
}

/**
 * Path to the user-global config, used by the CLI as a fallback when the project has no
 * `.pi/fusion-agents.json`. Honors `XDG_CONFIG_HOME`, else `~/.config`.
 */
export function globalConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "fusion-agents.json");
}

/** A loaded config plus the file it came from (for CLI diagnostics). */
export interface ResolvedConfig {
  config: FusionConfig;
  path: string;
}

/**
 * Resolve config for the CLI: prefer the project's `<cwd>/.pi/fusion-agents.json`, else
 * fall back to the user-global {@link globalConfigPath}. Throws a clear error naming both
 * paths when neither exists. (The Pi extension keeps using {@link loadFusionConfig} —
 * cwd-only, with no global fallback.)
 */
export function resolveFusionConfig(cwd: string): ResolvedConfig {
  const local = configPath(cwd);
  if (existsSync(local)) return { config: loadFusionConfigFromPath(local), path: local };
  const global = globalConfigPath();
  if (existsSync(global)) return { config: loadFusionConfigFromPath(global), path: global };
  throw new Error(`no config found: looked in ${local} and ${global}`);
}

/**
 * Load and validate `<cwd>/.pi/fusion-agents.json`.
 *
 * Valid = at least 2 non-empty panel model IDs + 1 non-empty synthesis ID (full
 * provider/model form). Throws a clear error on a missing file, malformed JSON,
 * too few panel models, or missing synthesis ID — `fusion_agents` must not run on a
 * bad config. Config shape beyond these IDs is deferred.
 */
export function loadFusionConfig(cwd: string): FusionConfig {
  return loadFusionConfigFromPath(configPath(cwd));
}

/** Load and validate a config from an explicit file path. See {@link loadFusionConfig}. */
export function loadFusionConfigFromPath(path: string): FusionConfig {
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
  const panel = cfg.panel;
  const synth = cfg.synth;

  // The old per-stage `thinking` block is gone (CFG-030) — reasoning level now lives in each model
  // id as a `@level` suffix. A leftover `thinking` key is a half-migrated config: hard-error with a
  // migration hint rather than silently ignore it (the same "silent reasoning off" footgun the
  // suffix exists to prevent).
  if ("thinking" in cfg) {
    throw new Error(
      `config "thinking" is no longer supported — set the reasoning level per model with a "@level" suffix (e.g. "opencode-go/glm-5.1@high")`,
    );
  }

  if (!Array.isArray(panel) || panel.length < 2 || !panel.every((m) => typeof m === "string" && m.trim() !== "")) {
    throw new Error(`config "panel" must be at least 2 non-empty model IDs`);
  }
  if (typeof synth !== "string" || synth.trim() === "") {
    throw new Error(`config "synth" must be a non-empty model ID`);
  }

  return {
    panel: (panel as string[]).map((m, i) => parseModelSpec(m, `panel[${i}]`)),
    synth: parseModelSpec(synth, "synth"),
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
