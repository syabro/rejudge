import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ActivitySink } from "./events.ts";
import { applyEvent, createProgressState, renderProgress, type ProgressTheme } from "./progress.ts";
import type { ReviewerToolPolicy, ReviewMode } from "./review-mode.ts";

/**
 * The CLI's live progress block: the same tree the `rejudge` tool draws inside Pi
 * ({@link renderProgress}), redrawn in place on a terminal.
 *
 * Only for a real terminal. The caller decides by `process.stderr.isTTY` alone — stderr,
 * because that is where progress goes while stdout carries the answer, and `isTTY` alone
 * because `TERM` is set even in environments with no terminal at all (an agent's shell),
 * where these escape sequences would be garbage. Non-TTY runs keep the plain append log
 * in `stderr-sink.ts`.
 *
 * Redraw is cursor-up plus erase-line, not the alternate screen: the block is ordinary
 * scrollback that survives the run, and an interrupted run simply leaves its last frame
 * on screen. Nothing is hidden or switched, so there is no terminal state to restore —
 * which is why a Ctrl-C needs no handler here.
 *
 * Known limitation: another writer to stderr during a run (an SDK warning, say) lands inside
 * the block and desynchronizes the cursor arithmetic until the next full frame. The engine
 * itself writes nothing, so in practice only the CLI's own preamble shares the stream, and
 * that is all printed before the block starts.
 */

/** How often the block repaints on its own, so the clocks advance during a silent step. */
const TICK_MS = 1000;

/** Floor between event-driven repaints — streamed text can emit many events per second. */
const MIN_REDRAW_MS = 80;

/** Assumed terminal size when the stream does not report one. */
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

/** Narrowest layout worth drawing; below this the tree rows have no usable room. */
const MIN_COLUMNS = 24;

/** The bit of a terminal stream the block needs. `process.stderr` satisfies it. */
export interface ProgressStream {
  write(chunk: string): unknown;
  columns?: number;
  rows?: number;
}

/**
 * Whether the live block should be drawn at all — pass `process.stderr`.
 *
 * The rule is deliberately this narrow. It reads **stderr**, because that is the progress
 * channel while stdout carries the answer: `rejudge "…" > answer.txt` in a terminal must still
 * animate, and `rejudge "…" 2> log.txt` must still produce the flat log. It tests for `true`,
 * because Node sets `isTTY` to `true` or leaves it `undefined` — never `false`. And it consults
 * nothing else: `TERM` is set even where no terminal exists at all (inside an agent's shell),
 * so a `TERM`/color/`CI` check would fill that log with escape codes.
 */
