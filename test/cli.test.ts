import { test, expect } from "vitest";
import { parseCliArgs } from "../src/cli-args.ts";

test("a single positional becomes the prompt", () => {
  expect(parseCliArgs(["hello"])).toEqual({ kind: "prompt", text: "hello", readOnly: false });
});

test("multi-word positionals join into one prompt", () => {
  expect(parseCliArgs(["what", "is", "this"])).toEqual({
    kind: "prompt",
    text: "what is this",
    readOnly: false,
  });
});

test("-f / --file yields a file intent", () => {
  expect(parseCliArgs(["-f", "p.txt"])).toEqual({ kind: "file", path: "p.txt", readOnly: false });
  expect(parseCliArgs(["--file", "p.txt"])).toEqual({ kind: "file", path: "p.txt", readOnly: false });
});

test("--readonly sets the flag on a positional prompt and a file prompt", () => {
  expect(parseCliArgs(["--readonly", "hello"])).toEqual({
    kind: "prompt",
    text: "hello",
    readOnly: true,
  });
  expect(parseCliArgs(["--readonly", "-f", "p.txt"])).toEqual({
    kind: "file",
    path: "p.txt",
    readOnly: true,
  });
  // Order-independent: the flag may follow the prompt source too.
  expect(parseCliArgs(["-f", "p.txt", "--readonly"])).toEqual({
    kind: "file",
    path: "p.txt",
    readOnly: true,
  });
});

test("-h / --help yields help", () => {
  expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
});

test("-f together with a positional is an error", () => {
  expect(parseCliArgs(["-f", "p.txt", "extra"]).kind).toBe("error");
});

test("no arguments is an error", () => {
  expect(parseCliArgs([]).kind).toBe("error");
});

test("an unknown flag is an error, not a throw", () => {
  expect(parseCliArgs(["--nope"]).kind).toBe("error");
});

test("-f without a value is an error, not a throw", () => {
  expect(parseCliArgs(["-f"]).kind).toBe("error");
});
