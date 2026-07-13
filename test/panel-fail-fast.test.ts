import { beforeEach, expect, test, vi } from "vitest";
import { err, ok, type Result } from "neverthrow";
import type { ModelSpec } from "../src/config.ts";
import type { AgentFailure, ReviewerResult } from "../src/runner.ts";

vi.mock("../src/runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/runner.ts")>();
  return { ...actual, runReviewer: vi.fn() };
});

const { runReviewer } = await import("../src/runner.ts");
const { runPanel } = await import("../src/panel.ts");

const mockedRunReviewer = vi.mocked(runReviewer);
const SLOW: ModelSpec = { id: "provider/slow", level: "minimal" };
const FAILS: ModelSpec = { id: "provider/fails", level: "minimal" };

function fakeResult(modelId: string): ReviewerResult {
  return {
    modelId,
    text: "late success",
    session: { dispose: vi.fn() } as unknown as ReviewerResult["session"],
  };
}

beforeEach(() => {
  mockedRunReviewer.mockReset();
});

test("runPanel aborts in-flight siblings when the first agent fails", async () => {
  let markSlowStarted!: () => void;
  const slowStarted = new Promise<void>((resolve) => {
    markSlowStarted = resolve;
  });
  let slowObservedAbort = false;
  let slowCleanupDone = false;

  mockedRunReviewer.mockImplementation(async (modelId, _prompt, options): Promise<Result<ReviewerResult, AgentFailure>> => {
    if (modelId === SLOW.id) {
      markSlowStarted();
      const signal = options?.signal;
      return new Promise((resolve) => {
        const fallback = setTimeout(() => {
          resolve(ok(fakeResult(modelId)));
        }, 50);

        const onAbort = () => {
          slowObservedAbort = Boolean(signal?.aborted);
          clearTimeout(fallback);
          setTimeout(() => {
            slowCleanupDone = true;
            resolve(err({ model: modelId, error: "cancelled", aborted: true }));
          }, 0);
        };

        if (signal?.aborted) {
          onAbort();
        } else {
          signal?.addEventListener("abort", onAbort, { once: true });
        }
      });
    }

    if (modelId === FAILS.id) {
      await slowStarted;
      return err({ model: modelId, error: "boom", aborted: false });
    }

    throw new Error(`unexpected model ${modelId}`);
  });

  const result = await runPanel([SLOW, FAILS], "same prompt");

  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error).toEqual({ model: FAILS.id, error: "boom", aborted: false });
  }
  expect(slowObservedAbort).toBe(true);
  expect(slowCleanupDone).toBe(true);
});
