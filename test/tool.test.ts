import { test, expect } from "vitest";
import {
  discoverAndLoadExtensions,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { integrationTest } from "./integration.ts";
import { buildInvocationPrompt } from "../src/index.ts";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runDir } from "../src/run-store.ts";

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

test("fusion_agents exposes resumeRunId as an optional parameter", async () => {
  const extPath = resolve("src/index.ts");
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fusion-agentdir-"));

  const loaded = await discoverAndLoadExtensions([extPath], process.cwd(), agentDir);

  expect(loaded.errors).toEqual([]);
  const tool = loaded.extensions
    .flatMap((e) => [...e.tools.values()])
    .find((t) => t.definition.name === "fusion_agents");
  expect(tool).toBeDefined();

  const schema = tool!.definition.parameters as { properties?: Record<string, unknown> };
  expect(schema.properties).toHaveProperty("resumeRunId");
  expect(JSON.stringify(schema.properties!.resumeRunId)).toContain("minLength");
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

test("fusion_agents forwards resumeRunId to the resume path", async () => {
  const extPath = resolve("src/index.ts");
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fusion-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-proj-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "fusion-agents.json"),
    JSON.stringify({ panel: [`${STUB}@minimal`, `${STUB}@minimal`], synth: `${STUB}@minimal` }),
  );

  const loaded = await discoverAndLoadExtensions([extPath], cwd, agentDir);
  expect(loaded.errors).toEqual([]);
  const tool = loaded.extensions
    .flatMap((e) => [...e.tools.values()])
    .find((t) => t.definition.name === "fusion_agents");
  expect(tool).toBeDefined();

  const result = await tool!.definition.execute(
    "test-call",
    { question: "follow up", resumeRunId: "2020-01-01T00-00-00-000Z-gone12" },
    undefined,
    undefined,
    { cwd } as unknown as ExtensionContext,
  );

  const text = result.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");
  expect(text).toMatch(/fusion_agents failed/i);
  expect(text).toMatch(/resume/i);
  expect(text).toMatch(/not found|expired/i);
});

// Real end-to-end through Pi's loader and the real tool handler (no mocks): the tool
// reaches the panel + synthesis and returns a fused answer. Exact output-instruction
// obedience is covered deterministically above; a live cheap model can ignore formatting.
integrationTest("fusion_agents runs end-to-end and returns a fused answer", async () => {
  const extPath = resolve("src/index.ts");
  const agentDir = mkdtempSync(join(tmpdir(), "pi-fusion-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-proj-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "fusion-agents.json"),
    JSON.stringify({ panel: [`${STUB}@minimal`, `${STUB}@minimal`, `${STUB}@minimal`], synth: `${STUB}@minimal` }),
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
  expect(text).toMatch(/Paris/i);
  const runId = text.match(/Run ID: ([^\s.]+)/)?.[1];
  expect(runId).toBeDefined();
  if (runId) {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
}, 180_000);
