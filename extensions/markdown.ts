import { asJsonMap, asString, type JsonMap } from "./format.ts";

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\u000b/g, "\n");
}

function escapeMdInline(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>~])/g, "\\$1");
}

function escapeMdTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function applyInlineStyle(text: string, style: JsonMap | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return escapeMdInline(text);

  const start = text.indexOf(trimmed);
  const left = text.slice(0, start);
  const right = text.slice(start + trimmed.length);
  let core = escapeMdInline(trimmed);

  const bold = style?.bold === true;
  const italic = style?.italic === true;
  const strike = style?.strikethrough === true;
  const link = asJsonMap(style?.link);
  const url = asString(link.url);

  if (bold) core = `**${core}**`;
  if (italic) core = `*${core}*`;
  if (strike) core = `~~${core}~~`;
  if (url) core = `[${core}](${url})`;

  return `${left}${core}${right}`;
}

function paragraphTextFromElements(elements: unknown): string {
  if (!Array.isArray(elements)) return "";
  const chunks: string[] = [];
  for (const element of elements) {
    const run = asJsonMap(asJsonMap(element).textRun);
    const content = asString(run.content);
    if (!content) continue;
    chunks.push(applyInlineStyle(normalizeText(content), asJsonMap(run.textStyle)));
  }
  return chunks.join("").replace(/\n+$/g, "").trim();
}

function isOrderedGlyph(glyphType: string | undefined): boolean {
  if (!glyphType) return false;
  return ["DECIMAL", "ALPHA", "ROMAN"].some((token) => glyphType.includes(token));
}

function headingPrefix(namedStyleType: string | undefined): string {
  if (!namedStyleType) return "";
  if (namedStyleType === "TITLE") return "#";
  if (namedStyleType === "SUBTITLE") return "##";
  const match = namedStyleType.match(/^HEADING_(\d)$/);
  if (!match) return "";
  const level = Number(match[1]);
  if (!Number.isFinite(level) || level < 1 || level > 6) return "";
  return "#".repeat(level);
}

function tableToMarkdown(table: JsonMap, lists: JsonMap | undefined): string {
  const rows = table.tableRows;
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const renderedRows = rows.map((row) => {
    const cells = asJsonMap(row).tableCells;
    if (!Array.isArray(cells)) return [] as string[];
    return cells.map((cell) => {
      const content = asJsonMap(cell).content;
      if (!Array.isArray(content)) return "";
      return escapeMdTableCell(
        content
          .map((block) => blockToMarkdown(asJsonMap(block), lists))
          .join("\n")
          .replace(/\n{2,}/g, "\n")
          .trim(),
      );
    });
  });

  const colCount = Math.max(...renderedRows.map((row) => row.length), 1);
  const normalizeRow = (row: string[]) => {
    const cells = [...row];
    while (cells.length < colCount) cells.push("");
    return `| ${cells.join(" | ")} |`;
  };

  const header = normalizeRow(renderedRows[0] ?? []);
  const divider = `| ${new Array(colCount).fill("---").join(" | ")} |`;
  const body = renderedRows.slice(1).map(normalizeRow);
  return [header, divider, ...body].join("\n");
}

function blockToMarkdown(block: JsonMap, lists: JsonMap | undefined, listState?: Map<string, number>): string {
  const paragraph = asJsonMap(block.paragraph);
  if (block.paragraph) {
    const text = paragraphTextFromElements(paragraph.elements);
    const style = asJsonMap(paragraph.paragraphStyle);
    const heading = headingPrefix(asString(style.namedStyleType));
    if (heading && text) return `${heading} ${text}`;

    const bullet = asJsonMap(paragraph.bullet);
    if (paragraph.bullet) {
      const listId = asString(bullet.listId) ?? "default";
      const nestingLevel = typeof bullet.nestingLevel === "number" ? bullet.nestingLevel : 0;
      const listInfo = asJsonMap(asJsonMap(lists?.[listId]).listProperties);
      const levels = listInfo.nestingLevels;
      const glyphType =
        Array.isArray(levels) && asString(asJsonMap(levels[nestingLevel]).glyphType)
          ? asString(asJsonMap(levels[nestingLevel]).glyphType)
          : undefined;
      const ordered = isOrderedGlyph(glyphType);
      const state = listState ?? new Map<string, number>();
      const key = `${listId}:${nestingLevel}`;
      const count = (state.get(key) ?? 0) + 1;
      state.set(key, count);
      for (const existingKey of [...state.keys()]) {
        if (!existingKey.startsWith(`${listId}:`)) continue;
        const level = Number(existingKey.split(":")[1]);
        if (Number.isFinite(level) && level > nestingLevel) state.delete(existingKey);
      }
      const indent = "  ".repeat(Math.max(0, nestingLevel));
      const marker = ordered ? `${count}.` : "-";
      return `${indent}${marker} ${text}`.trimEnd();
    }

    return text;
  }

  if (block.table) return tableToMarkdown(asJsonMap(block.table), lists);
  return "";
}

export function googleDocToMarkdown(document: JsonMap): string {
  const body = asJsonMap(document.body).content;
  if (!Array.isArray(body) || body.length === 0) return "";

  const lists = asJsonMap(document.lists);
  const listState = new Map<string, number>();
  const chunks: string[] = [];

  for (const block of body) {
    const rendered = blockToMarkdown(asJsonMap(block), lists, listState).trim();
    if (!rendered) continue;
    chunks.push(rendered);
  }

  const markdown = chunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return markdown ? `${markdown}\n` : "";
}
