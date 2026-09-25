import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { OAUTH_TIMEOUT_MS } from "./constants.ts";
import { driveAboutUser } from "./client.ts";
import {
  findProjectConfigPath,
  legacyConfigPath,
  projectConfigPath,
  projectRootFromConfigPath,
  resolveSetupPath,
  setActiveCwd,
} from "./config-path.ts";
import {
  buildAuthUrl,
  createOAuthState,
  createPkcePair,
  deleteConfig,
  exchangeCodeForTokens,
  formatPublicStatus,
  getValidConfig,
  publicStatusFor,
  readConfigFile,
  saveConfig,
  startOAuthListener,
  statusLabel,
  toPublicStatus,
  type AuthConfig,
} from "./oauth.ts";

const OVERWRITE_LOGIN = "Overwrite the login found above this directory";
const SEPARATE_LOGIN = "Save a separate login for this directory";

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

async function maybeCopyLegacy(ctx: ExtensionCommandContext, writePath: string): Promise<"done" | "continue"> {
  const legacy = legacyConfigPath();
  const legacyConfig = await readConfigFile(legacy);
  if (!legacyConfig) return "continue";

  const copy = await ctx.ui.confirm(
    "Existing Google Drive login",
    `A login exists at the old global path and is not used by projects:\n${legacy}\n\nCopy it to:\n${writePath}?`,
  );
  if (!copy) return "continue";

  await saveConfig(legacyConfig, writePath);
  try {
    let config = await getValidConfig(undefined, ctx.cwd);
    const account = await driveAboutUser();
    if (account.email || account.displayName) {
      config = { ...config, account: { ...config.account, ...account } };
      await saveConfig(config, writePath);
    }
    const status = toPublicStatus(config, writePath);
    ctx.ui.notify(status.email ? `Google Drive connected as ${status.email}` : "Google Drive login copied.", "info");
    ctx.ui.setStatus("gdrive", statusLabel(status));
    return "done";
  } catch (error) {
    ctx.ui.notify(
      `Copied login could not be refreshed: ${(error as Error).message}. Continuing with a new sign-in.`,
      "warning",
    );
    return "continue";
  }
}

async function runSetup(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/gdrive-setup requires interactive mode.", "error");
    return;
  }

  setActiveCwd(ctx.cwd);
  const separatePath = projectConfigPath(ctx.cwd);
  const discovered = await resolveSetupPath(ctx.cwd);
  let writePath = discovered.writePath;

  if (discovered.existingPath && resolve(discovered.existingPath) !== resolve(separatePath)) {
    ctx.ui.notify(
      `Found a Google Drive login above this directory:\n${discovered.existingPath}\n\nA separate login for this directory would be saved to:\n${separatePath}`,
      "info",
    );
    const choice = await ctx.ui.select("Where should this Google Drive login be saved?", [
      OVERWRITE_LOGIN,
      SEPARATE_LOGIN,
    ]);
    if (!choice) return;
    writePath = choice === SEPARATE_LOGIN ? separatePath : discovered.existingPath;
  } else if (discovered.existingPath) {
    const overwrite = await ctx.ui.confirm(
      "Existing Google Drive login",
      `A local token file already exists. Overwrite it?\n${discovered.existingPath}`,
    );
    if (!overwrite) return;
    writePath = discovered.existingPath;
  } else {
    ctx.ui.notify(
      `No Google Drive login found at or above ${ctx.cwd}.\nA new login will be saved to:\n${writePath}`,
      "info",
    );
    if ((await maybeCopyLegacy(ctx, writePath)) === "done") return;
  }

  const preserved = await readConfigFile(writePath);

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
        refresh_token: tokens.refresh_token ?? preserved?.tokens.refresh_token,
      },
    };
    await saveConfig(config, writePath);

    try {
      const account = await driveAboutUser();
      config.account = account;
      await saveConfig(config, writePath);
    } catch {
      // Account lookup is best-effort; tokens are already stored.
    }

    const status = toPublicStatus(config, writePath);
    ctx.ui.notify(
      status.email ? `Google Drive connected as ${status.email}` : "Google Drive connected.",
      "info",
    );
    ctx.ui.setStatus("gdrive", statusLabel(status));
  } catch (error) {
    ctx.ui.notify(`Google Drive setup failed: ${(error as Error).message}`, "error");
  }
}

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("gdrive-setup", {
    description: "Connect this project's Google Drive with a personal OAuth client (read-only)",
    handler: async (_args, ctx) => {
      await runSetup(pi, ctx);
    },
  });

  pi.registerCommand("gdrive-logout", {
    description: "Delete the Google Drive login discovered for this directory",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/gdrive-logout requires interactive mode.", "error");
        return;
      }
      setActiveCwd(ctx.cwd);
      const existingPath = await findProjectConfigPath(ctx.cwd);
      if (!existingPath) {
        ctx.ui.notify(`No Google Drive login found at or above ${ctx.cwd}.`, "info");
        ctx.ui.setStatus("gdrive", "Drive: run /gdrive-setup");
        return;
      }
      const projectRoot = projectRootFromConfigPath(existingPath);
      const inherited = resolve(projectRoot) !== resolve(ctx.cwd);
      const message = inherited
        ? `This directory is using a login stored above it:\n${existingPath}\n\nDeleting it also disconnects other directories that inherit that file.`
        : `Delete local tokens?\n${existingPath}`;
      const ok = await ctx.ui.confirm("Disconnect Google Drive", message);
      if (!ok) return;
      try {
        await deleteConfig(existingPath);
        ctx.ui.notify("Local Google Drive tokens deleted. Revoke app access in your Google Account if you want.", "info");
        ctx.ui.setStatus("gdrive", "Drive: run /gdrive-setup");
      } catch (error) {
        ctx.ui.notify(`Logout failed: ${(error as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("gdrive-status", {
    description: "Show the Google Drive login discovered for this directory (no secrets)",
    handler: async (_args, ctx) => {
      setActiveCwd(ctx.cwd);
      const status = await publicStatusFor(ctx.cwd);
      ctx.ui.notify(formatPublicStatus(status), "info");
    },
  });
}
