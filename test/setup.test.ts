import { test, expect } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchDaemonModels, formatSetupReport, runOllamaSetup, setupPaths } from "../src/setup.ts";
import type { DaemonModel } from "../src/setup-ollama.ts";

// Real files in temp dirs, no mocks: the daemon listing is injected (its HTTP has its own live
// test), everything below it is the actual read/merge/write path.

const FOUR_LABS: DaemonModel[] = [
  { id: "glm-5.2:cloud", contextLength: 1000000, thinking: true, tools: true },
  { id: "deepseek-v4-pro:cloud", contextLength: 524288, thinking: true, tools: true },
  { id: "minimax-m3:cloud", contextLength: 524288, thinking: true, tools: true },
  { id: "gemma4:31b-cloud", contextLength: 262144, thinking: true, tools: true },
];

/** An isolated Pi agent dir + XDG home + project dir, so nothing touches the real machine. */
function sandbox(): { cwd: string; agentDir: string; xdg: string; restore: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-setup-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-setup-agent-"));
  const xdg = mkdtempSync(join(tmpdir(), "rejudge-setup-xdg-"));

  const prevAgent = process.env.PI_CODING_AGENT_DIR;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.XDG_CONFIG_HOME = xdg;

  const restore = (): void => {
    if (prevAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgent;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
  };

  return { cwd, agentDir, xdg, restore };
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("the panel goes to the user-wide config by default and the project one with --project", () => {
  const box = sandbox();
  try {
    expect(setupPaths(box.cwd, false).config).toBe(join(box.xdg, "rejudge", "config.json"));
    expect(setupPaths(box.cwd, true).config).toBe(join(box.cwd, ".rejudge", "config.json"));
    expect(setupPaths(box.cwd, false).modelsJson).toBe(join(box.agentDir, "models.json"));
  } finally {
    box.restore();
  }
});

test("a first run writes both files, creating the directories they live in", () => {
  const box = sandbox();
  try {
    const report = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false });
    const value = report._unsafeUnwrap();

    expect(value.wroteModels).toBe(true);
    expect(value.wroteConfig).toBe(true);
    expect(readJson(value.paths.modelsJson).providers.ollama.models).toHaveLength(4);
    expect(readJson(value.paths.config).judge).toBe("ollama/glm-5.2:cloud@high");
    expect(readJson(value.paths.config).reviewers).toHaveLength(3);
  } finally {
    box.restore();
  }
});

test("every written model id carries the ollama prefix and a reasoning level", () => {
  const box = sandbox();
  try {
    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false })._unsafeUnwrap();
    const config = readJson(value.paths.config);

    for (const id of [...config.reviewers, config.judge]) {
      expect(id).toMatch(/^ollama\/.+@high$/);
    }
  } finally {
    box.restore();
  }
});

test("an existing models.json keeps its other providers and is backed up first", () => {
  const box = sandbox();
  try {
    const modelsJson = join(box.agentDir, "models.json");
    const before = { providers: { "opencode-go": { apiKey: "$OPENCODE_API_KEY" } } };
    writeFileSync(modelsJson, JSON.stringify(before));

    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false })._unsafeUnwrap();

    expect(readJson(modelsJson).providers["opencode-go"]).toEqual(before.providers["opencode-go"]);
    expect(value.modelsBackup).toBeDefined();
    expect(readJson(value.modelsBackup as string)).toEqual(before);
  } finally {
    box.restore();
  }
});

test("a models.json that is not valid JSON is a failure, and nothing is written", () => {
  const box = sandbox();
  try {
    const modelsJson = join(box.agentDir, "models.json");
    writeFileSync(modelsJson, "{ this is not json");

    const report = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false });

    expect(report.isErr()).toBe(true);
    expect(report._unsafeUnwrapErr()).toMatch(/not valid JSON/);
    expect(readFileSync(modelsJson, "utf8")).toBe("{ this is not json");
    expect(existsSync(join(box.xdg, "rejudge", "config.json"))).toBe(false);
  } finally {
    box.restore();
  }
});

test("an existing Rejudge config is kept, and the report says so", () => {
  const box = sandbox();
  try {
    const config = join(box.xdg, "rejudge", "config.json");
    mkdirSync(join(box.xdg, "rejudge"), { recursive: true });
    writeFileSync(config, JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "c/3@high" }));

    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false })._unsafeUnwrap();

    expect(value.wroteConfig).toBe(false);
    expect(value.configKept).toBe(config);
    expect(readJson(config).judge).toBe("c/3@high");
    expect(value.wroteModels).toBe(true);
  } finally {
    box.restore();
  }
});

test("--force replaces an existing config", () => {
  const box = sandbox();
  try {
    const config = join(box.xdg, "rejudge", "config.json");
    mkdirSync(join(box.xdg, "rejudge"), { recursive: true });
    writeFileSync(config, JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "c/3@high" }));

    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: true })._unsafeUnwrap();

    expect(value.wroteConfig).toBe(true);
    expect(readJson(config).judge).toBe("ollama/glm-5.2:cloud@high");
  } finally {
    box.restore();
  }
});

