import { type ActivitySink, formatDur, shortModel } from "./events.ts";

/**
 * A progress sink that writes a review's activity to **stderr** as a plain append log —
 * the CLI renderer. (The `rejudge` tool uses a live in-place block instead; see the extension.)
 * stderr is the right channel here: the review answer owns stdout, so the log
 * never pollutes it, and a terminal shows it live.
 *
 * One line per step as it finishes (with its duration), one per model and stage end, and a
 * final total — plus any diagnostics. Concurrent panel agents interleave; the model name
 * tells their lines apart, as before.
 */
export function createStderrSink(): ActivitySink {
  const ts = (t: number): string => new Date(t).toTimeString().slice(0, 8);
  return (event) => {
    switch (event.kind) {
      case "activity": {
        // One line per step, printed when it finishes, with its duration — `HH:MM:SS <model>
        // <step> <dur>`. The model name disambiguates interleaved concurrent agents.
        if (event.phase !== "end") return;
        const detail = event.detail ? ` ${event.detail}` : "";
        const dur = event.durationMs != null ? ` ${formatDur(event.durationMs)}` : "";
        const cancelled = event.aborted ? " (cancelled)" : "";
        console.error(`${ts(event.t)} ${shortModel(event.model)} ${event.activity}${detail}${dur}${cancelled}`);
        return;
      }
      case "model_end": {
        const tail =
          event.status === "done"
            ? `done in ${formatDur(event.durationMs)}`
            : event.status === "cancelled"
              ? `cancelled after ${formatDur(event.durationMs)}`
              : `error after ${formatDur(event.durationMs)}${event.error ? `: ${event.error}` : ""}`;
        console.error(`${ts(event.t)} ${shortModel(event.model)} ${tail}`);
        return;
      }
      case "stage_end":
        console.error(`${ts(event.t)} ${event.stage} stage done in ${formatDur(event.durationMs)}`);
        return;
      case "total": {
        const word = event.status === "done" ? "done" : event.status;
        console.error(`rejudge ${word} in ${formatDur(event.durationMs)}`);
        return;
      }
      case "diagnostic":
        console.error(`rejudge: ${event.message}`);
        return;
      // model_start is implied by the model's first activity line — no separate line.
    }
  };
}
