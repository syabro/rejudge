// The file side of `rejudge setup ollama` (CLI-087): resolve where things go, read what is already
// there, and write the provider and panel. The decisions live in `setup-ollama.ts`, which stays free
// of I/O; the daemon's HTTP is `fetchDaemonModels` below, the only part that needs a live Ollama.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { err, ok, type Result } from "neverthrow";
import { configPath, globalConfigPath } from "./config.ts";
import {
  buildOllamaProvider,
  ineligibleReason,
  isCloudProxy,
  mergeProviderInto,
  parseDaemonModels,
  proposePanel,
  type DaemonModel,
  type IneligibleReason,
  type PanelProposal,
} from "./setup-ollama.ts";

/** Where the local daemon answers unless told otherwise. */
export const DAEMON_URL = "http://127.0.0.1:11434";

/** The reasoning level written for every model in a generated panel. */
const PANEL_LEVEL = "high";

/** The provider key the generated models are addressed under. */
const PROVIDER = "ollama";

/** The two files a setup run touches. */
export interface SetupPaths {
  /** Pi's user-wide provider file — the only place a custom provider can live. */
  modelsJson: string;
  /** Where the panel goes: the user-wide Rejudge config, or the project one with `--project`. */
  config: string;
}

export interface SetupOptions {
  cwd: string;
  project: boolean;
  dryRun: boolean;
  force: boolean;
}

/** What a run did, in enough detail to print without re-reading the files. */
export interface SetupReport {
  paths: SetupPaths;
  /** Model ids declared in the provider, in the order written. */
  declared: string[];
  /** Models the daemon offered that cannot serve a review, with why. */
  excluded: { id: string; reason: IneligibleReason }[];
  panel: PanelProposal;
  /** True when this run only described itself. Carried, not inferred, so the wording cannot drift. */
  dryRun: boolean;
  wroteModels: boolean;
  wroteConfig: boolean;
  /** The existing Rejudge config this run leaves alone — decided even on a dry run. */
  configKept?: string;
  /** Where the previous `models.json` goes before being replaced — decided even on a dry run. */
  modelsBackup?: string;
  /**
   * A project config that would win over the user-wide panel this run writes. Reviews resolve the
   * project file first, so without this the user approves a panel their own repo never uses.
   */
  shadowedBy?: string;
}

/**
 * Resolve both target paths. Read at call time, not at import, so `PI_CODING_AGENT_DIR` and
 * `XDG_CONFIG_HOME` behave the way they do everywhere else in Pi and Rejudge.
 */
export function setupPaths(cwd: string, project: boolean): SetupPaths {
  return {
    modelsJson: `${getAgentDir()}/models.json`,
    config: project ? configPath(cwd) : globalConfigPath(),
  };
}

/**
 * Ask the daemon what it has. This is the whole network surface of setup: no catalog is fetched and
 * nothing is pulled, so the answer is exactly the list the user curated. A daemon that is not
 * running is the common case and gets a message that says what to start.
 */
export async function fetchDaemonModels(
  daemonUrl = DAEMON_URL,
  signal?: AbortSignal,
): Promise<Result<DaemonModel[], string>> {
  let response: Response;
  try {
    response = await fetch(`${daemonUrl}/api/tags`, { signal });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return err(`cannot reach the Ollama daemon at ${daemonUrl} (${reason}) — is \`ollama serve\` running?`);
  }

  if (!response.ok) {
    return err(`the Ollama daemon at ${daemonUrl} answered ${response.status} for /api/tags`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return err(`the Ollama daemon at ${daemonUrl} returned something other than JSON for /api/tags`);
  }

  return ok(parseDaemonModels(payload));
}

/** Read a JSON file that may not exist. Absent is fine; malformed is not — it is the user's file. */
function readExistingJson(path: string): Result<unknown, string> {
  if (!existsSync(path)) return ok(undefined);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return err(`cannot read ${path} (${e instanceof Error ? e.message : String(e)})`);
  }

  try {
    return ok(JSON.parse(raw));
  } catch {
    return err(`${path} is not valid JSON — fix or move it, then run setup again`);
  }
}

