import { test, expect } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createTtyProgress, cliTheme, shouldDrawLiveBlock, type ProgressStream } from "../src/tty-progress.ts";
import { reviewMode } from "../src/review-mode.ts";

/** A fake terminal: records every write, with a settable size. */
function fakeStream(columns = 80, rows = 24): ProgressStream & { writes: string[]; columns: number; rows: number } {
  const writes: string[] = [];
  return {
    writes,
    columns,
    rows,
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  };
}

/** Strip ANSI escape sequences, leaving the visible text. */
function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * How many rows of the block a frame actually drew. A frame may also emit blank erase-only
 * rows to wipe a taller predecessor; those are not part of the block, so they don't count.
 */
function rowsIn(frame: string): number {
  return frame
    .split("\n")
    .slice(0, -1)
    .filter((row) => plain(row).replace("\r", "").trim() !== "").length;
}

/** A renderer over a fake terminal with a frozen, hand-advanced clock. */
function harness(options: { columns?: number; rows?: number; noColor?: boolean } = {}) {
  const stream = fakeStream(options.columns, options.rows);
  let clock = 1_000_000;

  const progress = createTtyProgress({
    reviewerModels: ["prov/panel-a", "prov/panel-b"],
    judgeModel: "prov/judge",
    title: "a title",
    mode: reviewMode(),
    stream,
    theme: cliTheme(options.noColor ? { NO_COLOR: "" } : {}),
    now: () => clock,
  });

  return {
    stream,
    progress,
    advance(ms: number) {
      clock += ms;
    },
  };
}

// The detection rule the whole feature hangs on: stderr only, `true` only. Node leaves `isTTY`
// undefined rather than false off a terminal, and an agent's shell exports TERM with no terminal
// at all — so a looser test would spray escape codes into its log.
test("the live block is drawn only when the given stream reports isTTY === true", () => {
  expect(shouldDrawLiveBlock({ isTTY: true })).toBe(true);

  for (const stream of [{ isTTY: undefined }, {}, { isTTY: false }]) {
    expect(shouldDrawLiveBlock(stream)).toBe(false);
  }
});

