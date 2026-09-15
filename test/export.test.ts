import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canExportAsText, describeReadPlan, getExportMime, isGoogleNative, isTextMime } from "../extensions/export.ts";

describe("export MIME map", () => {
  it("maps Docs, Sheets, and Slides to text exports", () => {
    assert.equal(getExportMime("application/vnd.google-apps.document"), "text/markdown");
    assert.equal(getExportMime("application/vnd.google-apps.spreadsheet"), "text/csv");
    assert.equal(getExportMime("application/vnd.google-apps.presentation"), "text/plain");
    assert.equal(canExportAsText("application/vnd.google-apps.document"), true);
  });

  it("does not export folders or forms", () => {
    assert.equal(getExportMime("application/vnd.google-apps.folder"), undefined);
    assert.equal(getExportMime("application/vnd.google-apps.form"), undefined);
    assert.equal(describeReadPlan("application/vnd.google-apps.folder"), "list-folder");
  });

  it("treats ordinary binaries as download-not-export", () => {
    assert.equal(isGoogleNative("application/pdf"), false);
    assert.equal(getExportMime("application/pdf"), undefined);
    assert.equal(describeReadPlan("application/pdf", "deck.pdf"), "binary");
  });
});

describe("isTextMime", () => {
  it("accepts text, json, and common source extensions", () => {
    assert.equal(isTextMime("text/plain"), true);
    assert.equal(isTextMime("application/json"), true);
    assert.equal(isTextMime("application/octet-stream", "notes.md"), true);
    assert.equal(isTextMime("application/pdf"), false);
    assert.equal(isTextMime("image/png"), false);
  });
});
