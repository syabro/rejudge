import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Spike config: exactly 3 panel model IDs + 1 synthesis model ID. */
export interface FusionConfig {
  panel: string[];
  synth: string;
}

export function configPath(cwd: string): string {
  return join(cwd, ".pi", "fusion-agents.json");
}

/**
 * Load and validate `<cwd>/.pi/fusion-agents.json`.
 *
 * Valid = exactly 3 non-empty panel model IDs + 1 non-empty synthesis ID (full
 * provider/model form). Throws a clear error on a missing file, malformed JSON,
 * wrong panel count, or missing synthesis ID — `fusion_agents` must not run on a
 * bad config. Config shape beyond these IDs is deferred.
 */
export function loadFusionConfig(cwd: string): FusionConfig {
  const path = configPath(cwd);

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

  if (!Array.isArray(panel) || panel.length !== 3 || !panel.every((m) => typeof m === "string" && m.trim() !== "")) {
    throw new Error(`config "panel" must be exactly 3 non-empty model IDs`);
  }
  if (typeof synth !== "string" || synth.trim() === "") {
    throw new Error(`config "synth" must be a non-empty model ID`);
  }

  return { panel: panel as string[], synth };
}