test("--dry-run touches nothing but still reports what it would do", () => {
  const box = sandbox();
  try {
    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: true, force: false })._unsafeUnwrap();

    expect(value.wroteModels).toBe(false);
    expect(value.wroteConfig).toBe(false);
    expect(value.declared).toHaveLength(4);
    expect(value.panel.judge).toBe("glm-5.2:cloud");
    expect(existsSync(value.paths.modelsJson)).toBe(false);
    expect(existsSync(value.paths.config)).toBe(false);
  } finally {
    box.restore();
  }
});

test("models that cannot serve a review are reported with the reason, not written", () => {
  const box = sandbox();
  try {
    const listing: DaemonModel[] = [
      ...FOUR_LABS,
      { id: "qwen3-coder:480b-cloud", contextLength: 262144, thinking: false, tools: true },
      { id: "embed-thing:latest", contextLength: 512, thinking: true, tools: false },
      { id: "gemma4:latest", contextLength: undefined, thinking: true, tools: true },
    ];
    const value = runOllamaSetup(listing, { cwd: box.cwd, project: false, dryRun: false, force: false })._unsafeUnwrap();

    expect(value.excluded).toEqual([
      { id: "qwen3-coder:480b-cloud", reason: "no-thinking" },
      { id: "embed-thing:latest", reason: "no-tools" },
      { id: "gemma4:latest", reason: "no-context" },
    ]);
    expect(value.declared).not.toContain("qwen3-coder:480b-cloud");
  } finally {
    box.restore();
  }
});

test("too few usable models fails before anything is written", () => {
  const box = sandbox();
  try {
    const report = runOllamaSetup(FOUR_LABS.slice(0, 2), { cwd: box.cwd, project: false, dryRun: false, force: false });

    expect(report.isErr()).toBe(true);
    expect(report._unsafeUnwrapErr()).toMatch(/needs 4/);
    expect(existsSync(join(box.agentDir, "models.json"))).toBe(false);
  } finally {
    box.restore();
  }
});

// --- the printed report -----------------------------------------------------
// The point of the output is that the result is inspectable without opening the JSON.

function reportFor(models: DaemonModel[], over: Partial<Parameters<typeof runOllamaSetup>[1]> = {}) {
  const box = sandbox();
  try {
    const value = runOllamaSetup(models, { cwd: box.cwd, project: false, dryRun: false, force: false, ...over })._unsafeUnwrap();
    return { text: formatSetupReport(value), value };
  } finally {
    box.restore();
  }
}

test("the report names both files it wrote and the exact panel", () => {
  const { text, value } = reportFor(FOUR_LABS);

  expect(text).toContain(value.paths.modelsJson);
  expect(text).toContain(value.paths.config);
  expect(text).toContain("ollama/glm-5.2:cloud@high");
  for (const reviewer of value.panel.reviewers) {
    expect(text).toContain(`ollama/${reviewer}@high`);
  }
});

test("the report explains every model it left out, in words rather than codes", () => {
  const { text } = reportFor([
    ...FOUR_LABS,
    { id: "qwen3-coder:480b-cloud", contextLength: 262144, thinking: false, tools: true },
  ]);

  expect(text).toContain("qwen3-coder:480b-cloud");
  // The consequence, not the capability name: the reader needs to know what would have broken.
  expect(text).toMatch(/reasoning/i);
  expect(text).toMatch(/silent/i);
  expect(text).not.toContain("no-thinking");
});

test("a panel that had to reuse a lab says so, because that is the point of a panel", () => {
  const oneLab: DaemonModel[] = [
    { id: "glm-5.2:cloud", contextLength: 1000000, thinking: true, tools: true },
    { id: "glm-5.1:cloud", contextLength: 202752, thinking: true, tools: true },
    { id: "glm-4.9:cloud", contextLength: 202752, thinking: true, tools: true },
    { id: "glm-4.8:cloud", contextLength: 202752, thinking: true, tools: true },
  ];
  expect(reportFor(oneLab).text).toMatch(/same|one lab|not diverse/i);
  expect(reportFor(FOUR_LABS).text).not.toMatch(/same lab|not diverse/i);
});

test("a kept config is reported as kept, with how to replace it", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.xdg, "rejudge"), { recursive: true });
    writeFileSync(join(box.xdg, "rejudge", "config.json"), JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "c/3@high" }));

    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false })._unsafeUnwrap();
    const text = formatSetupReport(value);

    expect(text).toMatch(/kept|left/i);
    expect(text).toContain("--force");
  } finally {
    box.restore();
  }
});

test("a dry run says nothing was written", () => {
  const { text } = reportFor(FOUR_LABS, { dryRun: true });
  expect(text).toMatch(/nothing was written|dry run/i);
});

test("a replaced models.json points at the backup", () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.agentDir, "models.json"), JSON.stringify({ providers: {} }));
    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false })._unsafeUnwrap();

    expect(formatSetupReport(value)).toContain(value.modelsBackup as string);
  } finally {
    box.restore();
  }
});

test("an unreachable daemon is a message that says what to start, not a stack trace", async () => {
  // Port 1 is never an Ollama daemon; the short timeout keeps a filtered port from hanging.
  const result = await fetchDaemonModels("http://127.0.0.1:1", AbortSignal.timeout(3000));

  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr()).toMatch(/ollama serve/);
});

