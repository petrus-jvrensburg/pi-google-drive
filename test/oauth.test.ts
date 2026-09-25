import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SCOPES } from "../extensions/constants.ts";
import { buildAuthUrl, createOAuthState, createPkcePair, formatPublicStatus, startOAuthListener, toPublicStatus, type AuthConfig } from "../extensions/oauth.ts";

const secretConfig: AuthConfig = {
  clientId: "123.apps.googleusercontent.com",
  clientSecret: "GOCSPX-not-a-real-secret",
  redirectUri: "http://127.0.0.1:1234/oauth2callback",
  tokens: {
    access_token: "ya29.not-a-real-token",
    refresh_token: "1//not-a-real-refresh",
    scope: DEFAULT_SCOPES.join(" "),
    expiry_date: Date.now() + 3600_000,
  },
  account: { email: "user@example.com", displayName: "Example User" },
};

describe("toPublicStatus", () => {
  it("omits tokens and client secrets", () => {
    const status = toPublicStatus(secretConfig, "/tmp/oauth.json");
    const json = JSON.stringify(status);
    assert.equal(status.configured, true);
    assert.equal(status.email, "user@example.com");
    assert.equal(status.readOnly, true);
    assert.equal(status.hasRefreshToken, true);
    assert.equal(json.includes("ya29."), false);
    assert.equal(json.includes("1//"), false);
    assert.equal(json.includes("GOCSPX-"), false);
    assert.equal(json.includes("access_token"), false);
    assert.equal(json.includes("refresh_token"), false);
    assert.equal(json.includes("clientSecret"), false);
  });

  it("describes a disconnected state", () => {
    const status = toPublicStatus(null, "/tmp/oauth.json");
    assert.equal(status.configured, false);
    assert.match(formatPublicStatus(status), /not connected/);
    assert.match(formatPublicStatus(status), /gdrive-setup/);
  });
});

describe("buildAuthUrl", () => {
  it("requests offline read-only access with PKCE", () => {
    const url = new URL(
      buildAuthUrl({
        clientId: "123.apps.googleusercontent.com",
        redirectUri: "http://127.0.0.1:9/oauth2callback",
        state: "abc",
        challenge: "challenge",
      }),
    );
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), "challenge");
    const scope = url.searchParams.get("scope") ?? "";
    assert.match(scope, /drive\.readonly/);
    assert.match(scope, /spreadsheets\.readonly/);
    assert.equal(scope.includes("/auth/drive "), false);
  });
});

describe("createPkcePair", () => {
  it("returns a verifier and S256 challenge", () => {
    const pair = createPkcePair();
    assert.equal(pair.verifier.length > 20, true);
    assert.equal(pair.challenge.length > 20, true);
    assert.notEqual(pair.verifier, pair.challenge);
  });
});

describe("startOAuthListener", () => {
  it("rewrites port 0 to the bound loopback URI and returns the code", async () => {
    const state = createOAuthState();
    const listener = await startOAuthListener({
      expectedState: state,
      timeoutMs: 5_000,
      redirectUri: "http://127.0.0.1:0/oauth2callback",
    });
    try {
      assert.match(listener.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
      assert.equal(listener.redirectUri.includes(":0/"), false);
      const pending = listener.waitForCode();
      const res = await fetch(`${listener.redirectUri}?state=${state}&code=test-code-1`);
      const html = await res.text();
      assert.equal(res.ok, true);
      assert.match(html, /Google Drive connected/);
      assert.match(html, /You can close this tab and return to Pi\./);
      assert.match(html, /align-items:\s*center/);
      assert.match(html, /justify-content:\s*center/);
      assert.match(html, /text-align:\s*center/);
      assert.match(html, /ui-sans-serif/);
      assert.equal(await pending, "test-code-1");
    } finally {
      listener.close();
    }
  });
});
