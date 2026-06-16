import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFusionConfig } from "../src/config.ts";

// Real-input tests: write an actual .pi/fusion-agents.json and load it. No mocks.
function projectWith(content: string | null): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-cfg-"));
  if (content !== null) {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "fusion-agents.json"), content);
  }
  return cwd;
}

test("valid config returns the 3 panel + 1 synth IDs, defaulting thinking", () => {
  const cwd = projectWith(JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4" }));
  expect(loadFusionConfig(cwd)).toEqual({
    panel: ["a/1", "b/2", "c/3"],
    synth: "d/4",
    thinking: { panel: "xhigh", synth: "medium" },
  });
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
