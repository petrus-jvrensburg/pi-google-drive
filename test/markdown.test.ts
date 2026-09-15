import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { googleDocToMarkdown } from "../extensions/markdown.ts";

const fixture = {
  title: "Planning notes",
  lists: {
    kix1: {
      listProperties: {
        nestingLevels: [{ glyphType: "DECIMAL" }],
      },
    },
    kix2: {
      listProperties: {
        nestingLevels: [{ glyphType: "GLYPH_TYPE_UNSPECIFIED" }],
      },
    },
  },
  body: {
    content: [
      {
        paragraph: {
          elements: [{ textRun: { content: "Planning notes\n" } }],
          paragraphStyle: { namedStyleType: "HEADING_1" },
        },
      },
      {
        paragraph: {
          elements: [
            { textRun: { content: "Hello " } },
            { textRun: { content: "world", textStyle: { bold: true } } },
            {
              textRun: {
                content: " link",
                textStyle: { italic: true, link: { url: "https://example.com" } },
              },
            },
          ],
        },
      },
      {
        paragraph: {
          elements: [{ textRun: { content: "First item\n" } }],
          bullet: { listId: "kix1", nestingLevel: 0 },
        },
      },
      {
        paragraph: {
          elements: [{ textRun: { content: "Second item\n" } }],
          bullet: { listId: "kix1", nestingLevel: 0 },
        },
      },
      {
        paragraph: {
          elements: [{ textRun: { content: "Bullet\n" } }],
          bullet: { listId: "kix2", nestingLevel: 0 },
        },
      },
      {
        table: {
          tableRows: [
            { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "Name" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "Status" } }] } }] }] },
            { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "Alpha" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "Done" } }] } }] }] },
          ],
        },
      },
    ],
  },
};

describe("googleDocToMarkdown", () => {
  it("converts headings, inline styles, lists, and tables", () => {
    const md = googleDocToMarkdown(fixture);
    assert.match(md, /^# Planning notes/m);
    assert.match(md, /\*\*world\*\*/);
    assert.match(md, /\[\*link\*\]\(https:\/\/example\.com\)/);
    assert.match(md, /^1\. First item/m);
    assert.match(md, /^2\. Second item/m);
    assert.match(md, /^- Bullet/m);
    assert.match(md, /\| Name \| Status \|/);
    assert.match(md, /\| Alpha \| Done \|/);
  });

  it("returns empty string for empty documents", () => {
    assert.equal(googleDocToMarkdown({ body: { content: [] } }), "");
  });
});
