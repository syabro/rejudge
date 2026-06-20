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
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/judge", role: "synth" });
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/panel-a", role: "panel" });
  applyEvent(s, { kind: "model_start", t: 0, model: "prov/panel-b", role: "panel" });
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
    role: "panel",
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
  expect(lines.some((l) => l.includes("Fusion"))).toBe(true);
});
