import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadFusionConfig, loadFusionConfigFromPath, resolveFusionConfig } from "../src/config.ts";

// Real-input tests: write an actual .pi/fusion-agents.json and load it. No mocks.
function projectWith(content: string | null): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-cfg-"));
  if (content !== null) {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "fusion-agents.json"), content);
  }
  return cwd;
}

// Point the global-config fallback (XDG_CONFIG_HOME) at a temp dir for the duration of fn.
function withGlobalConfig(content: string | null, fn: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-fusion-global-"));
  if (content !== null) writeFileSync(join(dir, "fusion-agents.json"), content);
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  }
}

const PROJECT_CFG = JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4" });
const GLOBAL_CFG = JSON.stringify({ panel: ["g/1", "g/2", "g/3"], synth: "g/4" });

test("valid config returns the 3 panel + 1 synth IDs, defaulting thinking and debugLog", () => {
  const cwd = projectWith(JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4" }));
  expect(loadFusionConfig(cwd)).toEqual({
    panel: ["a/1", "b/2", "c/3"],
    synth: "d/4",
    thinking: { panel: "xhigh", synth: "medium" },
    debugLog: false,
  });
});

test("debugLog is read when set, and rejected when not a boolean", () => {
  const on = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", debugLog: true }),
  );
  expect(loadFusionConfig(on).debugLog).toBe(true);
  const bad = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", debugLog: "yes" }),
  );
  expect(() => loadFusionConfig(bad)).toThrow(/debugLog/);
});

test("thinking is read per stage when set", () => {
  const cwd = projectWith(
    JSON.stringify({
      panel: ["a/1", "b/2", "c/3"],
      synth: "d/4",
      thinking: { panel: "high", synth: "low" },
    }),
  );
  expect(loadFusionConfig(cwd).thinking).toEqual({ panel: "high", synth: "low" });
});

test("a partial thinking block fills the missing stage from defaults", () => {
  const cwd = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", thinking: { synth: "low" } }),
  );
  expect(loadFusionConfig(cwd).thinking).toEqual({ panel: "xhigh", synth: "low" });
});

test("thinking: null falls back to defaults", () => {
  const cwd = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", thinking: null }),
  );
  expect(loadFusionConfig(cwd).thinking).toEqual({ panel: "xhigh", synth: "medium" });
});

test("an invalid thinking level is rejected", () => {
  const ultra = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", thinking: { panel: "ultra" } }),
  );
  expect(() => loadFusionConfig(ultra)).toThrow(/thinking\.panel/);
  // Case-sensitive and "off" is not a ThinkingLevel.
  const upper = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", thinking: { synth: "XHIGH" } }),
  );
  expect(() => loadFusionConfig(upper)).toThrow(/thinking\.synth/);
  const off = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", thinking: { panel: "off" } }),
  );
  expect(() => loadFusionConfig(off)).toThrow(/thinking\.panel/);
});

test("a present-but-non-string thinking level is rejected", () => {
  const nul = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", thinking: { panel: null } }),
  );
  expect(() => loadFusionConfig(nul)).toThrow(/thinking\.panel/);
  const num = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", thinking: { synth: 42 } }),
  );
  expect(() => loadFusionConfig(num)).toThrow(/thinking\.synth/);
});

test("a non-object thinking block is rejected", () => {
  const cwd = projectWith(
    JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4", thinking: "xhigh" }),
  );
  expect(() => loadFusionConfig(cwd)).toThrow(/thinking/);
});

test("missing config file is rejected", () => {
  expect(() => loadFusionConfig(projectWith(null))).toThrow();
});

test("wrong panel count is rejected", () => {
  const two = projectWith(JSON.stringify({ panel: ["a/1", "b/2"], synth: "d/4" }));
  expect(() => loadFusionConfig(two)).toThrow(/panel/);
  const four = projectWith(JSON.stringify({ panel: ["a/1", "b/2", "c/3", "e/5"], synth: "d/4" }));
  expect(() => loadFusionConfig(four)).toThrow(/panel/);
});

test("missing synth is rejected", () => {
  const cwd = projectWith(JSON.stringify({ panel: ["a/1", "b/2", "c/3"] }));
  expect(() => loadFusionConfig(cwd)).toThrow(/synth/);
});

test("malformed JSON is rejected", () => {
  expect(() => loadFusionConfig(projectWith("{ not json"))).toThrow();
});

test("resolveFusionConfig: project .pi/ wins over the global config", () => {
  const cwd = projectWith(PROJECT_CFG);
  withGlobalConfig(GLOBAL_CFG, () => {
    const r = resolveFusionConfig(cwd);
    expect(r.path).toBe(join(cwd, ".pi", "fusion-agents.json"));
    expect(r.config.synth).toBe("d/4");
  });
});

test("resolveFusionConfig: falls back to the global config when the project has none", () => {
  const cwd = projectWith(null); // no .pi/fusion-agents.json
  withGlobalConfig(GLOBAL_CFG, () => {
    const r = resolveFusionConfig(cwd);
    expect(r.path).toBe(join(process.env.XDG_CONFIG_HOME as string, "fusion-agents.json"));
    expect(r.config.synth).toBe("g/4");
  });
});

test("resolveFusionConfig: throws naming both paths when neither exists", () => {
  const cwd = projectWith(null);
  withGlobalConfig(null, () => {
    expect(() => resolveFusionConfig(cwd)).toThrow(/no config found/);
  });
});

// The committed .pi/fusion-agents.json must stay loadable. Deterministic (no model), so
// it runs without a key; it guards the real config's SHAPE from drift — model-ID validity
// is an integration concern, not checked here. Path resolves from this test file (ESM), not
// the cwd, so it works regardless of where vitest is invoked.
test("the committed .pi/fusion-agents.json loads and has the expected shape", () => {
  const path = fileURLToPath(new URL("../.pi/fusion-agents.json", import.meta.url));
  const config = loadFusionConfigFromPath(path);
  expect(config.panel).toHaveLength(3);
  expect(config.synth.length).toBeGreaterThan(0);
  expect(config.debugLog).toBe(true);
});
