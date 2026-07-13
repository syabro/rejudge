import { test, expect } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  applyEvent,
  createProgressState,
  progressComponent,
  renderProgress,
  type ProgressSnapshot,
} from "../src/progress.ts";

// A no-op theme: returns the text unstyled, so visibleWidth measures the plain content. Enough to
// exercise the layout/width logic without a real terminal theme.
const THEME = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

/** Seed a running snapshot with the panel + judge started. */
function seeded(): ProgressSnapshot {
  const s = createProgressState(["prov/panel-a", "prov/panel-b"], "prov/judge", "a title");
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/judge", role: "judge" });
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/panel-a", role: "reviewer" });
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/panel-b", role: "reviewer" });
  return s;
}

// The bug that crashed the host (pi-tui throws when any rendered line exceeds the terminal width):
// the expanded fused answer is wrapped only at spaces, so an unbreakable long token overflowed.
// Every line the component emits must be ≤ width.
test("progressComponent never emits a line wider than width, even with an unbreakable answer", () => {
  const s = seeded();
  const width = 40;
  // A 300-char token with no spaces — wrapTextWithAnsi can't break it, so without the clamp this
  // line is ~300 wide and crashes the TUI.
  const answer = "see " + "x".repeat(300) + " for details\nshort line";

  const lines = progressComponent(s, THEME, true, answer).render(width);

  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
});

// A long error reason overruns its row (the row's status text isn't trimmed) — also clamped.
test("renderProgress clamps a long error-reason row to width", () => {
  const s = seeded();
  applyEvent(s, {
    kind: "model_end",
    t: 5000,
    model: "prov/panel-a",
    role: "reviewer",
    status: "error",
    durationMs: 5000,
    error: "boom ".repeat(60).trim(),
  });

  const width = 50;
  for (const line of renderProgress(s, THEME, 6000, width)) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
});

// Unbounded width (the default) must not clamp — lines pass through unchanged.
test("renderProgress leaves lines untouched at unbounded width", () => {
  const s = seeded();
  const lines = renderProgress(s, THEME, 1000);
  expect(lines.some((line) => line.includes("Rejudge"))).toBe(true);
});

// EXT-034: Ctrl+O (expanded) shows the full request, labeled, above the tree and the answer; the
// collapsed view shows only the clipped title + the expand hint, never the full request.
test("expanded view shows the full request first; collapsed keeps it behind the title", () => {
  const s = createProgressState(
    ["prov/panel-a", "prov/panel-b"],
    "prov/judge",
    "short title",
    "REQ-LINE-1\nREQ-LINE-2",
  );
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/judge", role: "judge" });
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/panel-a", role: "reviewer" });
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/panel-b", role: "reviewer" });

  // Collapsed: the clipped title + the expand hint; the full request stays hidden.
  const collapsed = renderProgress(s, THEME, 0, 80, false).join("\n");
  expect(collapsed).toContain("short title");
  expect(collapsed).toContain("ctrl+o to expand");
  expect(collapsed).not.toContain("REQ-LINE-1");

  // Expanded: both request lines show under a "Request:" label; the title and expand hint are gone.
  const lines = progressComponent(s, THEME, true, "THE-ANSWER").render(80);
  const joined = lines.join("\n");
  expect(joined).toContain("Request:");
  expect(joined).toContain("REQ-LINE-1");
  expect(joined).toContain("REQ-LINE-2");
  expect(joined).not.toContain("ctrl+o to expand");
  expect(joined).not.toContain("short title");

  // Ordering: the label, then the request, sit above the judge tree row, above the appended answer.
  const idx = (needle: string) => lines.findIndex((l) => l.includes(needle));
  expect(idx("Request:")).toBeGreaterThanOrEqual(0);
  expect(idx("Request:")).toBeLessThan(idx("REQ-LINE-1"));
  expect(idx("REQ-LINE-1")).toBeLessThan(idx("judge (judge)"));
  expect(idx("judge (judge)")).toBeLessThan(idx("THE-ANSWER"));
});

// Blank/undefined request must fall back to the title (no empty header line, no "Request:" label).
test("expanded view falls back to the title when the request is missing or blank", () => {
  for (const request of [undefined, "   "]) {
    const s = createProgressState(["prov/panel-a"], "prov/judge", "fallback title", request);
    const joined = renderProgress(s, THEME, 0, 80, true).join("\n");
    expect(joined).toContain("fallback title");
    expect(joined).not.toContain("Request:");
  }
});

// A long unbreakable request must stay within width when expanded (the crash contract).
test("a long unbreakable request stays within width when expanded", () => {
  const s = createProgressState(["prov/panel-a"], "prov/judge", "t", "ask " + "y".repeat(300));
  const width = 40;
  for (const line of progressComponent(s, THEME, true, "ans").render(width)) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
});

// During ask_panel, a panel model that already finished round 1 starts again on the same row.
test("a completed panel row reopens during an ask_panel re-query", () => {
  const s = createProgressState(["prov/panel-a"], "prov/judge", "a title");
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/panel-a", role: "reviewer" });
  applyEvent(s, { kind: "activity", t: 100, model: "prov/panel-a", activity: "read", phase: "start", detail: "src/file.ts" });
  applyEvent(s, { kind: "model_end", t: 1000, model: "prov/panel-a", role: "reviewer", status: "done", durationMs: 1000 });

  expect(renderProgress(s, THEME, 1500, 120).join("\n")).toContain("✓ done");

  applyEvent(s, { kind: "model_start", t: 2000, model: "prov/panel-a", role: "reviewer" });
  applyEvent(s, { kind: "activity", t: 2500, model: "prov/panel-a", activity: "writing", phase: "start", detail: "checking again" });

  const running = renderProgress(s, THEME, 3000, 120).join("\n");
  expect(s.models).toHaveLength(1);
  expect(running).toContain("writing");
  expect(running).toContain("checking again");
  expect(running).not.toContain("✓ done");

  applyEvent(s, { kind: "activity", t: 3200, model: "prov/panel-a", activity: "writing", phase: "end", durationMs: 700 });
  applyEvent(s, { kind: "model_end", t: 4000, model: "prov/panel-a", role: "reviewer", status: "done", durationMs: 2000 });

  expect(renderProgress(s, THEME, 4500, 120).join("\n")).toContain("✓ done");
});
