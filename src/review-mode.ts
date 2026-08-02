export type ReviewMode =
  | { readonly kind: "fresh" }
  | { readonly kind: "resumed"; readonly runId: string };

/** Derive the user-visible launch mode from the actual resume parameter. */
export function reviewMode(resumeRunId?: string): ReviewMode {
  const runId = resumeRunId?.trim();
  return runId ? { kind: "resumed", runId } : { kind: "fresh" };
}

/** The unchanged flat-log mode label used by non-TTY CLI output. */
export function formatReviewMode(mode: ReviewMode): string {
  return mode.kind === "resumed"
    ? `Mode: resumed — ${mode.runId}`
    : "Mode: fresh — new panel";
}

export interface ReviewerToolPolicy {
  fullTools: boolean;
  tools: readonly string[];
}

interface ModeLineTheme {
  fg(color: "dim" | "error", text: string): string;
  bold(text: string): string;
}

export const DANGEROUS_REVIEWER_TOOLS = ["edit", "write", "bash"] as const;
const DANGEROUS_TOOLS = new Set<string>(DANGEROUS_REVIEWER_TOOLS);

/** The shared TTY/Pi mode line, including the exact tools granted to panel agents. */
export function formatLiveReviewMode(
  mode: ReviewMode,
  policy: ReviewerToolPolicy,
  theme: ModeLineTheme,
): string {
  const launch = mode.kind === "resumed"
    ? `${theme.bold("Resume")} ${theme.fg("dim", mode.runId)}`
    : theme.bold("Fresh");
  const safety = policy.fullTools
    ? theme.fg("error", theme.bold("⚠ UNSAFE"))
    : theme.bold("read-only");
  const tools = policy.tools.map((tool) =>
    theme.fg(policy.fullTools && DANGEROUS_TOOLS.has(tool) ? "error" : "dim", tool)
  ).join(theme.fg("dim", ", "));

  return `${launch}${theme.fg("dim", " | ")}${safety} ${tools}`;
}
