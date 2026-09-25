import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  findProjectConfigPath,
  projectConfigPath,
  projectRootFromConfigPath,
  resolveSetupPath,
} from "../extensions/config-path.ts";
import { DEFAULT_SCOPES } from "../extensions/constants.ts";
import { formatPublicStatus, publicStatusFor, saveConfig, type AuthConfig } from "../extensions/oauth.ts";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "gdrive-config-"));
}

async function touch(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "token\n");
}

const secretConfig: AuthConfig = {
  clientId: "123.apps.googleusercontent.com",
  clientSecret: "GOCSPX-not-a-real-secret",
  redirectUri: "http://127.0.0.1:9/oauth2callback",
  tokens: {
    access_token: "ya29.not-a-real-token",
    refresh_token: "1//not-a-real-refresh",
    scope: DEFAULT_SCOPES.join(" "),
    expiry_date: Date.now() + 3600_000,
  },
  account: { email: "project@example.com" },
};

describe("findProjectConfigPath", () => {
  it("ignores an agent-style token and uses the nearest project file", async () => {
    const root = await tempRoot();
    const repo = join(root, "repo");
    const nested = join(repo, "src");
    await mkdir(nested, { recursive: true });
    await mkdir(join(repo, ".git"));
    await touch(join(root, ".pi", "agent", "google-drive", "oauth.json"));

    assert.equal(await findProjectConfigPath(nested), null);

    const workspaceLogin = projectConfigPath(root);
    await touch(workspaceLogin);
    assert.equal(await findProjectConfigPath(nested), workspaceLogin);

    const repoLogin = projectConfigPath(repo);
    await touch(repoLogin);
    assert.equal(await findProjectConfigPath(nested), repoLogin);
    assert.equal(projectRootFromConfigPath(repoLogin), repo);
  });
});

describe("resolveSetupPath", () => {
  it("writes into the nearest .pi directory when no login exists", async () => {
    const root = await tempRoot();
    const nested = join(root, "repo", "src");
    await mkdir(join(root, ".pi"));
    await mkdir(nested, { recursive: true });

    const resolved = await resolveSetupPath(nested);
    assert.equal(resolved.existingPath, null);
    assert.equal(resolved.writePath, projectConfigPath(root));
  });

  it("writes into the start directory when no .pi exists above it", async () => {
    const root = await tempRoot();
    const nested = join(root, "repo");
    await mkdir(nested, { recursive: true });

    const resolved = await resolveSetupPath(nested);
    assert.equal(resolved.writePath, projectConfigPath(nested));
  });

  it("updates an existing ancestor login in place", async () => {
    const root = await tempRoot();
    const nested = join(root, "repo");
    await mkdir(nested, { recursive: true });
    const login = projectConfigPath(root);
    await touch(login);

    const resolved = await resolveSetupPath(nested);
    assert.equal(resolved.existingPath, login);
    assert.equal(resolved.writePath, login);
  });
});

describe("saveConfig", () => {
  it("stores a mode 0600 token and a local gitignore", async () => {
    const root = await tempRoot();
    const path = projectConfigPath(root);
    await saveConfig(secretConfig, path);

    const file = await stat(path);
    assert.equal(file.mode & 0o777, 0o600);
    const dir = await stat(join(root, ".pi", "google-drive"));
    assert.equal(dir.mode & 0o777, 0o700);
    assert.equal(await readFile(join(root, ".pi", "google-drive", ".gitignore"), "utf8"), "*\n!.gitignore\n");

    const status = await publicStatusFor(join(root, "nested"));
    const json = JSON.stringify(status);
    assert.equal(status.configured, true);
    assert.equal(status.email, "project@example.com");
    assert.equal(status.configPath, path);
    assert.equal(status.inherited, true);
    assert.equal(status.projectRoot, root);
    assert.match(formatPublicStatus(status), /inherited: yes/);
    assert.equal(json.includes("ya29."), false);
    assert.equal(json.includes("GOCSPX-"), false);
    assert.equal(json.includes("1//"), false);
  });
});
