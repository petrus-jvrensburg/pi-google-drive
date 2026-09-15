import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { driveListParams } from "../extensions/client.ts";

describe("driveListParams", () => {
  it("searches all drives by default", () => {
    const params = driveListParams({ q: "trashed = false" });
    assert.equal(params.supportsAllDrives, true);
    assert.equal(params.includeItemsFromAllDrives, true);
    assert.equal(params.corpora, "allDrives");
    assert.equal(params.q, "trashed = false");
  });

  it("scopes a Shared Drive id", () => {
    const params = driveListParams({ q: "trashed = false" }, "drive123");
    assert.equal(params.corpora, "drive");
    assert.equal(params.driveId, "drive123");
    assert.equal(params.supportsAllDrives, true);
  });
});
