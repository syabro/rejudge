import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  JUDGE_ROLE_KEY,
  panelRoleKey,
  formatDur,
  shortModel,
} from "./events.ts";
import {
  formatLiveReviewMode,
  formatReviewMode,
} from "./review-mode.ts";
import {
  type ModelProgress,
  type ModelStatus,
  type ProgressSnapshot,
} from "./progress-state.ts";
import type { ModelSpec } from "./config.ts";

export { applyEvent, createProgressState, type ProgressSnapshot } from "./progress-state.ts";

/**
 * The live-progress model and renderer for the `rejudge` tool block: a snapshot built
 * up from the engine's {@link ProgressEvent}s ({@link applyEvent}) and drawn as a 3-level
 * tree ({@link renderProgress}). Kept out of the extension entry so the entry stays just
 * registration + plumbing.
 */

/**
 * The slice of Pi's `Theme` this renderer actually uses. Narrowed to a structural interface so
 * the block can also be drawn outside a Pi host — the CLI passes a small ANSI implementation
 * (see `tty-progress.ts`) instead of constructing a real `Theme`, whose constructor demands a
 * full palette. Pi's `Theme` class satisfies this, so the extension passes its host theme as-is.
 */
export interface ProgressTheme {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
}

/**
 * The header title for a run: the caller's explicit title, else the question's first line,
 * clipped. Shared so the CLI block and the Pi tool title a run by the same rule.
 */
/** The part of a persisted session reference this needs: which model ran, and at which level. */
type SessionModel = { modelId: string; level: ModelSpec["level"] };

/**
 * The models and levels a run reports and labels itself with.
 *
 * A resume reopens the sessions recorded in the manifest, not whatever the config names now — the
 * config may have been edited since. Reading the config instead would put the wrong model on every
 * progress row and in the preamble, and a changed reviewer count would leave rows that never start.
 */
export function panelSpecs(
  config: { reviewers: readonly ModelSpec[]; judge: ModelSpec },
  manifest: { reviewers: readonly SessionModel[]; judge: SessionModel } | undefined,
): { reviewers: ModelSpec[]; judge: ModelSpec } {
  if (!manifest) {
    return { reviewers: [...config.reviewers], judge: config.judge };
  }

  const spec = (ref: SessionModel): ModelSpec => ({ id: ref.modelId, level: ref.level });
  return { reviewers: manifest.reviewers.map(spec), judge: spec(manifest.judge) };
}

export function progressTitle(question: string, title?: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit;

  const firstLine = question.trim().split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
}

/** Pad to a visible width with trailing spaces (no truncation — width is the row max). */
function padTo(text: string, width: number): string {
  const w = visibleWidth(text);
  return w >= width ? text : text + " ".repeat(width - w);
}

/** `NNs | N tools` — the time-and-tool-count tail shown for every started model. */
function meta(durationMs: number, toolCount: number): string {
  return `${formatDur(durationMs)} | ${toolCount} tool${toolCount === 1 ? "" : "s"}`;
}

/**
 * The status cell for a started model.
 *
 * Finished models render as before: an icon + the status word + `(total | N tools)`, the whole
 * row tinted (green done, red error with its reason, dim cancelled).
 *
 * A running model is a column layout instead — `nn. tool time detail`: a dimmed tool number
 * (count so far) with a trailing dot, the step name padded to a column, the step's duration,
 * then `detail` (returned separately, raw — params or the streamed-text tail; the caller dims
 * it and trims it to the row's free width). The duration ticks live while the step runs and
 * freezes once it ends — so the gap between calls keeps showing the previous step, not a blank.
 * Before the first step (nothing has run yet) the cell is empty; the root clock carries the
 * liveness.
 */
