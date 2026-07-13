/**
 * Progress events the review engine emits, and the sink it emits them through.
 *
 * The engine writes nothing to stdout/stderr on its own. Instead it emits structured
 * {@link ProgressEvent}s to a caller-supplied {@link ActivitySink}; each consumer renders
 * them its own way (the CLI → stderr lines with durations; the `rejudge` tool → its live
 * block). With no sink the engine is silent — both output channels belong to the consumer.
 * Every event carries `t` (epoch ms) so a consumer can place it on a timeline. Agent events also
 * carry a stable `roleKey`; `model` is display metadata and may be duplicated.
 */

/** A model's role in a review run: an individual reviewer or the judge. */
export type ModelRole = "reviewer" | "judge";

/** Stable internal address for one agent slot. Model IDs are display metadata, not keys. */
export type RoleKey = "judge" | `panel-${number}`;

export const JUDGE_ROLE_KEY: RoleKey = "judge";

/** Stable one-based key for a zero-based panel slot. */
export function panelRoleKey(index: number): RoleKey {
  return `panel-${index + 1}`;
}

/** A collective stage in a review run. */
export type ReviewStage = "panel" | "judge";

/** Terminal state of a single model, or of the whole run. */
export type RunStatus = "done" | "error" | "cancelled";

/**
 * One progress event. The union is discriminated by `kind`:
 * - `model_start` / `model_end` bracket one inner agent (reviewer or judge);
 * - `activity` brackets one step inside an agent (a tool call, or the `thinking`/`writing`
 *   phases), `phase:"start"` when it begins and `phase:"end"` when it finishes — the end
 *   carries `durationMs`, or `aborted:true` (with a partial `durationMs`) if the run was
 *   torn down with the step still open;
 * - `stage_end` marks the panel or judge stage finishing (its own elapsed time);
 * - `total` marks the whole run finishing;
 * - `diagnostic` carries an out-of-band notice (e.g. a debug-log path) that would
 *   otherwise have gone to stderr.
 */
export type ProgressEvent =
  | { kind: "model_start"; t: number; roleKey: RoleKey; model: string; role: ModelRole }
  | {
      kind: "activity";
      t: number;
      roleKey: RoleKey;
      model: string;
      activity: string;
      /** A short summary of the step: a read's path / git_diff's mode for tools, or the live
       *  tail of the streamed text for thinking/writing. `update` refreshes it mid-step. */
      detail?: string;
      phase: "start" | "update" | "end";
      durationMs?: number;
      aborted?: boolean;
    }
  | {
      kind: "model_end";
      t: number;
      roleKey: RoleKey;
      model: string;
      role: ModelRole;
      status: RunStatus;
      durationMs: number;
      error?: string;
    }
  | { kind: "stage_end"; t: number; stage: ReviewStage; durationMs: number }
  | { kind: "total"; t: number; durationMs: number; status: RunStatus }
  | { kind: "diagnostic"; t: number; severity: "info" | "warn" | "error"; message: string };

/**
 * A consumer-supplied progress sink. The engine calls it synchronously as events occur.
 * It must not throw back into the engine — a rendering/logging failure is the consumer's
 * problem, never the run's.
 */
export type ActivitySink = (event: ProgressEvent) => void;

/** Short display name for a `"provider/model"` id — the part after the last slash. */
export function shortModel(modelId: string): string {
  return modelId.slice(modelId.lastIndexOf("/") + 1);
}

/**
 * A duration as `NNs` under a minute (two-digit seconds — `01s`, `41s`) or `NmNNs` at/over a
 * minute (`2m10s`, `10m02s`). Sub-second rounds down to `00s`. One format everywhere — the
 * live UI block and the CLI log — so durations read the same in both.
 */
export function formatDur(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${String(total).padStart(2, "0")}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}
