import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME } from "./constants.ts";

/** Project config lives under this directory, matching Pi's project `.pi` convention. */
export const PROJECT_PI_DIR = ".pi";
export const PROJECT_CONFIG_RELATIVE = join(PROJECT_PI_DIR, CONFIG_DIR_NAME, CONFIG_FILE_NAME);

let activeCwd: string | undefined;

export function setActiveCwd(cwd: string | undefined): void {
  if (!cwd) return;
  activeCwd = resolve(cwd);
}

export function getActiveCwd(): string {
  return activeCwd ?? process.cwd();
}

export function projectConfigPath(projectDir: string): string {
  return join(resolve(projectDir), PROJECT_CONFIG_RELATIVE);
}

/** `<project>/.pi/google-drive/oauth.json` -> `<project>`. */
export function projectRootFromConfigPath(configPath: string): string {
  return dirname(dirname(dirname(resolve(configPath))));
}

/** Previous single-account location. Not used for discovery. */
export function legacyConfigPath(): string {
  return join(homedir(), ".pi", "agent", CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

export function walkParents(startDir: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(startDir);
  while (true) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Nearest `.pi/google-drive/oauth.json` at or above `startDir`.
 *
 * Does not stop at git roots: a workspace `.pi` should cover nested repos.
 * A closer file overrides a parent. `~/.pi/agent/google-drive/oauth.json` is not a match.
 */
export async function findProjectConfigPath(startDir: string): Promise<string | null> {
  for (const dir of walkParents(startDir)) {
    const candidate = projectConfigPath(dir);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

export async function findNearestPiDir(startDir: string): Promise<string | null> {
  for (const dir of walkParents(startDir)) {
    if (await isDirectory(join(dir, PROJECT_PI_DIR))) return dir;
  }
  return null;
}

/**
 * Where `/gdrive-setup` should write when the user does not choose an override.
 * An existing login is updated in place. Otherwise the nearest `.pi` directory is used,
 * so a workspace `.pi` receives the login instead of a nested repo that has none.
 */
export async function resolveSetupPath(startDir: string): Promise<{ existingPath: string | null; writePath: string }> {
  const start = resolve(startDir);
  const existingPath = await findProjectConfigPath(start);
  if (existingPath) return { existingPath, writePath: existingPath };
  const anchor = await findNearestPiDir(start);
  return { existingPath: null, writePath: projectConfigPath(anchor ?? start) };
}
