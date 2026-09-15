import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFileList, isReadOnlyScopes, sanitizeErrorMessage, sheetValuesToText, sortFiles } from "../extensions/format.ts";

describe("sanitizeErrorMessage", () => {
  it("redacts tokens and client secrets", () => {
    const raw =
      "failed ya29.a0AToken-value access_token=ya29.abc refresh_token=1//0refresh GOCSPX-secretValue";
    const clean = sanitizeErrorMessage(raw);
    assert.equal(clean.includes("ya29."), false);
    assert.equal(clean.includes("1//"), false);
    assert.equal(clean.includes("GOCSPX-"), false);
    assert.match(clean, /\[redacted\]/);
  });
});

describe("isReadOnlyScopes", () => {
  it("treats drive.readonly as read-only and full drive as write", () => {
    assert.equal(isReadOnlyScopes(["https://www.googleapis.com/auth/drive.readonly"]), true);
    assert.equal(isReadOnlyScopes(["https://www.googleapis.com/auth/drive"]), false);
    assert.equal(isReadOnlyScopes(["https://www.googleapis.com/auth/spreadsheets"]), false);
  });
});

describe("sheetValuesToText", () => {
  it("renders TSV and empty sheets", () => {
    assert.equal(sheetValuesToText([]), "(no data)");
    assert.equal(sheetValuesToText([["A", "B"], [1, true]]), "A\tB\n1\ttrue");
  });
});

describe("formatFileList", () => {
  it("formats ids without secrets", () => {
    const text = formatFileList([
      { id: "file1", name: "Notes", mimeType: "application/vnd.google-apps.document", modifiedTime: "2024-01-01T00:00:00.000Z" },
    ]);
    assert.match(text, /Notes/);
    assert.match(text, /id: file1/);
  });
});

describe("sortFiles", () => {
  it("sorts by modified time and folders first", () => {
    const files = [
      { id: "2", name: "b.txt", mimeType: "text/plain", modifiedTime: "2024-01-01T00:00:00.000Z" },
      { id: "1", name: "a.txt", mimeType: "text/plain", modifiedTime: "2024-02-01T00:00:00.000Z" },
      { id: "3", name: "Zed", mimeType: "application/vnd.google-apps.folder" },
    ];
    assert.equal(sortFiles(files, "modified")[0]?.id, "1");
    assert.equal(sortFiles(files, "folderName")[0]?.id, "3");
    assert.equal(sortFiles(files, "folderName")[1]?.id, "1");
  });
});
