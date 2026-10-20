import { test, expect } from "vitest";
import {
  discoverAndLoadExtensions,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { integrationTest } from "./integration.ts";
import { buildInvocationPrompt } from "../src/index.ts";
import { resolve, join } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { listRunHistory, readManifest, runDir } from "../src/run-store.ts";
import type { ProgressSnapshot } from "../src/progress.ts";

const STUB = "opencode-go/glm-5.3-flash";
const packageManifest = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  pi: { extensions: string[] };
};
const builtExtension = resolve(packageManifest.pi.extensions[0]);

async function loadTool(cwd: string, agentDir: string, extension = resolve("src/index.ts")) {
  const loaded = await discoverAndLoadExtensions([extension], cwd, agentDir);
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

test.each([resolve("src/index.ts"), builtExtension])("history works through Pi without model config or progress: %s", async (extension) => {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-history-tool-"));
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  // Invalid project config would fail any review call, even with a valid global config.
  mkdirSync(join(cwd, ".rejudge"));
  writeFileSync(join(cwd, ".rejudge", "config.json"), "invalid");
  try {
    const tool = await loadTool(cwd, agentDir, extension);
    expect(tool).toBeDefined();
    const updates: unknown[] = [];
    const invoke = (params: Record<string, unknown>) => tool!.definition.execute(
      "history-check", params, undefined, (update) => updates.push(update), { cwd } as unknown as ExtensionToolContext,
    );
    for (const conversationId of [undefined, "unknown"]) {
      const result = await invoke({ history: true, conversationId });
      const text = result.content.map((part) => part.type === "text" ? part.text : "").join("");
      expect(JSON.parse(text)).toEqual(listRunHistory(cwd, conversationId));
      expect(result.details).toEqual({ history: JSON.parse(text) });
      const render = tool!.definition.renderResult!;
      const collapsed = render(result, { expanded: false, isPartial: false }, undefined!, undefined!).render(100).join("\n");
      expect(collapsed.trimEnd()).toBe("Found 0 runs");

      const history = { ...JSON.parse(text), total: 1, runs: [{
        runId: "saved-review-id", title: "Review history rendering", lastRequestAt: "2026-09-10T10:00:00.000Z",
        originalQuestion: "PRIVATE LONG QUESTION", conversationId: "caller-id",
      }] };
      const populated = { content: [{ type: "text" as const, text: JSON.stringify(history) }], details: { history } };
      const expanded = render(populated, { expanded: true, isPartial: false }, undefined!, undefined!).render(100).join("\n");
      expect(expanded).toContain("Review history rendering");
      expect(expanded).toContain("Last request: 2026-09-10T10:00:00.000Z");
      expect(expanded).toContain("Run ID: saved-review-id");
      expect(expanded).not.toContain("PRIVATE LONG QUESTION");
      expect(expanded).not.toContain('"runs"');
      expect(JSON.parse(populated.content[0].text).runs[0].originalQuestion).toBe("PRIVATE LONG QUESTION");
    }
    for (const params of [{}, { history: true, question: "review" }, { history: true, title: "review" }, { history: true, resumeRunId: "id" }, { history: true, outputInstructions: "brief" }]) {
      const result = await invoke(params);
      expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("rejudge failed:") }]);
    }
    expect(updates).toEqual([]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
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

test("rejudge rejects a blank resumeRunId before publishing progress", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  writeConfig(cwd, 2);

  const tool = await loadTool(cwd, agentDir);
  expect(tool).toBeDefined();

  const updates: ProgressSnapshot[] = [];
  const result = await tool!.definition.execute(
    "test-call",
    { question: "follow up", resumeRunId: "   " },
    undefined,
    (update) => {
      if (update.details) updates.push(update.details as ProgressSnapshot);
    },
    { cwd } as unknown as ExtensionToolContext,
  );

  const text = result.content.map((content) => (content.type === "text" ? content.text : "")).join("");
  expect(text).toMatch(/resumeRunId must be a non-empty string/);
  expect(result.details).toBeUndefined();
  expect(updates).toEqual([]);
});

test("rejudge returns user cancellation as its own model-visible result", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  mkdirSync(join(cwd, ".rejudge"), { recursive: true });
  writeFileSync(
    join(cwd, ".rejudge", "config.json"),
    JSON.stringify({
      reviewers: ["provider/reviewer-a@minimal", "provider/reviewer-b@minimal"],
      judge: "provider/judge@minimal",
    }),
  );

  const tool = await loadTool(cwd, agentDir);
  expect(tool).toBeDefined();

  const updates: ProgressSnapshot[] = [];
  const result = await tool!.definition.execute(
    "test-call",
    { question: "review this" },
    AbortSignal.abort(),
    (update) => {
      if (update.details) updates.push(update.details as ProgressSnapshot);
    },
    { cwd } as unknown as ExtensionToolContext,
  );

  const text = result.content
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("");
  const snapshot = result.details as ProgressSnapshot;

  expect(text).toBe("Rejudge cancelled by user.");
  expect(text).not.toMatch(/rejudge failed/i);
  expect(updates[0]?.mode).toEqual({ kind: "fresh" });
  expect(updates[0]?.toolPolicy?.fullTools).toBe(false);
  expect(updates[0]?.toolPolicy?.tools).toEqual(expect.arrayContaining(["read", "grep", "find", "ls", "git_diff"]));
  expect(updates[0]?.toolPolicy?.tools).not.toEqual(expect.arrayContaining(["edit", "write", "bash"]));
  expect(updates[0]?.models).toEqual([]);
  expect(snapshot.mode).toEqual({ kind: "fresh" });
  expect(snapshot.status).toBe("cancelled");
  expect(snapshot.models).toHaveLength(2);
  expect(snapshot.models.every((model) => model.role === "reviewer")).toBe(true);
  expect(snapshot.models.every((model) => model.status === "cancelled" && model.toolCount === 0)).toBe(true);
});

