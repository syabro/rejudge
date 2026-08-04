import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Result } from "neverthrow";
import { makeAskPanelTool } from "./ask-panel-tool.ts";
import type { DebugLog } from "./debug-log.ts";
import type { ActivitySink } from "./events.ts";
import type { ReviewerResult } from "./runner.ts";

export async function runJudgeStage<T, E>(
  panel: ReviewerResult[],
  activitySink: ActivitySink | undefined,
  debugLog: DebugLog | undefined,
  executeJudge: (askPanel: ToolDefinition) => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  const askPanel = makeAskPanelTool(panel, activitySink, debugLog);
  const startedAt = Date.now();
  const result = await executeJudge(askPanel);

  if (result.isOk()) {
    const endedAt = Date.now();
    activitySink?.({
      kind: "stage_end",
      t: endedAt,
      stage: "judge",
      durationMs: endedAt - startedAt,
    });
  }

  return result;
}