test("the first frame draws the whole tree and never moves the cursor up", () => {
  const { stream, progress } = harness();

  expect(stream.writes).toHaveLength(1);
  const first = stream.writes[0]!;
  expect(first).not.toMatch(/\x1b\[\d+A/);

  const text = plain(first);
  expect(text).toContain("Rejudge");
  expect(text).toContain("Mode: fresh — new panel");
  expect(text).toContain("a title");
  expect(text).toContain("judge");
  expect(text).toContain("panel-a");
  expect(text).toContain("panel-b");
  expect(text).toContain("Total");

  progress.stop();
});

test("a repaint rewinds by exactly the previous frame's line count and clears each row", () => {
  const { stream, progress, advance } = harness();
  const firstRows = rowsIn(stream.writes[0]!);

  advance(5000);
  progress.stop(); // stop() always paints a final frame

  const second = stream.writes[1]!;
  expect(second.startsWith(`\x1b[${firstRows}A`)).toBe(true);
  // Every rewritten row is cleared first, so a shorter line can't leave stale tail text.
  expect(second.split("\x1b[2K").length - 1).toBeGreaterThanOrEqual(firstRows);
  // The clock advanced, so the frame is genuinely redrawn rather than repeated.
  expect(plain(second)).toContain("Total 05s");
});

test("a frame that shrinks erases the leftover rows and parks the cursor below the block", () => {
  const { stream, progress } = harness();
  const before = rowsIn(stream.writes[0]!);

  // A diagnostic adds a row, so the next frame is taller; removing it again is not possible
  // through the event API, so shrink by clamping the viewport instead.
  progress.sink({ kind: "diagnostic", t: 1_000_000, severity: "warn", message: "heads up" });
  progress.stop();

  const grown = stream.writes[stream.writes.length - 1]!;
  expect(rowsIn(grown)).toBe(before + 1);
  expect(plain(grown)).toContain("heads up");

  // Now shrink the terminal so the next frame has fewer rows than the last one.
  stream.rows = 4;
  progress.stop();

  const shrunk = stream.writes[stream.writes.length - 1]!;
  const drawn = rowsIn(shrunk);
  expect(drawn).toBeLessThan(before + 1);
  // The leftovers are blanked and the cursor is pulled back to just under the block.
  expect(shrunk).toContain(`\x1b[${before + 1 - drawn}A`);
});

test("a short viewport keeps the block inside it and never loses the Total line", () => {
  const { stream, progress } = harness({ rows: 5 });

  const frame = stream.writes[0]!;
  expect(rowsIn(frame)).toBeLessThanOrEqual(4); // rows - 1
  expect(plain(frame).trimEnd().split("\n").pop()).toContain("Total");

  progress.stop();
});

// A pty can report a size of 0 (a `script(1)` session, or a shell with no size of its own).
// That is "unknown", not "zero" — and 0 is not nullish, so a `??` fallback would miss it and
// squeeze the whole block down to one line.
test("a terminal reporting size 0 falls back to the default size and still draws the tree", () => {
  for (const size of [0, undefined]) {
    const stream = fakeStream(80, 24);
    stream.columns = size as number;
    stream.rows = size as number;

    const progress = createTtyProgress({
      reviewerModels: ["prov/panel-a", "prov/panel-b"],
      judgeModel: "prov/judge",
      title: "a title",
      mode: reviewMode(),
      stream,
      theme: cliTheme({ NO_COLOR: "" }),
    });
    progress.stop();

    const text = plain(stream.writes[0]!);
    expect(text).toContain("Rejudge");
    expect(text).toContain("panel-a");
    expect(text).toContain("panel-b");
    expect(text).toContain("Total");
    expect(rowsIn(stream.writes[0]!)).toBeGreaterThan(1);
  }
});

// The last column must stay free at every size down to the narrowest supported one: a line
// filling the terminal exactly triggers deferred autowrap, which silently costs a physical row
// and desynchronizes the rewind count from then on.
test("every drawn line stays inside the terminal width, leaving the last column free", () => {
  for (const columns of [80, 40, 24]) {
    const { stream, progress } = harness({ columns });
    progress.sink({
      kind: "model_start",
      t: 1_000_000,
      roleKey: "panel-1",
      model: "prov/panel-a",
      role: "reviewer",
    });
    progress.sink({
      kind: "activity",
      t: 1_000_000,
      roleKey: "panel-1",
      model: "prov/panel-a",
      activity: "read",
      detail: "a/very/long/path/that/will/not/fit/in/a/narrow/terminal.ts",
      phase: "start",
    });
    progress.stop();

    for (const frame of stream.writes) {
      for (const line of plain(frame).split("\n")) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(columns - 1);
      }
    }
  }
});

test("NO_COLOR is honored by presence, even when set to an empty string", () => {
  const colored = cliTheme({});
  expect(colored.fg("success", "done")).toContain("\x1b[");
  expect(colored.bold("Rejudge")).toContain("\x1b[");

  for (const env of [{ NO_COLOR: "" }, { NO_COLOR: "0" }, { NO_COLOR: "1" }]) {
    const bare = cliTheme(env);
    expect(bare.fg("success", "done")).toBe("done");
    expect(bare.bold("Rejudge")).toBe("Rejudge");
  }
});

test("with NO_COLOR the drawn content carries no styling, only cursor control", () => {
  const { stream, progress } = harness({ noColor: true });
  progress.stop();

  for (const frame of stream.writes) {
    // Cursor movement/erase stays (it is not color); SGR styling must be gone.
    expect(frame).not.toMatch(/\x1b\[[0-9;]*m/);
  }
});

test("stop() paints a final frame even when a throttled repaint is still pending", () => {
  const { stream, progress, advance } = harness();
  const beforeStop = stream.writes.length;

  // Two events in the same instant: the first paints, the second is throttled into a timer.
  progress.sink({ kind: "model_start", t: 1_000_000, roleKey: "judge", model: "prov/judge", role: "judge" });
  progress.sink({ kind: "model_start", t: 1_000_000, roleKey: "panel-1", model: "prov/panel-a", role: "reviewer" });

  advance(9000);
  progress.stop();

  expect(stream.writes.length).toBeGreaterThan(beforeStop);
  expect(plain(stream.writes[stream.writes.length - 1]!)).toContain("Total 09s");
});
