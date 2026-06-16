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

test("valid config returns the 3 panel + 1 synth IDs", () => {
  const cwd = projectWith(JSON.stringify({ panel: ["a/1", "b/2", "c/3"], synth: "d/4" }));
  expect(loadFusionConfig(cwd)).toEqual({ panel: ["a/1", "b/2", "c/3"], synth: "d/4" });
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
