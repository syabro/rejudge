import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFusionConfig, resolveFusionConfig } from "../src/config.ts";

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

const PROJECT_CFG = JSON.stringify({ panel: ["a/1@high", "b/2@high", "c/3@high"], synth: "d/4@medium" });
const GLOBAL_CFG = JSON.stringify({ panel: ["g/1@high", "g/2@high", "g/3@high"], synth: "g/4@medium" });

test("valid config parses each model's id and @level, defaulting debugLog", () => {
  // Different levels per model prove the suffix is parsed independently, not stage-wide.
  const cwd = projectWith(JSON.stringify({ panel: ["a/1@xhigh", "b/2@high", "c/3@low"], synth: "d/4@medium" }));
  expect(loadFusionConfig(cwd)).toEqual({
    panel: [
      { id: "a/1", level: "xhigh" },
      { id: "b/2", level: "high" },
      { id: "c/3", level: "low" },
    ],
    synth: { id: "d/4", level: "medium" },
    debugLog: false,
  });
});

test("debugLog is read when set, and rejected when not a boolean", () => {
  const on = projectWith(
    JSON.stringify({ panel: ["a/1@high", "b/2@high"], synth: "d/4@medium", debugLog: true }),
  );
  expect(loadFusionConfig(on).debugLog).toBe(true);
  const bad = projectWith(
    JSON.stringify({ panel: ["a/1@high", "b/2@high"], synth: "d/4@medium", debugLog: "yes" }),
  );
  expect(() => loadFusionConfig(bad)).toThrow(/debugLog/);
});

test("a model id without an @level suffix is rejected (panel and synth)", () => {
  const noPanel = projectWith(JSON.stringify({ panel: ["a/1", "b/2@high"], synth: "d/4@medium" }));
  expect(() => loadFusionConfig(noPanel)).toThrow(/panel\[0\].*reasoning level/i);
  const noSynth = projectWith(JSON.stringify({ panel: ["a/1@high", "b/2@high"], synth: "d/4" }));
  expect(() => loadFusionConfig(noSynth)).toThrow(/synth.*reasoning level/i);
});

test("an invalid reasoning level is rejected (unknown, wrong case, and 'off')", () => {
  const ultra = projectWith(JSON.stringify({ panel: ["a/1@ultra", "b/2@high"], synth: "d/4@medium" }));
  expect(() => loadFusionConfig(ultra)).toThrow(/invalid reasoning level/i);
  // Case-sensitive and "off" is not a ThinkingLevel.
  const upper = projectWith(JSON.stringify({ panel: ["a/1@high", "b/2@high"], synth: "d/4@MEDIUM" }));
  expect(() => loadFusionConfig(upper)).toThrow(/invalid reasoning level/i);
  const off = projectWith(JSON.stringify({ panel: ["a/1@off", "b/2@high"], synth: "d/4@medium" }));
  expect(() => loadFusionConfig(off)).toThrow(/invalid reasoning level/i);
});

test("an empty model id before the @level suffix is rejected", () => {
  const cwd = projectWith(JSON.stringify({ panel: ["@high", "b/2@high"], synth: "d/4@medium" }));
  expect(() => loadFusionConfig(cwd)).toThrow(/empty model id/i);
});

test("a malformed provider/model is rejected at config load (cheap fail-fast)", () => {
  const cwd = projectWith(JSON.stringify({ panel: ["noslash@high", "b/2@high"], synth: "d/4@medium" }));
  expect(() => loadFusionConfig(cwd)).toThrow(/malformed model id/i);
});

test("a leftover 'thinking' block is rejected with a migration hint", () => {
  const cwd = projectWith(
    JSON.stringify({
      panel: ["a/1@high", "b/2@high"],
      synth: "d/4@medium",
      thinking: { panel: "xhigh", synth: "medium" },
    }),
  );
  expect(() => loadFusionConfig(cwd)).toThrow(/thinking.*no longer supported/i);
});

test("missing config file is rejected", () => {
  expect(() => loadFusionConfig(projectWith(null))).toThrow();
});

test("a panel smaller than 2 is rejected", () => {
  const one = projectWith(JSON.stringify({ panel: ["a/1@high"], synth: "d/4@medium" }));
  expect(() => loadFusionConfig(one)).toThrow(/panel/);
  const none = projectWith(JSON.stringify({ panel: [], synth: "d/4@medium" }));
  expect(() => loadFusionConfig(none)).toThrow(/panel/);
});

test("a panel of 2 or more is accepted", () => {
  const two = projectWith(JSON.stringify({ panel: ["a/1@high", "b/2@high"], synth: "d/4@medium" }));
  expect(loadFusionConfig(two).panel).toEqual([
    { id: "a/1", level: "high" },
    { id: "b/2", level: "high" },
  ]);
  const four = projectWith(
    JSON.stringify({ panel: ["a/1@high", "b/2@high", "c/3@high", "e/5@high"], synth: "d/4@medium" }),
  );
  expect(loadFusionConfig(four).panel.map((m) => m.id)).toEqual(["a/1", "b/2", "c/3", "e/5"]);
});

test("missing synth is rejected", () => {
  const cwd = projectWith(JSON.stringify({ panel: ["a/1@high", "b/2@high", "c/3@high"] }));
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
    expect(r.config.synth.id).toBe("d/4");
  });
});

test("resolveFusionConfig: falls back to the global config when the project has none", () => {
  const cwd = projectWith(null); // no .pi/fusion-agents.json
  withGlobalConfig(GLOBAL_CFG, () => {
    const r = resolveFusionConfig(cwd);
    expect(r.path).toBe(join(process.env.XDG_CONFIG_HOME as string, "fusion-agents.json"));
    expect(r.config.synth.id).toBe("g/4");
  });
});

test("resolveFusionConfig: throws naming both paths when neither exists", () => {
  const cwd = projectWith(null);
  withGlobalConfig(null, () => {
    expect(() => resolveFusionConfig(cwd)).toThrow(/no config found/);
  });
});
