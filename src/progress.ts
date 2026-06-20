import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type ModelRole, type ProgressEvent, formatDur, shortModel } from "./events.ts";

/**
 * The live-progress model and renderer for the `fusion_agents` tool block: a snapshot built
 * up from the engine's {@link ProgressEvent}s ({@link applyEvent}) and drawn as a 3-level
 * tree ({@link renderProgress}). Kept out of the extension entry so the entry stays just
 * registration + plumbing.
 */

type ModelStatus = "running" | "done" | "error" | "cancelled";

/** Live state of one inner agent, built up from its progress events. */
interface ModelProgress {
  /** Full "provider/model" id. */
  model: string;
  role: ModelRole;
  status: ModelStatus;
  /** Current step while running (a tool name, or "thinking"/"writing"); cleared when it ends. */
  activity?: string;
  /** Short params of the current/last step (a read's path, …), shown dimmed. */
  detail?: string;
  /** When the current/last step started — for its duration. */
  activityStartedAt?: number;
  /** When the last step ended; set means it's finished and shown frozen until the next starts. */
  activityEndedAt?: number;
  startedAt: number;
  endedAt?: number;
  /** How many tool calls this agent has started (thinking/writing don't count). */
  toolCount: number;
  /** Failure reason, when status is "error". */
  error?: string;
}

/**
 * Snapshot of a fusion's progress, carried in the tool result's `details` and drawn by
 * {@link renderProgress}. The panel + judge model ids are seeded up front so the whole tree
 * shows from the first paint (each row "waiting…" until its model starts).
 */
export interface ProgressSnapshot {
  startedAt: number;
  endedAt?: number;
  status: ModelStatus;
  /** Short title shown in the header (`Fusion <title>`); what this run is about. */
  title?: string;
  /** Full panel model ids, in config order. */
  panelModels: string[];
  /** Full synth ("judge") model id. */
  synthModel: string;
  /** Per-model live state, for models that have started. */
  models: ModelProgress[];
  diagnostics: { severity: "info" | "warn" | "error"; message: string }[];
}

/** A fresh snapshot with the full tree seeded — every row present, none started yet. */
export function createProgressState(panelModels: string[], synthModel: string, title?: string): ProgressSnapshot {
  return {
    startedAt: Date.now(),
    status: "running",
    title,
    panelModels: [...panelModels],
    synthModel,
    models: [],
    diagnostics: [],
  };
}

