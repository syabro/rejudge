import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DAEMON_URL, fetchDaemonModels, runOllamaSetup, setupPaths } from "../src/setup.ts";

// Live checks against a real Ollama daemon — no mocks, per the project's testing rule. Gated on the
// daemon actually answering, so a contributor without Ollama gets skips rather than failures.
// PI_TEST_UNIT_ONLY=1 forces the skip even when one is running.
//
// The probe timeout is deliberately generous. A machine with no daemon refuses the connection
// immediately, so waiting costs nothing there — while a short timeout on a loaded machine turns a
// working daemon into silently skipped tests, which reads exactly like tests that were never written.
const unitOnly = process.env.PI_TEST_UNIT_ONLY === "1";
const daemonUp = unitOnly
  ? false
  : await fetch(`${DAEMON_URL}/api/tags`, { signal: AbortSignal.timeout(15_000) })
      .then((response) => response.ok)
      .catch(() => false);

const daemonTest = daemonUp ? test : test.skip;

daemonTest("the daemon listing comes back parsed, with an id per model", async () => {
  const models = (await fetchDaemonModels())._unsafeUnwrap();

  expect(models.length).toBeGreaterThan(0);
  for (const model of models) {
    expect(model.id).not.toBe("");
    expect(typeof model.thinking).toBe("boolean");
    expect(typeof model.tools).toBe("boolean");
  }
});

// The point of the whole command: the file it writes has to be one Pi accepts. Resolving a model
// through a real ModelRuntime is the only way to know that — a hand-checked shape is not proof.
daemonTest("Pi resolves the panel out of the generated models.json", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rejudge-live-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "rejudge-live-agent-"));

  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const models = (await fetchDaemonModels())._unsafeUnwrap();
    const report = runOllamaSetup(models, { cwd, project: true, dryRun: false, force: false });

    // A machine with fewer than four usable models cannot prove this; say so instead of failing.
    if (report.isErr()) {
      expect(report.error).toMatch(/needs 4/);
      return;
    }

    const paths = setupPaths(cwd, true);
    expect(paths.modelsJson).toBe(join(agentDir, "models.json"));

    const runtime = await ModelRuntime.create({
      modelsPath: paths.modelsJson,
      authPath: join(agentDir, "auth.json"),
    });

    for (const id of [...report.value.panel.reviewers, report.value.panel.judge]) {
      expect(runtime.getModel("ollama", id), id).toBeTruthy();
    }
    expect(runtime.getError()).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
