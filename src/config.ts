import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-ai";

/** The thinking levels Pi accepts (lowercase only; "off" is not one of them). */
const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/**
 * Default thinking level per stage when the config omits it. Panel agents do the
 * real work and stay at max; synthesis only fuses, so it defaults lower to save
 * cost/time.
 */
const DEFAULT_THINKING: ThinkingConfig = { panel: "xhigh", synth: "medium" };

/** Thinking level per fusion stage. */
export interface ThinkingConfig {
  panel: ThinkingLevel;
  synth: ThinkingLevel;
}

/** A panel of >= 2 model IDs + 1 synthesis model ID. */
export interface FusionConfig {
  panel: string[];
  synth: string;
  /** Thinking level per stage; always populated (defaults applied at load). */
  thinking: ThinkingConfig;
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

  if (!Array.isArray(panel) || panel.length < 2 || !panel.every((m) => typeof m === "string" && m.trim() !== "")) {
    throw new Error(`config "panel" must be at least 2 non-empty model IDs`);
  }
  if (typeof synth !== "string" || synth.trim() === "") {
    throw new Error(`config "synth" must be a non-empty model ID`);
  }

  return {
    panel: panel as string[],
    synth,
    thinking: parseThinking(cfg.thinking),
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
 * Resolve the optional `thinking` block to a fully-populated {@link ThinkingConfig}.
 *
 * The whole block may be omitted or `null` → both stages default. A present block must
 * be an object; each sub-field may be omitted (→ that stage defaults). But once a
 * sub-field is present it must be a valid lowercase {@link ThinkingLevel}: a non-object
 * block, or a sub-field that is `null`, a number, wrong-case, or `"off"`, is a config
 * error and throws (only an absent key falls back — `null` does not). Consistent with
 * the rest of config validation.
 */
function parseThinking(value: unknown): ThinkingConfig {
  if (value === undefined || value === null) return { ...DEFAULT_THINKING };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`config "thinking" must be an object with optional "panel"/"synth" levels`);
  }
  const obj = value as Record<string, unknown>;
  return {
    panel: parseThinkingLevel(obj.panel, "panel", DEFAULT_THINKING.panel),
    synth: parseThinkingLevel(obj.synth, "synth", DEFAULT_THINKING.synth),
  };
}

function parseThinkingLevel(value: unknown, field: string, fallback: ThinkingLevel): ThinkingLevel {
  if (value === undefined) return fallback;
  if (typeof value === "string" && (VALID_THINKING_LEVELS as readonly string[]).includes(value)) {
    return value as ThinkingLevel;
  }
  throw new Error(
    `config "thinking.${field}" must be one of: ${VALID_THINKING_LEVELS.join(", ")} (got: ${JSON.stringify(value)})`,
  );
}
