import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AUTH_URL, DEFAULT_SCOPES, TOKEN_EXPIRY_SKEW_MS, TOKEN_URL } from "./constants.ts";
import {
  findProjectConfigPath,
  getActiveCwd,
  isFile,
  legacyConfigPath,
  PROJECT_CONFIG_RELATIVE,
  projectRootFromConfigPath,
  resolveSetupPath,
} from "./config-path.ts";
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
  searchedFrom?: string;
  legacyPath?: string;
  projectRoot?: string;
  inherited?: boolean;
};

const refreshInFlight = new Map<string, Promise<AuthConfig>>();

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

export function toPublicStatus(config: AuthConfig | null, configPath: string): PublicAuthStatus {
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
    if (!status.searchedFrom) {
      return `Google Drive is not connected. Run /gdrive-setup.\nconfig: ${status.configPath}`;
    }
    const lines = [
      `Google Drive is not connected for ${status.searchedFrom}.`,
      `Searched upward for ${PROJECT_CONFIG_RELATIVE}.`,
      "Run /gdrive-setup.",
    ];
    if (status.configPath) lines.push(`- would save to: ${status.configPath}`);
    if (status.legacyPath) lines.push(`- ignored legacy token: ${status.legacyPath}`);
    return lines.join("\n");
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
  if (status.projectRoot) lines.push(`- applies from: ${status.projectRoot}`);
  if (status.inherited) lines.push("- inherited: yes");
  return lines.join("\n");
}

export function statusLabel(status: PublicAuthStatus): string {
  if (status.configured && status.email) return `Drive: ${status.email}`;
  if (status.configured) return "Drive: connected";
  return "Drive: run /gdrive-setup";
}

export async function publicStatusFor(cwd: string): Promise<PublicAuthStatus> {
  const path = await findProjectConfigPath(cwd);
  if (!path) {
    const setup = await resolveSetupPath(cwd);
    return {
      configured: false,
      configPath: setup.writePath,
      scopes: [],
      readOnly: true,
      hasRefreshToken: false,
      searchedFrom: resolve(cwd),
      legacyPath: (await isFile(legacyConfigPath())) ? legacyConfigPath() : undefined,
    };
  }

  const config = await readConfigFile(path);
  if (!config) {
    return {
      configured: false,
      configPath: path,
      scopes: [],
      readOnly: true,
      hasRefreshToken: false,
      searchedFrom: resolve(cwd),
      legacyPath: (await isFile(legacyConfigPath())) ? legacyConfigPath() : undefined,
    };
  }

  const projectRoot = projectRootFromConfigPath(path);
  return {
    ...toPublicStatus(config, path),
    projectRoot,
    inherited: resolve(projectRoot) !== resolve(cwd),
  };
}

