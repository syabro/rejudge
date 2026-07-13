import { test, expect } from "vitest";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  gcExpired,
  newRunId,
  readManifest,
  RUN_TTL_MS,
  runDir,
  writeManifest,
  type RunManifest,
} from "../src/run-store.ts";

// Deterministic — no model, no Pi. Exercises the run-store's own logic (id format, manifest
// round-trip, TTL GC); the SDK persistence/resume is proven by the integration test.

test("newRunId is sortable (timestamp first) and filename-safe", () => {
  const id = newRunId();
  expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-z0-9]+$/);
});

test("writeManifest then readManifest round-trips", () => {
  const runId = newRunId();
  const manifest: RunManifest = {
    version: 4,
    runId,
    cwd: "/some/project",
    createdAt: new Date(0).toISOString(),
    fullTools: false,
    reviewers: [
      { roleKey: "panel-1", modelId: "prov/a", level: "xhigh", file: "/runs/a.jsonl" },
      { roleKey: "panel-2", modelId: "prov/b", level: "high", file: "/runs/b.jsonl" },
    ],
    judge: { roleKey: "judge", modelId: "prov/judge", level: "medium", file: "/runs/judge.jsonl" },
  };
  try {
    writeManifest(manifest);
    expect(readManifest(runId)).toEqual(manifest);
  } finally {
    rmSync(runDir(runId), { recursive: true, force: true });
  }
});

test("readManifest returns undefined for an unknown run", () => {
  expect(readManifest("2020-01-01T00-00-00-000Z-nope11")).toBeUndefined();
});

test("readManifest rejects legacy or invalid role-key routing", () => {
  const valid = {
    version: 4,
    cwd: "/some/project",
    createdAt: new Date(0).toISOString(),
    fullTools: false,
    reviewers: [
      { roleKey: "panel-1", modelId: "prov/shared", level: "minimal", file: "/runs/a.jsonl" },
      { roleKey: "panel-2", modelId: "prov/shared", level: "minimal", file: "/runs/b.jsonl" },
    ],
    judge: { roleKey: "judge", modelId: "prov/shared", level: "minimal", file: "/runs/judge.jsonl" },
  };
  const invalid = [
    { ...valid, version: 3 },
    { ...valid, reviewers: [valid.reviewers[0], { ...valid.reviewers[1], roleKey: "panel-1" }] },
    { ...valid, judge: { ...valid.judge, roleKey: "panel-3" } },
  ];

  for (const candidate of invalid) {
    const runId = newRunId();
    const dir = runDir(runId);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...candidate, runId }));
      expect(readManifest(runId)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("gcExpired removes runs older than the TTL and keeps fresh ones", () => {
  const oldId = newRunId();
  const freshId = newRunId();
  mkdirSync(runDir(oldId), { recursive: true });
  mkdirSync(runDir(freshId), { recursive: true });
  try {
    // Backdate the old run's dir mtime to two TTLs ago (utimes takes seconds).
    const twoTtlsAgo = (Date.now() - 2 * RUN_TTL_MS) / 1000;
    utimesSync(runDir(oldId), twoTtlsAgo, twoTtlsAgo);

    gcExpired(Date.now());

    expect(existsSync(runDir(oldId))).toBe(false);
    expect(existsSync(runDir(freshId))).toBe(true);
  } finally {
    rmSync(runDir(oldId), { recursive: true, force: true });
    rmSync(runDir(freshId), { recursive: true, force: true });
  }
});
