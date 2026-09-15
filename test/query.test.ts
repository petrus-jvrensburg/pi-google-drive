import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFolderListQuery,
  buildSearchQuery,
  escapeDriveQueryValue,
  looksLikeRawDriveQuery,
  quoteSheetName,
  resolveMimeType,
} from "../extensions/query.ts";

describe("escapeDriveQueryValue", () => {
  it("escapes backslashes and single quotes", () => {
    assert.equal(escapeDriveQueryValue("O'Brien\\path"), "O\\'Brien\\\\path");
  });
});

describe("looksLikeRawDriveQuery", () => {
  it("treats plain language as simple text", () => {
    assert.equal(looksLikeRawDriveQuery("budget 2024"), false);
    assert.equal(looksLikeRawDriveQuery("Q3 planning doc"), false);
  });

  it("detects Drive operators", () => {
    assert.equal(looksLikeRawDriveQuery("name contains 'budget'"), true);
    assert.equal(looksLikeRawDriveQuery("mimeType = 'application/pdf'"), true);
    assert.equal(looksLikeRawDriveQuery("'abc123' in parents"), true);
    assert.equal(looksLikeRawDriveQuery("trashed = false"), true);
    assert.equal(looksLikeRawDriveQuery("modifiedTime > '2024-01-01T00:00:00Z'"), true);
  });
});

describe("resolveMimeType", () => {
  it("maps aliases and passes through full types", () => {
    assert.equal(resolveMimeType("docs"), "application/vnd.google-apps.document");
    assert.equal(resolveMimeType("sheet"), "application/vnd.google-apps.spreadsheet");
    assert.equal(resolveMimeType("slides"), "application/vnd.google-apps.presentation");
    assert.equal(resolveMimeType("folder"), "application/vnd.google-apps.folder");
    assert.equal(resolveMimeType("application/pdf"), "application/pdf");
  });
});

describe("buildSearchQuery", () => {
  it("builds a name/fullText query and excludes trash", () => {
    assert.equal(
      buildSearchQuery({ query: "budget" }),
      "(name contains 'budget' or fullText contains 'budget') and trashed = false",
    );
  });

  it("uses raw q and MIME aliases", () => {
    const q = buildSearchQuery({
      q: "modifiedTime > '2024-01-01T00:00:00Z'",
      mimeType: "docs",
    });
    assert.equal(
      q,
      "modifiedTime > '2024-01-01T00:00:00Z' and mimeType = 'application/vnd.google-apps.document' and trashed = false",
    );
  });

  it("does not double-wrap an already-raw query field", () => {
    const q = buildSearchQuery({ query: "name contains 'OKR'" });
    assert.equal(q, "name contains 'OKR' and trashed = false");
  });

  it("limits to a folder", () => {
    const q = buildSearchQuery({ folderId: "abc'123", query: "notes" });
    assert.match(q, /'abc\\'123' in parents/);
  });
});

describe("buildFolderListQuery", () => {
  it("lists children of a folder", () => {
    assert.equal(buildFolderListQuery("root"), "'root' in parents and trashed = false");
  });
});

describe("quoteSheetName", () => {
  it("quotes names with spaces and doubles inner quotes", () => {
    assert.equal(quoteSheetName("Sheet1"), "Sheet1");
    assert.equal(quoteSheetName("Q1 Summary"), "'Q1 Summary'");
    assert.equal(quoteSheetName("O'Reilly"), "'O''Reilly'");
  });
});
