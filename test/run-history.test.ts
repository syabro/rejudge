import { test, expect } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listRunHistory, newRunId, readManifest, runDir, writeManifest, type RunManifest } from "../src/run-store.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const BIN = fileURLToPath(new URL("../bin/rejudge.js", import.meta.url));

test("history finds conversation runs, falls back by directory, and orders by last successful request", () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "rejudge-history-")));
  const ids: string[] = [];
  const save = (directory: string, conversationId?: string, lastRequestAt = "2026-01-01T00:00:00.000Z") => {
    const runId = newRunId();
    ids.push(runId);
    const file = join(runDir(runId), "session.jsonl");
    const manifest: RunManifest = {
      version: 4, runId, cwd: directory, createdAt: "2025-12-01T00:00:00.000Z", fullTools: false,
      reviewers: [{ roleKey: "panel-1", modelId: "provider/model", level: "minimal", file }],
      judge: { roleKey: "judge", modelId: "provider/model", level: "minimal", file },
      conversationId, lastRequestAt, title: "Review history", originalQuestion: "Check history lookup",
    };
    writeManifest(manifest);
    writeFileSync(file, "session fixture\n");
    return manifest;
  };

  try {
    const own = save(cwd, "conversation-a");
    for (let i = 2; i <= 7; i++) save(cwd, "conversation-b", `2026-01-0${i}T00:00:00.000Z`);
    save(`${cwd}-sibling`, "conversation-a", "2026-02-01T00:00:00.000Z");
    const missing = save(cwd, "conversation-a");
    rmSync(missing.judge.file);

    const found = listRunHistory(cwd, "conversation-a");
    expect(found.reason).toBe("conversation");
    expect(found.runs.map((run) => run.runId)).toEqual([own.runId]);
    expect(found.runs[0]).toMatchObject({ conversationId: "conversation-a", title: own.title, originalQuestion: own.originalQuestion });

    const many = listRunHistory(cwd, "conversation-b");
    expect(many.reason).toBe("conversation");
    expect(many.total).toBe(6);
    expect(many.runs).toHaveLength(5);
    expect(many.runs.every((run) => run.conversationId === "conversation-b")).toBe(true);

    const fallback = listRunHistory(cwd, "unknown");
    expect(fallback.reason).toBe("conversation_not_found");
    expect(fallback.total).toBe(7);
    expect(fallback.runs).toHaveLength(5);
    expect(fallback.runs.map((run) => run.lastRequestAt)).toEqual([
      "2026-01-07T00:00:00.000Z", "2026-01-06T00:00:00.000Z", "2026-01-05T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z", "2026-01-03T00:00:00.000Z",
    ]);
    expect(fallback.warning).toContain("Strongly discouraged");
    expect(listRunHistory(cwd).reason).toBe("conversation_id_missing");
    expect(listRunHistory(cwd, "  ").runs).toEqual(fallback.runs);

    writeManifest({ ...own, lastRequestAt: "2026-03-01T00:00:00.000Z" });
    expect(listRunHistory(cwd).runs[0].runId).toBe(own.runId);

    // A separate process reads the same disk records without config or a prompt.
    for (const [command, script] of [["bun", CLI], [process.execPath, BIN]]) {
      for (const conversationId of ["conversation-a", "unknown", undefined]) {
        const args = conversationId ? ["--conversation-id", conversationId] : [];
        const cli = spawnSync(command, [script, "--history", ...args], {
          cwd, encoding: "utf8", timeout: 10_000, input: "ignored stdin",
          env: { ...process.env, HOME: join(cwd, "home"), XDG_CONFIG_HOME: join(cwd, "xdg") },
        });
        expect(cli.status, cli.stderr).toBe(0);
        expect(cli.stderr).toBe("");
        expect(JSON.parse(cli.stdout)).toEqual(listRunHistory(cwd, conversationId));
      }
    }

    const junk = { ...own, title: 42, conversationId: {}, originalQuestion: [], lastRequestAt: "invalid" };
    writeFileSync(join(runDir(own.runId), "manifest.json"), JSON.stringify(junk));
    expect(readManifest(own.runId)).toBeDefined();
    const sanitized = listRunHistory(cwd).runs.find((run) => run.runId === own.runId);
    // The legacy timestamp puts it outside the five latest entries, but it still counts.
    expect(sanitized).toBeUndefined();
    expect(listRunHistory(cwd).total).toBe(7);
    writeFileSync(join(runDir(own.runId), "manifest.json"), JSON.stringify({ ...junk, createdAt: "2026-04-01T00:00:00.000Z" }));
    expect(listRunHistory(cwd).runs[0]).toMatchObject({
      runId: own.runId, conversationId: null, title: null, originalQuestion: null,
      lastRequestAt: "2026-04-01T00:00:00.000Z", questionTruncated: false,
    });

    writeManifest({ ...own, originalQuestion: "q".repeat(5000), lastRequestAt: "2026-04-01T00:00:00.000Z" });
    const preview = listRunHistory(cwd).runs[0];
    expect(preview.questionTruncated).toBe(true);
    expect(preview.questionLength).toBe(5000);
    expect(preview.originalQuestion!.length).toBeLessThan(5000);
    expect(readManifest(own.runId)?.originalQuestion).toHaveLength(5000);

    writeFileSync(join(runDir(own.runId), "manifest.json"), JSON.stringify({ ...own, runId: newRunId() }));
    expect(listRunHistory(cwd, "conversation-a").reason).toBe("conversation_not_found");
    expect(listRunHistory(`${cwd}/empty`).runs).toEqual([]);
    expect(listRunHistory(`${cwd}/empty`, "some-id")).toMatchObject({
      reason: "conversation_not_found", total: 0, runs: [],
    });
  } finally {
    for (const id of ids) rmSync(runDir(id), { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}, 15_000);
