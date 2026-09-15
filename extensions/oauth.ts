import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AUTH_URL, CONFIG_DIR_NAME, CONFIG_FILE_NAME, DEFAULT_SCOPES, TOKEN_EXPIRY_SKEW_MS, TOKEN_URL } from "./constants.ts";
import { asNumber, asString, isReadOnlyScopes, parseJson, sanitizeErrorMessage, scopesFromString } from "./format.ts";

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expiry_date?: number;
};

export type AuthAccount = {
  email?: string;
  displayName?: string;
};

export type AuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  tokens: OAuthTokens;
  account?: AuthAccount;
};

export type PublicAuthStatus = {
  configured: boolean;
  configPath: string;
  email?: string;
  displayName?: string;
  scopes: string[];
  readOnly: boolean;
  hasRefreshToken: boolean;
  expiresAt?: string;
  expired?: boolean;
};

export const CONFIG_DIR = join(homedir(), ".pi", "agent", CONFIG_DIR_NAME);
export const CONFIG_PATH = join(CONFIG_DIR, CONFIG_FILE_NAME);

let refreshInFlight: Promise<AuthConfig> | null = null;

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export function buildAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scopes?: string[];
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (options.scopes ?? [...DEFAULT_SCOPES]).join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  return url.toString();
}

export function toPublicStatus(config: AuthConfig | null, configPath = CONFIG_PATH): PublicAuthStatus {
  if (!config) {
    return {
      configured: false,
      configPath,
      scopes: [],
      readOnly: true,
      hasRefreshToken: false,
    };
  }

  const scopes = scopesFromString(config.tokens.scope);
  const fallbackScopes = scopes.length > 0 ? scopes : [...DEFAULT_SCOPES];
  const expiresAt = config.tokens.expiry_date ? new Date(config.tokens.expiry_date).toISOString() : undefined;

  return {
    configured: true,
    configPath,
    email: config.account?.email,
    displayName: config.account?.displayName,
    scopes: fallbackScopes,
    readOnly: isReadOnlyScopes(fallbackScopes),
    hasRefreshToken: Boolean(config.tokens.refresh_token),
    expiresAt,
    expired: config.tokens.expiry_date ? Date.now() >= config.tokens.expiry_date : undefined,
  };
}

export function formatPublicStatus(status: PublicAuthStatus): string {
  if (!status.configured) {
    return `Google Drive is not connected. Run /gdrive-setup.\nconfig: ${status.configPath}`;
  }

  const lines = [
    "Google Drive connection",
    `- account: ${status.email ?? status.displayName ?? "(unknown)"}`,
    `- read-only: ${status.readOnly ? "yes" : "no"}`,
    `- refresh token: ${status.hasRefreshToken ? "yes" : "no"}`,
    `- expires: ${status.expiresAt ?? "unknown"}`,
    `- expired: ${status.expired === undefined ? "unknown" : status.expired ? "yes" : "no"}`,
    `- scopes: ${status.scopes.join(" ") || "(none stored)"}`,
    `- config: ${status.configPath}`,
  ];
  return lines.join("\n");
}

export async function readConfig(): Promise<AuthConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as AuthConfig;
    if (!parsed?.clientId || !parsed?.tokens?.access_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveConfig(config: AuthConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  try {
    await chmod(CONFIG_DIR, 0o700);
  } catch {
    // Best-effort directory mode.
  }
  const json = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(CONFIG_PATH, json, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // Best-effort file mode.
  }
}

export async function deleteConfig(): Promise<void> {
  await rm(CONFIG_PATH, { force: true });
}

export function isExpired(tokens: OAuthTokens, now = Date.now()): boolean {
  if (!tokens.expiry_date) return false;
  return now >= tokens.expiry_date - TOKEN_EXPIRY_SKEW_MS;
}

async function tokenRequest(body: URLSearchParams, signal?: AbortSignal): Promise<OAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal,
  });
  const text = await res.text();
  const data = parseJson(text);
  if (!res.ok || !asString(data.access_token)) {
    throw new Error(
      sanitizeErrorMessage(asString(data.error_description) ?? asString(data.error) ?? "OAuth token request failed"),
    );
  }

  const expiresIn = asNumber(data.expires_in) ?? 3600;
  return {
    access_token: asString(data.access_token) as string,
    refresh_token: asString(data.refresh_token),
    token_type: asString(data.token_type) ?? "Bearer",
    scope: asString(data.scope),
    expiry_date: Date.now() + expiresIn * 1000,
  };
}

