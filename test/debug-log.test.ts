import { test, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { truncate } from "../src/debug-log.ts";
import { fuse } from "../src/fusion.ts";
import type { FusionConfig } from "../src/config.ts";
import { integrationTest } from "./integration.ts";

// Pure logic: head-3 + "N omitted" + tail-3, then a hard char cap. Literal in/out, no mocks.
test("truncate keeps short content, collapses the middle of long content, caps huge content", () => {
  expect(truncate("a\nb\nc")).toBe("a\nb\nc"); // <= 6 lines: untouched
  expect(truncate("1\n2\n3\n4\n5\n6\n7\n8")).toBe("1\n2\n3\n… 2 lines omitted …\n6\n7\n8");
  const huge = "x".repeat(5000); // one giant line: line rule doesn't fire, char cap does
  const out = truncate(huge);
  expect(out.startsWith("x".repeat(2000))).toBe(true);
  expect(out).toContain("more chars");
  expect(out.length).toBeLessThan(huge.length);
});

// Real run, no mocks: enable debugLog, run a fusion in a temp cwd, then read the file it
// produced and assert it's valid JSONL carrying the expected fields.
const STUB = "opencode-go/kimi-k2.6";
const CONFIG: FusionConfig = {
  panel: [STUB, STUB, STUB],
  synth: STUB,
  thinking: { panel: "minimal", synth: "minimal" },
  debugLog: true,
};

integrationTest("a debugLog run writes a per-run JSONL file of inner-agent activity", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-fusion-dbg-"));
  const result = await fuse(CONFIG, "Reply with exactly the word: PONG. Nothing else.", { cwd });
  expect(result.isOk()).toBe(true);

  const dir = join(cwd, ".pi", "fusion-logs");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  expect(files.length).toBe(1);

  const lines = readFileSync(join(dir, files[0]), "utf8").trim().split("\n");
  expect(lines.length).toBeGreaterThan(0);
  const records = lines.map((l) => JSON.parse(l));
  for (const r of records) {
    expect(typeof r.t).toBe("number");
    expect(typeof r.model).toBe("string");
    expect(typeof r.kind).toBe("string");
  }
  // The run did real work, so at least one substantive activity kind shows up.
  expect(records.some((r) => ["thinking", "text", "tool_call", "tool_result"].includes(r.kind))).toBe(true);
}, 180_000);