/**
 * Write a JSON file, reporting a failure as a value like everything else here. An unwritable target
 * is ordinary on a fresh machine — a read-only agent directory, a project checkout someone owns
 * differently — and it should read as "this directory is not writable", not as a stack trace from the
 * tool you just installed.
 */
function writeJson(path: string, value: unknown): Result<void, string> {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    return ok(undefined);
  } catch (e) {
    return err(`cannot write ${path} (${e instanceof Error ? e.message : String(e)})`);
  }
}

/** Copy a file, as a value. Same reasoning as {@link writeJson}. */
function copyFile(from: string, to: string): Result<void, string> {
  try {
    copyFileSync(from, to);
    return ok(undefined);
  } catch (e) {
    return err(`cannot back up ${from} to ${to} (${e instanceof Error ? e.message : String(e)})`);
  }
}

/**
 * Do the setup for a daemon listing that has already been fetched.
 *
 * Everything that can fail is checked before anything is written: too few usable models, and a
 * `models.json` we cannot parse. That file is the user's — it carries the credentials and overrides
 * for every other provider — so it is copied to `.bak` before being replaced, and only the `ollama`
 * key inside it is ours to change.
 *
 * An existing Rejudge config is left alone unless `force` is set: a panel someone tuned is worth more
 * than a generated one, and the report says which file was kept so the caller can mention it.
 */
export function runOllamaSetup(models: DaemonModel[], options: SetupOptions): Result<SetupReport, string> {
  const paths = setupPaths(options.cwd, options.project);

  const excluded = models.flatMap((model) => {
    const reason = ineligibleReason(model);
    return reason ? [{ id: model.id, reason }] : [];
  });

  const panel = proposePanel(models);
  if (panel.isErr()) return err(panel.error);

  const existing = readExistingJson(paths.modelsJson);
  if (existing.isErr()) return err(existing.error);

  const provider = buildOllamaProvider(models);
  const merged = mergeProviderInto(existing.value, provider);
  const declared = provider.models.map((model) => model.id);

  // Both decisions are made before the dry-run return, so a preview describes the run it is
  // previewing. Deciding after it is what made `--dry-run` claim it would overwrite a config that a
  // real run leaves alone — and the guide tells people to try the dry run first.
  const modelsBackup = existing.value !== undefined ? `${paths.modelsJson}.bak` : undefined;
  const configKept = existsSync(paths.config) && !options.force ? paths.config : undefined;

  // A user-wide panel is invisible inside a project that has its own config, because reviews resolve
  // the project file first. Saying nothing here means the user approves a panel their repo ignores.
  const projectConfig = configPath(options.cwd);
  const shadowedBy = !options.project && existsSync(projectConfig) ? projectConfig : undefined;

  const report: SetupReport = {
    paths,
    declared,
    excluded,
    panel: panel.value,
    dryRun: options.dryRun,
    wroteModels: false,
    wroteConfig: false,
    ...(modelsBackup ? { modelsBackup } : {}),
    ...(configKept ? { configKept } : {}),
    ...(shadowedBy ? { shadowedBy } : {}),
  };
  if (options.dryRun) return ok(report);

  // Back up before replacing, and stop if the backup fails: a half-replaced file that carries every
  // other provider's credentials is the outcome worth the most care.
  if (modelsBackup) {
    const copied = copyFile(paths.modelsJson, modelsBackup);
    if (copied.isErr()) return err(copied.error);
  }

  const wroteModels = writeJson(paths.modelsJson, merged);
  if (wroteModels.isErr()) return err(wroteModels.error);
  report.wroteModels = true;

  if (configKept) return ok(report);

  const wroteConfig = writeJson(paths.config, {
    reviewers: panel.value.reviewers.map(configId),
    judge: configId(panel.value.judge),
    debugLog: false,
  });
  if (wroteConfig.isErr()) return err(wroteConfig.error);
  report.wroteConfig = true;

  return ok(report);
}