export async function exchangeCodeForTokens(params: {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  verifier: string;
  signal?: AbortSignal;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
  });
  if (params.clientSecret) body.set("client_secret", params.clientSecret);
  const tokens = await tokenRequest(body, params.signal);
  tokens.scope = tokens.scope ?? DEFAULT_SCOPES.join(" ");
  return tokens;
}

export async function refreshConfig(config: AuthConfig, signal?: AbortSignal): Promise<AuthConfig> {
  if (!config.tokens.refresh_token) {
    throw new Error("No refresh token. Run /gdrive-setup again.");
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const body = new URLSearchParams({
      client_id: config.clientId,
      refresh_token: config.tokens.refresh_token as string,
      grant_type: "refresh_token",
    });
    if (config.clientSecret) body.set("client_secret", config.clientSecret);
    const tokens = await tokenRequest(body, signal);
    const next: AuthConfig = {
      ...config,
      tokens: {
        ...config.tokens,
        ...tokens,
        refresh_token: tokens.refresh_token ?? config.tokens.refresh_token,
        scope: tokens.scope ?? config.tokens.scope,
      },
    };
    await saveConfig(next);
    return next;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function getValidConfig(signal?: AbortSignal): Promise<AuthConfig> {
  const config = await readConfig();
  if (!config) {
    throw new Error(`Google Drive is not connected. Run /gdrive-setup. (${CONFIG_PATH})`);
  }
  if (isExpired(config.tokens)) return refreshConfig(config, signal);
  return config;
}

export type OAuthListener = {
  redirectUri: string;
  waitForCode: () => Promise<string>;
  close: () => void;
};

export function startOAuthListener(options: {
  expectedState: string;
  timeoutMs: number;
  redirectUri?: string;
}): Promise<OAuthListener> {
  const requested = options.redirectUri ? new URL(options.redirectUri) : undefined;
  if (requested && !["http:", "https:"].includes(requested.protocol)) {
    return Promise.reject(new Error("Redirect URI must use http or https."));
  }

  const host = requested?.hostname || "127.0.0.1";
  const port = requested?.port ? Number(requested.port) : 0;
  const expectedPath = requested?.pathname || "/oauth2callback";

  return new Promise((resolveListener, rejectListener) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveCode: ((code: string) => void) | undefined;
    let rejectCode: ((error: Error) => void) | undefined;

    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const close = () => {
      if (timer) clearTimeout(timer);
      server.close();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      close();
      rejectCode?.(error);
    };

    const server: Server = createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", `http://${req.headers.host ?? `${host}:${port}`}`);
        if (reqUrl.pathname !== expectedPath) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }

        const error = reqUrl.searchParams.get("error");
        if (error) {
          res.statusCode = 400;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end("<h2>Google authorization failed.</h2><p>You can close this tab and return to Pi.</p>");
          fail(new Error(`OAuth error: ${error}`));
          return;
        }

        const state = reqUrl.searchParams.get("state");
        const code = reqUrl.searchParams.get("code");
        if (state !== options.expectedState || !code) {
          res.statusCode = 400;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end("<h2>Invalid OAuth callback.</h2><p>You can close this tab and return to Pi.</p>");
          fail(new Error("Failed to validate OAuth state or authorization code."));
          return;
        }

        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end("<h2>Google Drive connected.</h2><p>You can close this tab and return to Pi.</p>");

        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          server.close();
          resolveCode?.(code);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    server.on("error", (error) => {
      rejectListener(error);
      fail(error instanceof Error ? error : new Error(String(error)));
    });

    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListener(new Error("Failed to bind OAuth loopback server."));
        close();
        return;
      }

      const boundPort = address.port;
      const useBoundRedirect = !requested || !requested.port || requested.port === "0";
      const redirectUri = useBoundRedirect
        ? `http://${host}:${boundPort}${expectedPath}`
        : requested.toString();

      timer = setTimeout(() => {
        fail(new Error("OAuth authorization timed out."));
      }, options.timeoutMs);

      resolveListener({
        redirectUri,
        waitForCode: () => codePromise,
        close,
      });
    });
  });
}
