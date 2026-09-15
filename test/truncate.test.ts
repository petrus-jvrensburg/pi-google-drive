import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_TOOL_BYTES, MAX_TOOL_LINES } from "../extensions/constants.ts";
import { truncateOutput, withTruncationNotice } from "../extensions/truncate.ts";

describe("truncateOutput", () => {
  it("keeps short text unchanged", () => {
    const result = truncateOutput("hello\nworld");
    assert.equal(result.truncated, false);
    assert.equal(result.text, "hello\nworld");
  });

  it("truncates by line count", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n");
    const result = truncateOutput(text, { maxLines: 10, maxBytes: 10_000 });
    assert.equal(result.truncated, true);
    assert.equal(result.outputLines, 10);
    assert.equal(result.text.split("\n").length, 10);
    assert.equal(result.text.startsWith("line-0"), true);
    assert.equal(result.text.includes("line-49"), false);
  });

  it("truncates by byte size", () => {
    const text = "a".repeat(5000);
    const result = truncateOutput(text, { maxBytes: 100, maxLines: 100 });
    assert.equal(result.truncated, true);
    assert.equal(Buffer.byteLength(result.text, "utf8") <= 100, true);
  });

  it("matches Pi-scale defaults for huge dumps", () => {
    const text = Array.from({ length: MAX_TOOL_LINES + 20 }, (_, i) => `row-${i}`).join("\n");
    const result = truncateOutput(text);
    assert.equal(result.truncated, true);
    assert.equal(result.outputLines <= MAX_TOOL_LINES, true);
    assert.equal(result.outputBytes <= MAX_TOOL_BYTES, true);
  });
});

describe("withTruncationNotice", () => {
  it("appends a narrow-the-query note", () => {
    const result = withTruncationNotice("one\ntwo\nthree", { maxLines: 1, maxBytes: 1000 });
    assert.match(result.text, /Output truncated/);
    assert.match(result.text, /Narrow the query/);
  });
});