function statusCell(p: ModelProgress, now: number, theme: ProgressTheme): { text: string; detail?: string } {
  const total = (p.endedAt ?? now) - p.startedAt;
  switch (p.status) {
    case "done":
      return { text: `  ✓  done (${meta(total, p.toolCount)})` };
    case "error":
      return { text: `  ✗ ${p.error ?? "failed"} (${meta(total, p.toolCount)})` };
    case "cancelled":
      return { text: `  ⊘ cancelled (${meta(total, p.toolCount)})` };
    default: {
      if (!p.activity) return { text: "" };
      // Running rows aren't tinted, so the dimmed number reads cleanly inside the line.
      const num = theme.fg("dim", `${String(p.toolCount).padStart(3)}.`);
      const tool = p.activity.padEnd(10);
      const stepMs = (p.activityEndedAt ?? now) - (p.activityStartedAt ?? now);
      const time = formatDur(stepMs).padStart(5);
      return { text: `${num} ${tool} ${time}`, detail: p.detail };
    }
  }
}

/** Tint a whole row by a model's status: done green, error red, cancelled/waiting dim. */
function tintRow(theme: ProgressTheme, status: ModelStatus | "waiting", line: string): string {
  switch (status) {
    case "done":
      return theme.fg("success", line);
    case "error":
      return theme.fg("error", line);
    case "cancelled":
    case "waiting":
      return theme.fg("dim", line);
    default:
      return line; // running — neutral
  }
}

/**
 * Fit a detail (tool params / streamed text) into `room` columns, keeping the END — the most
 * recent text of a stream, the filename of a path — with a leading ellipsis. Empty when there's
 * no usable room.
 */
function fitDetail(detail: string, room: number): string {
  if (room <= 1) return "";
  const body = detail.replace(/^…/, "");
  if (visibleWidth(body) <= room) return body;
  return `…${body.slice(-(room - 1))}`;
}

/**
 * Final safety net for the TUI contract: every emitted line MUST be ≤ width, or pi-tui throws an
 * uncaught exception that crashes the HOST process. The tree rows fit width by construction, but
 * the expanded fused answer (wrapped at spaces) can still overflow on an unbreakable long token
 * (a path, URL, or code line), and a long error reason can overrun its row — so clamp every line
 * as a last pass. Lossy only on the rare offender; the full answer is always in the result text.
 * A non-finite width (the unbounded default used in tests) means no clamping.
 */
function clampLines(lines: string[], width: number): string[] {
  if (!Number.isFinite(width)) return lines;
  return lines.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "…") : line));
}

/** Theme color for a diagnostic line per severity. */
const DIAGNOSTIC_COLOR = { error: "error", warn: "warning", info: "dim" } as const;

/** One model row before alignment: its tree-and-name left part, its status cell, and the
 *  raw (undimmed, untrimmed) detail to append once the shared column width is known. */
interface Row {
  left: string;
  text: string;
  detail?: string;
  status: ModelStatus | "waiting";
}

/**
 * Draw the live 3-level progress tree as lines, fit to `width` columns:
 *
 *     Rejudge
 *     Mode: resumed — 2026-07-16T00-00-00-000Z-run123
 *     review the runner change (ctrl+o to expand)
 *       glm-5.1 (judge)        0. thinking   12s  …keep it concise
 *         ⎿ deepseek-v4-pro    2. read       03s  src/runner.ts
 *         ⎿ minimax-m3        ✓  done (35s | 6 tools)
 *     Total 41s
 *
 * Line 1 is bold `Rejudge`, colored by status (green done, red fail, dim cancel, neutral running).
 * The shared mode label follows it, then the query: collapsed → a clipped title + the dimmed ctrl+o
 * hint (shown above); expanded (Ctrl+O) → the full request under a dim `Request:` label, falling back
 * to the title when blank. `expandable` says whether the host actually binds that key — the CLI
 * draws the same block but has no keyboard, so it passes `false` and the hint is left off. The
 * tree is root → judge → reviewers, the status cell aligned to one shared column across the judge
 * (level 2) and reviewers (level 3). A running row's dimmed detail is trimmed to whatever width is
 * left on the line, so it never wraps. The overall time lives on a dimmed `Total <time>` line at the
 * bottom. `now`/`width` are injected for deterministic tests; `width` defaults to unbounded (no trimming).
 */
