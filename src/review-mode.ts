export type ReviewMode =
  | { readonly kind: "fresh" }
  | { readonly kind: "resumed"; readonly runId: string };

/** Derive the user-visible launch mode from the actual resume parameter. */
export function reviewMode(resumeRunId?: string): ReviewMode {
  const runId = resumeRunId?.trim();
  return runId ? { kind: "resumed", runId } : { kind: "fresh" };
}

/** The shared mode label shown by the Pi tool and CLI before model work starts. */
export function formatReviewMode(mode: ReviewMode): string {
  return mode.kind === "resumed"
    ? `Mode: resumed — ${mode.runId}`
    : "Mode: fresh — new panel";
}
