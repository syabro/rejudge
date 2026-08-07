import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

const DEFAULT_COLUMNS = 80;

interface AnswerStream {
  isTTY?: boolean;
  columns?: number;
}

export function formatReviewAnswerOutput(
  answer: string,
  stream: AnswerStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (stream.isTTY !== true) return `${answer}\n`;

  const columns = stream.columns !== undefined && stream.columns > 0 ? stream.columns : DEFAULT_COLUMNS;
  // Leave the final terminal column unused so a padded rendered line cannot trigger deferred autowrap.
  const width = Math.max(1, columns - 1);
  const markdown = new Markdown(answer, 0, 0, markdownTheme(env));

  return `${markdown.render(width).map((line) => line.trimEnd()).join("\n")}\n`;
}

function markdownTheme(env: NodeJS.ProcessEnv): MarkdownTheme {
  const plain = "NO_COLOR" in env;
  const style = (open: string, close: string, text: string): string =>
    plain ? text : `\x1b[${open}m${text}\x1b[${close}m`;
  const dim = (text: string): string => style("2", "22", text);
  const cyan = (text: string): string => style("36", "39", text);

  return {
    heading: (text) => style("1;36", "22;39", text),
    link: (text) => style("4;34", "24;39", text),
    linkUrl: dim,
    code: (text) => style("33", "39", text),
    codeBlock: cyan,
    codeBlockBorder: dim,
    quote: (text) => text,
    quoteBorder: dim,
    hr: dim,
    listBullet: cyan,
    bold: (text) => style("1", "22", text),
    italic: (text) => style("3", "23", text),
    strikethrough: (text) => style("9", "29", text),
    underline: (text) => style("4", "24", text),
  };
}
