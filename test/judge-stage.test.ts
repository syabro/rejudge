import { err, ok } from "neverthrow";
import { expect, test, vi } from "vitest";
import type { ProgressEvent } from "../src/events.ts";
import { runJudgeStage } from "../src/judge-stage.ts";
import type { ReviewerResult } from "../src/runner.ts";

function fakePanel() {
  const dispose = vi.fn();
  const panel: ReviewerResult[] = [
    {
      roleKey: "panel-1",
      modelId: "provider/model",
      text: "review",
      session: { dispose } as unknown as ReviewerResult["session"],
    },
  ];

  return { panel, dispose };
}

test("runJudgeStage supplies ask_panel and emits one successful stage event", async () => {
  const { panel, dispose } = fakePanel();
  const events: ProgressEvent[] = [];

  const result = await runJudgeStage(
    panel,
    (event) => events.push(event),
    undefined,
    async (askPanel) => {
      expect(askPanel.name).toBe("ask_panel");
      return ok("answer");
    },
  );

  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    expect(result.value).toBe("answer");
  }
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: "stage_end",
    stage: "judge",
    durationMs: expect.any(Number),
  });
  expect(dispose).not.toHaveBeenCalled();
});

test("runJudgeStage returns caller errors without emitting completion events", async () => {
  const { panel, dispose } = fakePanel();
  const events: ProgressEvent[] = [];
  const failure = { source: "resume", message: "could not reopen judge" };

  const result = await runJudgeStage(
    panel,
    (event) => events.push(event),
    undefined,
    async () => err(failure),
  );

  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error).toBe(failure);
  }
  expect(events).toHaveLength(0);
  expect(dispose).not.toHaveBeenCalled();
});
