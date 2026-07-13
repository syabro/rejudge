import { test, expect } from "vitest";
import {
  discoverAndLoadExtensions,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { integrationTest } from "./integration.ts";
import { buildInvocationPrompt } from "../src/index.ts";
import { resolve, join } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runDir } from "../src/run-store.ts";

const STUB = "opencode-go/kimi-k2.6";
const packageManifest = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  pi: { extensions: string[] };
};
const builtExtension = resolve(packageManifest.pi.extensions[0]);

async function loadTool(cwd: string, agentDir: string) {
  const loaded = await discoverAndLoadExtensions([resolve("src/index.ts")], cwd, agentDir);
  expect(loaded.errors).toEqual([]);
  return loaded.extensions
    .flatMap((extension) => [...extension.tools.values()])
    .find((tool) => tool.definition.name === "rejudge");
}

function writeConfig(cwd: string, reviewerCount: number): void {
  mkdirSync(join(cwd, ".rejudge"), { recursive: true });
  writeFileSync(
    join(cwd, ".rejudge", "config.json"),
    JSON.stringify({
      reviewers: Array.from({ length: reviewerCount }, () => `${STUB}@minimal`),
      judge: `${STUB}@minimal`,
    }),
  );
}

// Smoke test: load the source through Pi's real extension loader, with no model and no mocks.
test("extension loads in Pi and registers the rejudge tool", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const loaded = await discoverAndLoadExtensions([resolve("src/index.ts")], process.cwd(), agentDir);

  expect(loaded.errors).toEqual([]);
  const tools = loaded.extensions.flatMap((extension) => [...extension.tools.values()]);
  const tool = tools.find((candidate) => candidate.definition.name === "rejudge");
  expect(tool?.definition.label).toBe("Rejudge for Pi");
  expect(tools.some((candidate) => candidate.definition.name === "fusion_agents")).toBe(false);
});

test.skipIf(!existsSync(builtExtension))("built Pi bundle registers the rejudge tool", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const loaded = await discoverAndLoadExtensions([builtExtension], process.cwd(), agentDir);

  expect(loaded.errors).toEqual([]);
  const tools = loaded.extensions.flatMap((extension) => [...extension.tools.values()]);
  const tool = tools.find((candidate) => candidate.definition.name === "rejudge");
  expect(tool?.definition.label).toBe("Rejudge for Pi");
  expect(tools.some((candidate) => candidate.definition.name === "fusion_agents")).toBe(false);
});

test("rejudge exposes resumeRunId as an optional parameter", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const tool = await loadTool(process.cwd(), agentDir);
  expect(tool).toBeDefined();

  const schema = tool!.definition.parameters as { properties?: Record<string, unknown> };
  expect(schema.properties).toHaveProperty("resumeRunId");
  expect(JSON.stringify(schema.properties!.resumeRunId)).toContain("minLength");
});

test("buildInvocationPrompt composes the question with output instructions", () => {
  const question = "What is the capital of France?";
  expect(buildInvocationPrompt(question)).toBe(question);
  expect(buildInvocationPrompt(question, "   ")).toBe(question);

  const composed = buildInvocationPrompt(question, "Begin your reply with RESULT:");
  expect(composed).toContain(question);
  expect(composed).toContain("Begin your reply with RESULT:");
  expect(composed).toContain("Output instructions");
});

test("rejudge forwards resumeRunId to the resume path", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  writeConfig(cwd, 2);

  const tool = await loadTool(cwd, agentDir);
  expect(tool).toBeDefined();

  const result = await tool!.definition.execute(
    "test-call",
    { question: "follow up", resumeRunId: "2020-01-01T00-00-00-000Z-gone12" },
    undefined,
    undefined,
    { cwd } as unknown as ExtensionContext,
  );

  const text = result.content
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("");
  expect(text).toMatch(/rejudge failed/i);
  expect(text).toMatch(/resume/i);
  expect(text).toMatch(/not found|expired/i);
});

integrationTest("rejudge runs end-to-end and returns a reviewed answer", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  writeConfig(cwd, 3);

  const tool = await loadTool(cwd, agentDir);
  expect(tool).toBeDefined();

  const result = await tool!.definition.execute(
    "test-call",
    {
      question: "What is the capital of France?",
      outputInstructions: "Begin your reply with the token RESULT:",
    },
    undefined,
    undefined,
    { cwd } as unknown as ExtensionContext,
  );

  const text = result.content
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("");
  expect(text).toMatch(/Paris/i);
  const runId = text.match(/Run ID: ([^\s.]+)/)?.[1];
  expect(runId).toBeDefined();
  if (runId) {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
}, 180_000);