/** Apply one engine event to the snapshot (mutates in place). */
export function applyEvent(state: ProgressSnapshot, event: ProgressEvent): void {
  const find = (model: string): ModelProgress | undefined => state.models.find((m) => m.model === model);
  switch (event.kind) {
    case "model_start": {
      state.models.push({
        model: event.model,
        role: event.role,
        status: "running",
        startedAt: event.t,
        toolCount: 0,
      });
      return;
    }

    case "activity": {
      const m = find(event.model);
      if (!m || m.status !== "running") return;

      if (event.phase === "start") {
        m.activity = event.activity;
        m.detail = event.detail;
        m.activityStartedAt = event.t;
        m.activityEndedAt = undefined;
        if (event.activity !== "thinking" && event.activity !== "writing") {
          m.toolCount++;
        }
      } else if (event.phase === "update") {
        if (m.activity === event.activity) m.detail = event.detail;
      } else if (m.activity === event.activity) {
        // Step ended: keep showing it (frozen at its final duration) until the next starts —
        // so the gap between calls shows the previous tool, not a blank.
        m.activityEndedAt = event.t;
      }
      return;
    }

    case "model_end": {
      const m = find(event.model);
      if (m) {
        m.status = event.status;
        m.endedAt = event.t;
        m.activity = undefined;
        m.detail = undefined;
        m.activityStartedAt = undefined;
        m.activityEndedAt = undefined;
        if (event.error) {
          m.error = event.error;
        }
      }
      return;
    }

    case "total":
      state.status = event.status;
      state.endedAt = event.t;
      return;

    case "diagnostic":
      state.diagnostics.push({ severity: event.severity, message: event.message });
      return;
    // stage_end carries timing only — the per-model and root clocks already cover it.
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────

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
 * A running model is a column layout instead — `nn. tool time args`: a dimmed tool number
 * (count so far) with a trailing dot, the step name padded to a column, the step's duration,
 * then the params / streamed-text tail dimmed. The duration ticks live while the step runs and
 * freezes once it ends — so the gap between calls keeps showing the previous step, not a blank.
 * Before the first step (nothing has run yet) the cell is empty; the root clock carries the
 * liveness.
 */
function statusCell(p: ModelProgress, now: number, theme: Theme): string {
  const total = (p.endedAt ?? now) - p.startedAt;
  switch (p.status) {
    case "done":
      return `  ✓ done (${meta(total, p.toolCount)})`;
    case "error":
      return `  ✗ ${p.error ?? "failed"} (${meta(total, p.toolCount)})`;
    case "cancelled":
      return `  ⊘ cancelled (${meta(total, p.toolCount)})`;
    default: {
      if (!p.activity) return "";
      // Running rows aren't tinted, so the dimmed number/params read cleanly inside the line.
      const num = theme.fg("dim", `${String(p.toolCount).padStart(3)}.`);
      const tool = p.activity.padEnd(10);
      const stepMs = (p.activityEndedAt ?? now) - (p.activityStartedAt ?? now);
      const time = formatDur(stepMs).padStart(5);
      const args = p.detail ? `  ${theme.fg("dim", p.detail)}` : "";
      return `${num} ${tool} ${time}${args}`;
    }
  }
}

/** Tint a whole row by a model's status: done green, error red, cancelled/waiting dim. */
function tintRow(theme: Theme, status: ModelStatus | "waiting", line: string): string {
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

/** Theme color for a diagnostic line per severity. */
const DIAGNOSTIC_COLOR = { error: "error", warn: "warning", info: "dim" } as const;

/** One model row before alignment: its tree-and-name left part and its status cell. */
interface Row {
  left: string;
  cell: string;
  status: ModelStatus | "waiting";
}

/**
 * Draw the live 3-level progress tree as lines:
 *
 *     Fusion review the runner change
 *       glm-5.1 (judge)        0. thinking   12s  …keep it concise
 *         ⎿ deepseek-v4-pro    2. read       03s  src/runner.ts
 *         ⎿ minimax-m3        ✓ done (35s | 6 tools)
 *     Total 41s
 *
 * Header is `Fusion <title>`, colored by status (green done, red fail, dim cancel, neutral
 * running). The tree is root → judge → panel models, the status cell aligned to one shared
 * column across the judge (level 2) and the panels (level 3). The overall time lives on a
 * dimmed `Total <time>` line at the bottom. `now` is injected for deterministic tests.
 */
export function renderProgress(s: ProgressSnapshot, theme: Theme, now: number = Date.now()): string[] {
  const byModel = new Map(s.models.map((m) => [m.model, m]));

  // Header: "Fusion <title>", colored by status. The time is not here — it's the Total line.
  const root = tintRow(theme, s.status, theme.bold(`Fusion${s.title ? ` ${s.title}` : ""}`));

  // Build each model row, then align the status cell to one shared column.
  const judgeName = shortModel(s.synthModel);
  const synth = byModel.get(s.synthModel);
  const rows: Row[] = [
    {
      left: `  ${judgeName} (judge)`,
      cell: synth ? statusCell(synth, now, theme) : "  waiting…",
      status: synth?.status ?? "waiting",
    },
  ];

  const nameW = Math.max(1, ...s.panelModels.map((m) => visibleWidth(shortModel(m))));
  for (const modelId of s.panelModels) {
    const p = byModel.get(modelId);
    rows.push({
      left: `    ⎿ ${padTo(shortModel(modelId), nameW)}`,
      cell: p ? statusCell(p, now, theme) : "  waiting…",
      status: p?.status ?? "waiting",
    });
  }

  const leftW = Math.max(...rows.map((r) => visibleWidth(r.left)));

  const lines = [root];
  for (const r of rows) {
    lines.push(tintRow(theme, r.status, `${padTo(r.left, leftW)}  ${r.cell}`.trimEnd()));
  }

  for (const d of s.diagnostics) {
    const text = `  ${d.severity === "info" ? "" : "⚠ "}${d.message}`;
    lines.push(theme.fg(DIAGNOSTIC_COLOR[d.severity], text));
  }

  lines.push(theme.fg("dim", `Total ${formatDur((s.endedAt ?? now) - s.startedAt)}`));
  return lines;
}
