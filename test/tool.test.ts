import { test, expect } from "vitest";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { resolve, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

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
