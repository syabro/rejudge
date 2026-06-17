import { test, expect } from "vitest";
import {
  discoverAndLoadExtensions,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { integrationTest } from "./integration.ts";
import { buildInvocationPrompt } from "../src/index.ts";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Fastest reliable opencode-go model. The load/registration checks don't care
// about its output; the end-to-end test below does assert on the formatted answer.
const STUB = "opencode-go/kimi-k2.6";

// Smoke test: load our extension through Pi's real extension loader (no model,
// no mocks) and confirm the fusion_agents tool actually registers on load.
// Empty agent dir + project has no .pi/extensions → only our extension loads.
test("extension loads in Pi and registers the fusion_agents tool", async () => {
  const extPath = resolve("src/index.ts");
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fusion-agentdir-"));

  const loaded = await discoverAndLoadExtensions([extPath], process.cwd(), agentDir);

  expect(loaded.errors).toEqual([]);
  const toolNames = loaded.extensions.flatMap((e) => [...e.tools.keys()]);
  expect(toolNames).toContain("fusion_agents");
});

// Deterministic: output instructions are composed into the prompt when present,
// and the question is returned unchanged when they're absent/blank.
test("buildInvocationPrompt composes the question with output instructions", () => {
  const q = "What is the capital of France?";
  expect(buildInvocationPrompt(q)).toBe(q);
  expect(buildInvocationPrompt(q, "   ")).toBe(q);

  const composed = buildInvocationPrompt(q, "Begin your reply with RESULT:");
  expect(composed).toContain(q);
  expect(composed).toContain("Begin your reply with RESULT:");
  expect(composed).toContain("Output instructions");
});

// Real end-to-end through Pi's loader and the real tool handler (no mocks): a
// call carrying output instructions reaches the panel + synthesis, and the
// returned answer respects the requested format.
integrationTest("fusion_agents threads output instructions end-to-end to a formatted answer", async () => {
  const extPath = resolve("src/index.ts");
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fusion-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-proj-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "fusion-agents.json"),
    JSON.stringify({ panel: [STUB, STUB, STUB], synth: STUB }),
  );

  const loaded = await discoverAndLoadExtensions([extPath], cwd, agentDir);
  expect(loaded.errors).toEqual([]);
  const tool = loaded.extensions
    .flatMap((e) => [...e.tools.values()])
    .find((t) => t.definition.name === "fusion_agents");
  expect(tool).toBeDefined();

  const ctx = { cwd } as unknown as ExtensionContext;
  const result = await tool!.definition.execute(
    "test-call",
    {
      question: "What is the capital of France?",
      outputInstructions: "Begin your reply with the token RESULT:",
    },
    undefined,
    undefined,
    ctx,
  );

  const text = result.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");
  // Format applied (the output instruction) AND fused content preserved.
  expect(text.trim()).toMatch(/^RESULT\s*:/i);
  expect(text).toMatch(/Paris/i);
}, 180_000);