test("rejudge forwards resumeRunId to the resume path", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-agentdir-"));
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-proj-"));
  writeConfig(cwd, 2);

  const tool = await loadTool(cwd, agentDir);
  expect(tool).toBeDefined();

  const runId = "2020-01-01T00-00-00-000Z-gone12";
  const updates: ProgressSnapshot[] = [];
  const result = await tool!.definition.execute(
    "test-call",
    { question: "follow up", resumeRunId: runId },
    undefined,
    (update) => {
      if (update.details) updates.push(update.details as ProgressSnapshot);
    },
    { cwd } as unknown as ExtensionToolContext,
  );

  const text = result.content
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("");
  expect(text).toMatch(/rejudge failed/i);
  expect(text).toMatch(/resume/i);
  expect(text).toMatch(/not found|expired/i);
  expect(updates[0]?.mode).toEqual({ kind: "resumed", runId });
  expect(updates[0]?.models).toEqual([]);
  const snapshot = result.details as ProgressSnapshot;
  expect(snapshot.mode).toEqual({ kind: "resumed", runId });
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
      conversationId: `tool-${cwd}`,
      title: "Capital question",
      outputInstructions: "Begin your reply with the token RESULT:",
    },
    undefined,
    undefined,
    { cwd } as unknown as ExtensionToolContext,
  );

  const text = result.content
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("");
  expect(text).toMatch(/Paris/i);
  const runId = text.match(/Run ID: ([^\s.]+)/)?.[1];
  expect(runId).toBeDefined();
  if (runId) {
    try {
      expect(readManifest(runId)).toMatchObject({
        conversationId: `tool-${cwd}`, title: "Capital question", originalQuestion: "What is the capital of France?",
      });
      expect(listRunHistory(cwd, `tool-${cwd}`).runs.map((run) => run.runId)).toEqual([runId]);
    } finally {
      rmSync(runDir(runId), { recursive: true, force: true });
    }
  }
}, 180_000);
