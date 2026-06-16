import { test, expect } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import createExtension from "../src/index.ts";
import { Value } from "typebox/value";

function captureTool(): any {
  let tool: any;
  const pi = { registerTool: (t: any) => { tool = t; } } as unknown as ExtensionAPI;
  createExtension(pi);
  return tool;
}

test("registers the fusion_agents tool", () => {
  const tool = captureTool();
  expect(tool.name).toBe("fusion_agents");
});

test("execute returns a single final-text block echoing the question", async () => {
  const tool = captureTool();
  const result = await tool.execute("call-1", { question: "what is this repo?" }, undefined, undefined, {});
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");
  expect(result.content[0].text).toContain("what is this repo?");
});

test("parameters schema requires a question (the validation Pi runs on load)", () => {
  const tool = captureTool();
  expect(Value.Check(tool.parameters, { question: "x" })).toBe(true);
  expect(Value.Check(tool.parameters, {})).toBe(false);
});
