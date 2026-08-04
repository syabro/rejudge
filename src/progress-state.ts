import type { ModelRole, ProgressEvent, RoleKey } from "./events.ts";
import { reviewMode, type ReviewerToolPolicy, type ReviewMode } from "./review-mode.ts";

export type ModelStatus = "running" | "done" | "error" | "cancelled";

/** Live state of one inner agent, built up from its progress events. */
export interface ModelProgress {
  roleKey: RoleKey;
  model: string;
  role: ModelRole;
  status: ModelStatus;
  activity?: string;
  detail?: string;
  activityStartedAt?: number;
  activityEndedAt?: number;
  startedAt: number;
  endedAt?: number;
  toolCount: number;
  error?: string;
}

/** Snapshot of a review's progress. */
export interface ProgressSnapshot {
  startedAt: number;
  endedAt?: number;
  status: ModelStatus;
  mode?: ReviewMode;
  toolPolicy?: ReviewerToolPolicy;
  title?: string;
  request?: string;
  reviewerModels: string[];
  judgeModel: string;
  models: ModelProgress[];
  diagnostics: { severity: "info" | "warn" | "error"; message: string }[];
}

export function createProgressState(
  reviewerModels: string[],
  judgeModel: string,
  title?: string,
  request?: string,
  mode: ReviewMode = reviewMode(),
  toolPolicy?: ReviewerToolPolicy,
  startedAt: number = Date.now(),
): ProgressSnapshot {
  return {
    startedAt,
    status: "running",
    mode,
    toolPolicy,
    title,
    request,
    reviewerModels: [...reviewerModels],
    judgeModel,
    models: [],
    diagnostics: [],
  };
}

/** Apply one engine event to the snapshot (mutates in place). */
export function applyEvent(state: ProgressSnapshot, event: ProgressEvent): void {
  const find = (roleKey: RoleKey): ModelProgress | undefined =>
    state.models.find((model) => model.roleKey === roleKey);

  switch (event.kind) {
    case "model_start": {
      const existing = find(event.roleKey);
      const fresh: ModelProgress = {
        roleKey: event.roleKey,
        model: event.model,
        role: event.role,
        status: "running",
        startedAt: event.t,
        toolCount: 0,
      };
      if (existing) {
        Object.assign(existing, fresh);
        existing.activity = undefined;
        existing.detail = undefined;
        existing.activityStartedAt = undefined;
        existing.activityEndedAt = undefined;
        existing.endedAt = undefined;
        existing.error = undefined;
      } else {
        state.models.push(fresh);
      }
      return;
    }

    case "activity": {
      const model = find(event.roleKey);
      if (!model || model.status !== "running") return;

      if (event.phase === "start") {
        model.activity = event.activity;
        model.detail = event.detail;
        model.activityStartedAt = event.t;
        model.activityEndedAt = undefined;
        if (event.activity !== "thinking" && event.activity !== "writing") {
          model.toolCount++;
        }
      } else if (event.phase === "update") {
        if (model.activity === event.activity) model.detail = event.detail;
      } else if (model.activity === event.activity) {
        model.activityEndedAt = event.t;
      }
      return;
    }

    case "model_end": {
      const model = find(event.roleKey);
      if (model) {
        model.status = event.status;
        model.endedAt = event.t;
        model.activity = undefined;
        model.detail = undefined;
        model.activityStartedAt = undefined;
        model.activityEndedAt = undefined;
        if (event.error) {
          model.error = event.error;
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
  }
}
