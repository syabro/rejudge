import { expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatReviewAnswerOutput } from "../src/terminal-markdown.ts";

const MARKDOWN = `# Review result

This is **important** and *useful* with \`inline code\`.

- first item
  - nested item

| Name | Result | Detail |
| --- | --- | --- |
| formatter | passed | a long table value that must wrap |

\`\`\`ts
const answer = "rendered";
\`\`\`
`;

function visibleLines(output: string): string[] {
  expect(output.endsWith("\n")).toBe(true);
  return output.split("\n").slice(0, -1);
}

test("TTY output renders Markdown structure and styling", () => {
  const output = formatReviewAnswerOutput(MARKDOWN, { isTTY: true, columns: 80 }, {});

  expect(output).toContain("\x1b[");
  expect(output).toContain("Review result");
  expect(output).toContain("nested item");
  expect(output).toContain("formatter");
  expect(output).toContain("│");
  expect(output).toContain('const answer = "rendered";');
  expect(output).not.toContain("# Review result");
  expect(output).not.toContain("**important**");
  expect(output).toContain("```ts");
});

test("NO_COLOR keeps rendered structure without ANSI styling", () => {
  const output = formatReviewAnswerOutput(MARKDOWN, { isTTY: true, columns: 40 }, { NO_COLOR: "" });

  expect(output).not.toMatch(/\x1b\[[0-9;]*m/);
  expect(output).toContain("Review result");
  expect(output).toContain("nested item");
  expect(output).toContain("formatter");
  expect(output).toContain('const answer = "rendered";');
  expect(output).toContain("```ts");
  expect(output).not.toContain("# Review result");
  expect(output).not.toContain("**important**");
});

test("TTY output fits narrow and ordinary terminal widths", () => {
  for (const columns of [40, 10, 1]) {
    const output = formatReviewAnswerOutput(MARKDOWN, { isTTY: true, columns }, { NO_COLOR: "" });

    for (const line of visibleLines(output)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(1, columns - 1));
    }
  }
});

test("missing or zero terminal width falls back to 80 columns", () => {
  const expected = formatReviewAnswerOutput(MARKDOWN, { isTTY: true, columns: 80 }, { NO_COLOR: "" });

  for (const stream of [{ isTTY: true }, { isTTY: true, columns: 0 }]) {
    const output = formatReviewAnswerOutput(MARKDOWN, stream, { NO_COLOR: "" });
    expect(output).toBe(expected);

    for (const line of visibleLines(output)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(79);
    }
  }
});

test("non-TTY output preserves the existing raw stdout bytes", () => {
  const inputs = ["", "   ", "# Heading\n**bold**", "Unicode 🙂\n", "\x1b[31mred\x1b[0m\n"];

  for (const markdown of inputs) {
    expect(formatReviewAnswerOutput(markdown, {}, {})).toBe(`${markdown}\n`);
    expect(formatReviewAnswerOutput(markdown, { isTTY: false, columns: 20 }, { NO_COLOR: "" })).toBe(
      `${markdown}\n`,
    );
  }
});