export function shouldDrawLiveBlock(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

/** SGR codes for the theme colors {@link renderProgress} actually asks for. */
const FOREGROUND: Partial<Record<ThemeColor, string>> = {
  success: "32",
  error: "31",
  warning: "33",
  dim: "2",
};

/** Reset that ends each style without clobbering an enclosing one (dim/bold share `22`). */
const RESET: Record<string, string> = { "2": "22", "1": "22" };

/**
 * A {@link ProgressTheme} over raw ANSI, for a terminal outside a Pi host.
 *
 * `NO_COLOR` is honored by *presence*, per the no-color.org convention — `NO_COLOR=` and
 * `NO_COLOR=0` disable color just as `NO_COLOR=1` does, so a truthiness test would be wrong.
 */
export function cliTheme(env: NodeJS.ProcessEnv = process.env): ProgressTheme {
  const plain = "NO_COLOR" in env;

  const style = (code: string, text: string): string =>
    plain ? text : `\x1b[${code}m${text}\x1b[${RESET[code] ?? "39"}m`;

  return {
    fg(color, text) {
      const code = FOREGROUND[color];
      return code ? style(code, text) : text;
    },
    bold(text) {
      return style("1", text);
    },
  };
}

export interface TtyProgressOptions {
  /** Full reviewer model ids, in config order — seeds the tree before anything starts. */
  reviewerModels: string[];
  judgeModel: string;
  /** Header title for the run; see `progressTitle`. */
  title?: string;
  mode: ReviewMode;
  toolPolicy: ReviewerToolPolicy;
  /** Defaults to `process.stderr`; injected in tests. */
  stream?: ProgressStream;
  /** Defaults to {@link cliTheme}; injected in tests. */
  theme?: ProgressTheme;
  /** Defaults to `Date.now`; injected so tests can drive the clock. */
  now?: () => number;
}

export interface TtyProgress {
  /** Feed to `runReview` as its `activitySink`. */
  sink: ActivitySink;
  /** Stop repainting and draw the final frame. Safe to call more than once. */
  stop(): void;
}

/**
 * Start drawing the live block. The first frame paints immediately — the seeded tree with every
 * row "waiting…" — so the terminal shows the panel before any model has produced an event.
 */
export function createTtyProgress(options: TtyProgressOptions): TtyProgress {
  const stream = options.stream ?? process.stderr;
  const theme = options.theme ?? cliTheme();
  const now = options.now ?? Date.now;

  const state = createProgressState(
    options.reviewerModels,
    options.judgeModel,
    options.title,
    undefined,
    options.mode,
    options.toolPolicy,
    now(),
  );

  /** Rows the last frame drew — how far to rewind before drawing the next one. */
  let painted = 0;
  let lastPaintAt = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function paint(): void {
    lastPaintAt = now();

    // Re-read the size every frame, so a resize mid-run reflows on the next repaint. One column
    // is left free: a line filling the terminal exactly would trigger deferred autowrap and
    // silently add a row, throwing off the rewind count.
    // Widen to the floor FIRST, then take the spare column — the other order spends the spare
    // column on the floor itself, so a 24-column terminal would get lines filling it exactly.
    // Under the floor the block simply cannot be laid out; drawing it slightly too wide is the
    // accepted degradation there.
    const width = Math.max(MIN_COLUMNS, reported(stream.columns, DEFAULT_COLUMNS)) - 1;
    const height = Math.max(1, reported(stream.rows, DEFAULT_ROWS) - 1);
    // `expandable: false` — the block is drawn by a non-interactive command, so there is no
    // ctrl+o to offer. Only Pi binds that key.
    const lines = fitHeight(renderProgress(state, theme, now(), width, false, false), height);

    // Rewind over the previous frame, then rewrite each row — clearing it first, so a shorter
    // line can't leave the old tail behind.
    let out = painted > 0 ? `\x1b[${painted}A` : "";
    out += "\r";
    for (const line of lines) {
      out += `\x1b[2K${line}\n`;
    }

    // A frame shorter than the last leaves stale rows below it: blank them, then come back up
    // so the cursor still ends directly under the block.
    for (let extra = lines.length; extra < painted; extra++) {
      out += "\x1b[2K\n";
    }
    if (lines.length < painted) {
      out += `\x1b[${painted - lines.length}A`;
    }

    stream.write(out);
    painted = lines.length;
  }

  /**
   * Repaint, but no more often than {@link MIN_REDRAW_MS} — streamed thinking/writing text
   * updates far faster than a terminal can usefully show.
   */
  function schedule(): void {
    if (stopped || pending) return;

    const wait = MIN_REDRAW_MS - (now() - lastPaintAt);
    if (wait <= 0) {
      paint();
      return;
    }

    pending = setTimeout(() => {
      pending = undefined;
      paint();
    }, wait);
    if (typeof pending.unref === "function") {
      pending.unref();
    }
  }

  // Repaint on a timer too, so the running clocks advance through a long step that emits
  // nothing. unref'd, so it never holds the process open on its own.
  const ticker = setInterval(paint, TICK_MS);
  if (typeof ticker.unref === "function") {
    ticker.unref();
  }

  paint();

  return {
    sink(event) {
      applyEvent(state, event);
      schedule();
    },
    stop() {
      stopped = true;
      clearInterval(ticker);
      if (pending) {
        clearTimeout(pending);
        pending = undefined;
      }
      // Paint unconditionally: the last events may still be sitting behind the throttle, and
      // the final frame is the one that stays on screen.
      paint();
    },
  };
}

/**
 * A terminal dimension, or `fallback` when the stream doesn't know it. A pty can report `0`
 * (a `script(1)` session, or any shell with no size of its own), which is "unknown", not
 * "zero columns" — and `0` is not nullish, so it has to be rejected explicitly or the block
 * collapses to a single line.
 */
function reported(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 ? value : fallback;
}

/**
 * Keep a frame inside `max` rows. A block taller than the viewport would scroll, and the rewind
 * count would then point above the top of the screen and corrupt everything above it. Dropping
 * from the middle keeps the header and the `Total` line, which is where the run's state lives.
 */
function fitHeight(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  if (max <= 1) return lines.slice(-1);
  return [...lines.slice(0, max - 1), lines[lines.length - 1]!];
}
