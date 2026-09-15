import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { OAUTH_TIMEOUT_MS } from "./constants.ts";
import { driveAboutUser } from "./client.ts";
import {
  buildAuthUrl,
  CONFIG_PATH,
  createOAuthState,
  createPkcePair,
  deleteConfig,
  exchangeCodeForTokens,
  formatPublicStatus,
  readConfig,
  saveConfig,
  startOAuthListener,
  toPublicStatus,
  type AuthConfig,
} from "./oauth.ts";

async function openBrowser(pi: ExtensionAPI, url: string): Promise<void> {
  const platform = process.platform;
  if (platform === "darwin") {
    await pi.exec("open", [url]);
    return;
  }
  if (platform === "win32") {
    await pi.exec("cmd", ["/c", "start", "", url]);
    return;
  }
  await pi.exec("xdg-open", [url]);
}

async function runSetup(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/gdrive-setup requires interactive mode.", "error");
    return;
  }

  const existing = await readConfig();
  if (existing) {
    const overwrite = await ctx.ui.confirm(
      "Existing Google Drive login",
      `A local token file already exists. Overwrite it?\n${CONFIG_PATH}`,
    );
    if (!overwrite) return;
  }

  const clientId = (await ctx.ui.input("Google OAuth Client ID", "...apps.googleusercontent.com"))?.trim();
  if (!clientId) return;

  const clientSecretRaw = await ctx.ui.input(
    "Google OAuth Client Secret (optional)",
    "Desktop clients from Google Cloud include one",
  );
  const clientSecret = clientSecretRaw?.trim() || undefined;

  const redirectInput = await ctx.ui.input(
    "Redirect URI (blank = loopback http://127.0.0.1:<port>/oauth2callback)",
    "http://127.0.0.1:0/oauth2callback",
  );
  const requestedRedirect = redirectInput?.trim() || undefined;

  const state = createOAuthState();
  const pkce = createPkcePair();

  let listener: Awaited<ReturnType<typeof startOAuthListener>> | undefined;
  try {
    listener = await startOAuthListener({
      expectedState: state,
      timeoutMs: OAUTH_TIMEOUT_MS,
      redirectUri: requestedRedirect,
    });
  } catch (error) {
    ctx.ui.notify(`Could not start OAuth listener: ${(error as Error).message}`, "error");
    return;
  }

  const authUrl = buildAuthUrl({
    clientId,
    redirectUri: listener.redirectUri,
    state,
    challenge: pkce.challenge,
  });

  ctx.ui.notify("Opening a browser for Google authorization...", "info");
  try {
    await openBrowser(pi, authUrl);
  } catch {
    ctx.ui.notify("Could not open a browser. Open this URL manually:", "warning");
    ctx.ui.notify(authUrl, "info");
  }

  let code = "";
  try {
    code = await listener.waitForCode();
  } catch (error) {
    listener.close();
    ctx.ui.notify(`Automatic callback failed: ${(error as Error).message}`, "warning");
    const manual = await ctx.ui.input("Paste the authorization code", "4/0A...");
    if (!manual) return;
    code = manual.trim();
  }

  try {
    const tokens = await exchangeCodeForTokens({
      clientId,
      clientSecret,
      redirectUri: listener.redirectUri,
      code,
      verifier: pkce.verifier,
    });

    const config: AuthConfig = {
      clientId,
      clientSecret,
      redirectUri: listener.redirectUri,
      tokens: {
        ...tokens,
        refresh_token: tokens.refresh_token ?? existing?.tokens.refresh_token,
      },
    };
    await saveConfig(config);

    try {
      const account = await driveAboutUser();
      config.account = account;
      await saveConfig(config);
    } catch {
      // Account lookup is best-effort; tokens are already stored.
    }

    const status = toPublicStatus(config);
    ctx.ui.notify(
      status.email ? `Google Drive connected as ${status.email}` : "Google Drive connected.",
      "info",
    );
    ctx.ui.setStatus("gdrive", status.email ? `Drive: ${status.email}` : "Drive: connected");
  } catch (error) {
    ctx.ui.notify(`Google Drive setup failed: ${(error as Error).message}`, "error");
  }
}

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("gdrive-setup", {
    description: "Connect Google Drive with a personal OAuth client (read-only)",
    handler: async (_args, ctx) => {
      await runSetup(pi, ctx);
    },
  });

  pi.registerCommand("gdrive-logout", {
    description: "Delete local Google Drive tokens",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/gdrive-logout requires interactive mode.", "error");
        return;
      }
      const ok = await ctx.ui.confirm("Disconnect Google Drive", `Delete local tokens?\n${CONFIG_PATH}`);
      if (!ok) return;
      try {
        await deleteConfig();
        ctx.ui.notify("Local Google Drive tokens deleted. Revoke app access in your Google Account if you want.", "info");
        ctx.ui.setStatus("gdrive", "Drive: run /gdrive-setup");
      } catch (error) {
        ctx.ui.notify(`Logout failed: ${(error as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("gdrive-status", {
    description: "Show Google Drive auth status (no secrets)",
    handler: async (_args, ctx) => {
      const status = toPublicStatus(await readConfig());
      ctx.ui.notify(formatPublicStatus(status), "info");
    },
  });
}
