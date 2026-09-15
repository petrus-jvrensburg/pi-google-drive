import { MAX_TOOL_BYTES, MAX_TOOL_LINES } from "./constants.ts";

export type TruncationResult = {
  text: string;
  truncated: boolean;
  totalBytes: number;
  totalLines: number;
  outputBytes: number;
  outputLines: number;
};

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncateOutput(
  text: string,
  options?: { maxBytes?: number; maxLines?: number },
): TruncationResult {
  const maxBytes = options?.maxBytes ?? MAX_TOOL_BYTES;
  const maxLines = options?.maxLines ?? MAX_TOOL_LINES;
  const totalBytes = byteLength(text);
  const lines = text.split("\n");
  const totalLines = text.length === 0 ? 0 : lines.length;

  let outputLines = Math.min(totalLines, maxLines);
  let sliced = lines.slice(0, outputLines).join("\n");

  while (outputLines > 0 && byteLength(sliced) > maxBytes) {
    outputLines -= 1;
    sliced = lines.slice(0, outputLines).join("\n");
  }

  if (outputLines === 0 && totalBytes > 0) {
    let cut = text;
    while (cut.length > 0 && byteLength(cut) > maxBytes) {
      cut = cut.slice(0, Math.max(0, Math.floor(cut.length * 0.9) - 1));
    }
    sliced = cut;
  }

  const truncated = sliced.length < text.length;
  const outputBytes = byteLength(sliced);
  const shownLines = sliced.length === 0 ? 0 : sliced.split("\n").length;

  return {
    text: sliced,
    truncated,
    totalBytes,
    totalLines,
    outputBytes,
    outputLines: shownLines,
  };
}

export function withTruncationNotice(
  text: string,
  options?: { maxBytes?: number; maxLines?: number; hint?: string },
): TruncationResult & { text: string } {
  const result = truncateOutput(text, options);
  if (!result.truncated) return result;

  const hint =
    options?.hint ??
    "Narrow the query, folder, MIME type, sheet range, or request a specific tab.";
  const notice = [
    "",
    `[Output truncated: showing ${result.outputLines} of ${result.totalLines} lines (${formatBytes(result.outputBytes)} of ${formatBytes(result.totalBytes)}). ${hint}]`,
  ].join("\n");

  return {
    ...result,
    text: `${result.text}${notice}`,
  };
}