export async function readConfigFile(configPath: string): Promise<AuthConfig | null> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as AuthConfig;
    if (!parsed?.clientId || !parsed?.tokens?.access_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveConfig(config: AuthConfig, configPath: string): Promise<void> {
  const dir = dirname(configPath);
  await mkdir(dir, { recursive: true });
  try {
    await chmod(dir, 0o700);
  } catch {
    // Best-effort directory mode.
  }
  try {
    await writeFile(join(dir, ".gitignore"), "*\n!.gitignore\n", { encoding: "utf8", mode: 0o644, flag: "wx" });
  } catch {
    // Already present, or not writable beyond the token file.
  }
  const json = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(configPath, json, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(configPath, 0o600);
  } catch {
    // Best-effort file mode.
  }
}

export async function deleteConfig(configPath: string): Promise<void> {
  await rm(configPath, { force: true });
}

async function notConnectedMessage(cwd: string): Promise<string> {
  const lines = [
    `Google Drive is not connected for ${resolve(cwd)}.`,
    `No ${PROJECT_CONFIG_RELATIVE} was found at or above this directory.`,
    "Run /gdrive-setup.",
  ];
  if (await isFile(legacyConfigPath())) {
    lines.push(`A legacy token at ${legacyConfigPath()} is not used.`);
  }
  return lines.join(" ");
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

export async function refreshConfig(config: AuthConfig, configPath: string, signal?: AbortSignal): Promise<AuthConfig> {
  if (!config.tokens.refresh_token) {
    throw new Error("No refresh token. Run /gdrive-setup again.");
  }
  const inFlight = refreshInFlight.get(configPath);
  if (inFlight) return inFlight;

  const pending = (async () => {
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
    await saveConfig(next, configPath);
    return next;
  })().finally(() => {
    refreshInFlight.delete(configPath);
  });

  refreshInFlight.set(configPath, pending);
  return pending;
}

export async function getAuthorizedConfig(
  signal?: AbortSignal,
  cwd = getActiveCwd(),
): Promise<{ config: AuthConfig; path: string }> {
  const path = await findProjectConfigPath(cwd);
  if (!path) throw new Error(await notConnectedMessage(cwd));
  const config = await readConfigFile(path);
  if (!config) {
    throw new Error(`Google Drive config at ${path} is invalid. Run /gdrive-setup to replace it.`);
  }
  if (isExpired(config.tokens)) return { config: await refreshConfig(config, path, signal), path };
  return { config, path };
}

export async function getValidConfig(signal?: AbortSignal, cwd = getActiveCwd()): Promise<AuthConfig> {
  return (await getAuthorizedConfig(signal, cwd)).config;
}

export type OAuthListener = {
  redirectUri: string;
  waitForCode: () => Promise<string>;
  close: () => void;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Local callback page. No remote assets; centered in the viewport with the system font. */
function oauthResultHtml(options: { title: string; message: string; tone: "success" | "error" }): string {
  const title = escapeHtml(options.title);
  const message = escapeHtml(options.message);
  const mark = options.tone === "success" ? "✓" : "!";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f4f1;
      --card: #ffffff;
      --text: #1c1917;
      --muted: #57534e;
      --accent: #1f7a4d;
      --accent-bg: #e7f6ee;
      --line: #e7e5e4;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #141413;
        --card: #1f1f1d;
        --text: #f5f5f4;
        --muted: #a8a29e;
        --accent: #86efac;
        --accent-bg: #163528;
        --line: #333330;
      }
    }
    html, body { height: 100%; }
    body {
      margin: 0;
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    main {
      width: min(100%, 26rem);
      text-align: center;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 40px 32px;
    }
    .mark {
      width: 2.5rem;
      height: 2.5rem;
      margin: 0 auto 18px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: var(--accent-bg);
      color: var(--accent);
      font-size: 1.25rem;
      font-weight: 600;
    }
    main.error {
      --accent: #b42318;
      --accent-bg: #fde8e8;
    }
    @media (prefers-color-scheme: dark) {
      main.error {
        --accent: #fca5a5;
        --accent-bg: #3f1d1d;
      }
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    p {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 1rem;
    }
  </style>
</head>
<body>
  <main class="${options.tone}">
    <div class="mark" aria-hidden="true">${mark}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </main>
</body>
</html>
`;
}

function sendOAuthResult(
  res: ServerResponse,
  status: number,
  page: { title: string; message: string; tone: "success" | "error" },
): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(oauthResultHtml(page));
}

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
          sendOAuthResult(res, 400, {
            title: "Google authorization failed",
            message: "You can close this tab and return to Pi.",
            tone: "error",
          });
          fail(new Error(`OAuth error: ${error}`));
          return;
        }

        const state = reqUrl.searchParams.get("state");
        const code = reqUrl.searchParams.get("code");
        if (state !== options.expectedState || !code) {
          sendOAuthResult(res, 400, {
            title: "Invalid OAuth callback",
            message: "You can close this tab and return to Pi.",
            tone: "error",
          });
          fail(new Error("Failed to validate OAuth state or authorization code."));
          return;
        }

        sendOAuthResult(res, 200, {
          title: "Google Drive connected",
          message: "You can close this tab and return to Pi.",
          tone: "success",
        });

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