test("declaring a local model warns about the served context, naming the server setting", () => {
  const withLocal: DaemonModel[] = [
    ...FOUR_LABS,
    { id: "gemma4:26b-a4b-it-qat", contextLength: 262144, thinking: true, tools: true },
  ];
  const { text } = reportFor(withLocal);

  expect(text).toContain("gemma4:26b-a4b-it-qat");
  expect(text).toContain("OLLAMA_CONTEXT_LENGTH");
  expect(text).toMatch(/truncat/i);
});

test("an all-cloud run carries no local-context warning to ignore", () => {
  const { text } = reportFor(FOUR_LABS);
  expect(text).not.toContain("OLLAMA_CONTEXT_LENGTH");
});

// --- a dry run must describe the run it is previewing ------------------------
// The guide tells people to run --dry-run first, so a preview that differs from the real run is
// worse than no preview: it is a wrong answer in the cautious path.

test("a dry run over an existing config says it would be kept, not written", () => {
  const box = sandbox();
  try {
    const config = join(box.xdg, "rejudge", "config.json");
    mkdirSync(join(box.xdg, "rejudge"), { recursive: true });
    writeFileSync(config, JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "c/3@high" }));

    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: true, force: false })._unsafeUnwrap();
    const text = formatSetupReport(value);

    expect(value.configKept).toBe(config);
    expect(value.wroteConfig).toBe(false);
    expect(text).toMatch(/would keep/);
    expect(text).not.toMatch(/would kept|would wrote/);
    expect(text).toContain("--force");
    expect(text).toMatch(/nothing was written/i);
  } finally {
    box.restore();
  }
});

test("a dry run over an existing models.json names the backup it would make", () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.agentDir, "models.json"), JSON.stringify({ providers: {} }));

    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: true, force: false })._unsafeUnwrap();

    expect(value.modelsBackup).toBe(join(box.agentDir, "models.json.bak"));
    expect(existsSync(value.modelsBackup as string)).toBe(false);

    const text = formatSetupReport(value);
    expect(text).toContain(value.modelsBackup as string);
    expect(text).toMatch(/would be kept at/);
    expect(text).not.toMatch(/would kept|would keep at|would wrote/);
  } finally {
    box.restore();
  }
});

test("a dry run says nothing was written even when both files already exist", () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.agentDir, "models.json"), JSON.stringify({ providers: {} }));
    mkdirSync(join(box.xdg, "rejudge"), { recursive: true });
    writeFileSync(join(box.xdg, "rejudge", "config.json"), JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "c/3@high" }));

    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: true, force: false })._unsafeUnwrap();

    expect(value.dryRun).toBe(true);
    expect(formatSetupReport(value)).toMatch(/nothing was written/i);
  } finally {
    box.restore();
  }
});

// --- write failures are values, not exceptions -------------------------------

test("an unwritable target is a failure value, not a thrown error", () => {
  const box = sandbox();
  try {
    chmodSync(box.agentDir, 0o500);

    const report = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false });

    expect(report.isErr()).toBe(true);
    expect(report._unsafeUnwrapErr()).toMatch(/cannot write/i);
  } finally {
    chmodSync(box.agentDir, 0o700);
    box.restore();
  }
});

test("a failed backup leaves the original models.json alone", () => {
  const box = sandbox();
  try {
    const modelsJson = join(box.agentDir, "models.json");
    const original = JSON.stringify({ providers: { "opencode-go": { apiKey: "keep-me" } } });
    writeFileSync(modelsJson, original);
    chmodSync(box.agentDir, 0o500);

    const report = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false });

    expect(report.isErr()).toBe(true);
    expect(readFileSync(modelsJson, "utf8")).toBe(original);
  } finally {
    chmodSync(box.agentDir, 0o700);
    box.restore();
  }
});

test("a user-wide panel that a project config would shadow says so", () => {
  const box = sandbox();
  try {
    mkdirSync(join(box.cwd, ".rejudge"), { recursive: true });
    writeFileSync(join(box.cwd, ".rejudge", "config.json"), JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "c/3@high" }));

    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: false, dryRun: false, force: false })._unsafeUnwrap();
    const text = formatSetupReport(value);

    expect(value.shadowedBy).toBe(join(box.cwd, ".rejudge", "config.json"));
    expect(text).toContain(join(box.cwd, ".rejudge", "config.json"));
    expect(text).toMatch(/shadow|wins|takes precedence/i);
  } finally {
    box.restore();
  }
});

test("writing the project config itself is never reported as shadowed", () => {
  const box = sandbox();
  try {
    const value = runOllamaSetup(FOUR_LABS, { cwd: box.cwd, project: true, dryRun: false, force: false })._unsafeUnwrap();
    expect(value.shadowedBy).toBeUndefined();
  } finally {
    box.restore();
  }
});

test("the report admits it cannot see a retired or out-of-plan cloud model", () => {
  const { text } = reportFor(FOUR_LABS);
  expect(text).toMatch(/410/);
  expect(text).toMatch(/402/);
});