/** A daemon model id as a Rejudge config entry: provider-prefixed and carrying its level. */
function configId(id: string): string {
  return `${PROVIDER}/${id}@${PANEL_LEVEL}`;
}

/** Why a model was skipped, said in words — the reader should not have to look up a code. */
const SKIP_REASON: Record<IneligibleReason, string> = {
  "no-thinking": "does not report thinking, so its reasoning level would silently be off",
  "no-tools": "does not report tools, so it could not read the diff",
  "no-context": "reports no context window, so any value written here would be a guess",
};

/**
 * Render a run so the result is inspectable without opening the JSON: the files, the exact panel in
 * the form the config uses, whatever was skipped and why, and whether the panel actually spans
 * different labs — which is the only reason to run more than one model.
 */
export function formatSetupReport(report: SetupReport): string {
  const lines: string[] = [];
  // Past tense for what happened, future for what a dry run only describes. The backup line has a
  // different subject ("previous file"), so it needs the passive rather than the same verb.
  const wrote = report.dryRun ? "would write" : "wrote";
  const keeps = report.dryRun ? "would keep" : "kept";
  const isKept = report.dryRun ? "would be kept" : "kept";

  lines.push(`Ollama setup — ${report.declared.length} models declared, ${report.excluded.length} skipped`);
  lines.push("");

  lines.push(`provider  ${wrote} ${report.paths.modelsJson}`);
  if (report.modelsBackup) {
    lines.push(`          previous file ${isKept} at ${report.modelsBackup}`);
  }

  if (report.configKept) {
    lines.push(`config    ${keeps} ${report.configKept} — pass --force to replace it with the panel below`);
  } else {
    lines.push(`config    ${wrote} ${report.paths.config}`);
  }

  lines.push("");
  lines.push("panel");
  for (const reviewer of report.panel.reviewers) {
    lines.push(`  reviewer  ${configId(reviewer)}`);
  }
  lines.push(`  judge     ${configId(report.panel.judge)}`);
  lines.push(
    report.panel.diverse
      ? "  every slot comes from a different lab"
      : "  some slots reuse the same lab — models that share weights share their blind spots",
  );
  lines.push("  a retired or out-of-plan cloud model can only fail at first use, with a 410 or a 402;");
  lines.push("  the daemon's list does not show either, so this command cannot check it for you");

  if (report.shadowedBy) {
    lines.push("");
    lines.push(`note      ${report.shadowedBy} takes precedence over the config above,`);
    lines.push("          so reviews in this project keep using it — re-run with --project to replace it");
  }

  // A local model's declared window is the model's maximum, not what the daemon serves — and Ollama
  // truncates an overflow silently, which Rejudge reports as a clean run. Say so once, listing the
  // models it applies to, rather than leaving the reader to discover it from a confident wrong review.
  const local = report.declared.filter((id) => !isCloudProxy(id));
  if (local.length > 0) {
    lines.push("");
    lines.push("local models — their context window is the model's maximum, not what your daemon serves:");
    for (const id of local) {
      lines.push(`  ${id}`);
    }
    lines.push("  start the daemon with OLLAMA_CONTEXT_LENGTH set to that number, or lower the");
    lines.push("  contextWindow to match it — Ollama truncates an overflow silently, and a truncated");
    lines.push("  review still looks like a successful one.");
  }

  if (report.excluded.length > 0) {
    lines.push("");
    lines.push("skipped");
    const width = Math.max(...report.excluded.map((entry) => entry.id.length));
    for (const entry of report.excluded) {
      lines.push(`  ${entry.id.padEnd(width)}  ${SKIP_REASON[entry.reason]}`);
    }
  }

  if (report.dryRun) {
    lines.push("");
    lines.push("nothing was written (--dry-run)");
  }

  return lines.join("\n");
}
