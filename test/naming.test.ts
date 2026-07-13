import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { configPath, globalConfigPath } from "../src/config.ts";
import { USAGE } from "../src/cli-args.ts";
import { renderProgress, createProgressState } from "../src/progress.ts";
import { runsRoot } from "../src/run-store.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";

const THEME = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;

test("package and CLI expose the Rejudge names", () => {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    name: string;
    scripts: Record<string, string>;
  };

  expect(pkg.name).toBe("@rejudge/pi");
  expect(pkg.scripts["build:cli"]).toContain("bin/rejudge.js");
  expect(USAGE).toMatch(/^usage: rejudge /);
});

test("config uses host-neutral paths and reviewer/judge keys", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-naming-"));
  const xdg = mkdtempSync(join(tmpdir(), "rejudge-xdg-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;

  try {
    expect(configPath(cwd)).toBe(join(cwd, ".rejudge", "config.json"));
    expect(globalConfigPath()).toBe(join(xdg, "rejudge", "config.json"));

    mkdirSync(join(cwd, ".rejudge"), { recursive: true });
    writeFileSync(
      join(cwd, ".rejudge", "config.json"),
      JSON.stringify({ reviewers: ["a/1@high", "b/2@high"], judge: "c/3@medium" }),
    );

    const module = await import("../src/config.ts");
    expect(module).toHaveProperty("loadRejudgeConfig");
    const load = (module as unknown as { loadRejudgeConfig(cwd: string): unknown }).loadRejudgeConfig;
    expect(load(cwd)).toMatchObject({
      reviewers: [{ id: "a/1", level: "high" }, { id: "b/2", level: "high" }],
      judge: { id: "c/3", level: "medium" },
    });
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
});

test("Pi registers the rejudge tool with its Pi label", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const loaded = await discoverAndLoadExtensions([resolve("src/index.ts")], process.cwd(), agentDir);

  expect(loaded.errors).toEqual([]);
  const tools = loaded.extensions.flatMap((extension) => [...extension.tools.values()]);
  const tool = tools.find((candidate) => candidate.definition.name === "rejudge");
  expect(tool?.definition.label).toBe("Rejudge for Pi");
  expect(tools.some((candidate) => candidate.definition.name === "fusion_agents")).toBe(false);
});

test("progress and persisted runs use Rejudge names", () => {
  const state = createProgressState(["provider/reviewer"], "provider/judge", "check naming");
  expect(renderProgress(state, THEME, state.startedAt).join("\n")).toContain("Rejudge");
  expect(runsRoot()).toBe(join(tmpdir(), "rejudge", "runs"));
});