export function renderProgress(
  s: ProgressSnapshot,
  theme: ProgressTheme,
  now: number = Date.now(),
  width: number = Number.POSITIVE_INFINITY,
  expanded = false,
  expandable = true,
): string[] {
  const byRoleKey = new Map(s.models.map((model) => [model.roleKey, model]));

  // Header line 1: bold "Rejudge", colored by status (the time lives on the Total line).
  const lines = [tintRow(theme, s.status, theme.bold("Rejudge"))];
  if (s.mode && s.toolPolicy) {
    lines.push(formatLiveReviewMode(s.mode, s.toolPolicy, theme));
  } else if (s.mode) {
    lines.push(formatReviewMode(s.mode));
  }

  // The next header lines hold the query. Collapsed → one clipped title line + a dimmed expand hint; expanded
  // (Ctrl+O) → the full request (what was sent to the panel), wrapped, under a dim "Request:" label,
  // falling back to the title when there's no request. Clip/wrap the plain text so a long query
  // never wraps by accident; the trailing clampLines still guards an unbreakable long token.
  const title = s.title?.trim();
  const request = s.request?.trim();
  if (expanded) {
    if (request) {
      lines.push(theme.fg("dim", "Request:"));
      lines.push(...wrapTextWithAnsi(request, width));
    } else if (title) {
      lines.push(...wrapTextWithAnsi(title, width));
    }
  } else if (title && expandable) {
    const hint = " (ctrl+o to expand)";
    lines.push(`${truncateToWidth(title, width - hint.length, "…")}${theme.fg("dim", hint)}`);
  } else if (title) {
    // No key to press — the title gets the whole line instead of making room for the hint.
    lines.push(truncateToWidth(title, width, "…"));
  }

  // Build each role-keyed model row, then align the status cell to one shared column.
  const judgeName = shortModel(s.judgeModel);
  const judge = byRoleKey.get(JUDGE_ROLE_KEY);
  const rows: Row[] = [
    {
      left: `  ${judgeName} (judge)`,
      ...(judge ? statusCell(judge, now, theme) : { text: "  waiting…" }),
      status: judge?.status ?? "waiting",
    },
  ];

  const nameW = Math.max(1, ...s.reviewerModels.map((model) => visibleWidth(shortModel(model))));
  for (const [index, modelId] of s.reviewerModels.entries()) {
    const p = byRoleKey.get(panelRoleKey(index));
    rows.push({
      left: `    ⎿ ${padTo(shortModel(modelId), nameW)}`,
      ...(p ? statusCell(p, now, theme) : { text: "  waiting…" }),
      status: p?.status ?? "waiting",
    });
  }

  const leftW = Math.max(...rows.map((r) => visibleWidth(r.left)));

  for (const r of rows) {
    let body = `${padTo(r.left, leftW)}  ${r.text}`;
    if (r.detail) {
      const shown = fitDetail(r.detail, width - visibleWidth(body) - 1);
      if (shown) body += ` ${theme.fg("dim", shown)}`;
    }
    lines.push(tintRow(theme, r.status, body.trimEnd()));
  }

  for (const d of s.diagnostics) {
    const text = `  ${d.severity === "info" ? "" : "⚠ "}${d.message}`;
    lines.push(theme.fg(DIAGNOSTIC_COLOR[d.severity], truncateToWidth(text, width, "…")));
  }

  lines.push(theme.fg("dim", `Total ${formatDur((s.endedAt ?? now) - s.startedAt)}`));
  return clampLines(lines, width);
}

/**
 * A width-aware {@link Component} that draws the progress block: each `render(width)` lays the
 * tree out for the host's current viewport width (so the detail column trims instead of
 * wrapping, and a resize reflows). When `expanded` (Ctrl+O) it shows the full query in the
 * header and appends the fused answer wrapped to width.
 */
export function progressComponent(
  s: ProgressSnapshot,
  theme: ProgressTheme,
  expanded: boolean,
  answer?: string,
): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      const lines = renderProgress(s, theme, Date.now(), width, expanded);
      if (expanded && answer && answer.trim()) {
        lines.push("", ...wrapTextWithAnsi(answer, width));
      }
      // renderProgress already clamped its own lines; clamp again so the appended answer
      // (wrapped only at spaces) can't overflow width and crash the host TUI.
      return clampLines(lines, width);
    },
  };
}
