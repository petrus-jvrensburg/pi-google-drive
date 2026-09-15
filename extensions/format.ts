import { FOLDER_MIME, WRITE_SCOPE_RE } from "./constants.ts";

export type JsonMap = Record<string, unknown>;

export type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
  driveId?: string;
  description?: string;
  md5Checksum?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
};

export function asJsonMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonMap) : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function parseJson(text: string): JsonMap {
  try {
    return asJsonMap(JSON.parse(text));
  } catch {
    return {};
  }
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/1\/\/[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/GOCSPX-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/refresh_token=[^&\s]+/gi, "refresh_token=[redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]");
}

export function scopesFromString(scope?: string): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).filter(Boolean);
}

export function isReadOnlyScopes(scopes: string[]): boolean {
  if (scopes.length === 0) return true;
  if (scopes.some((scope) => WRITE_SCOPE_RE.test(scope))) return false;
  return true;
}

export function formatFile(file: DriveFile, index?: number): string {
  const prefix = index === undefined ? "" : `${index}. `;
  const name = file.name || "(untitled)";
  const lines = [`${prefix}${name}`];
  if (file.id) lines.push(`   id: ${file.id}`);
  if (file.mimeType) lines.push(`   mime: ${file.mimeType}`);
  if (file.modifiedTime) lines.push(`   modified: ${file.modifiedTime}`);
  if (file.size) lines.push(`   size: ${file.size}`);
  if (file.driveId) lines.push(`   driveId: ${file.driveId}`);
  if (file.webViewLink) lines.push(`   url: ${file.webViewLink}`);
  const targetId = file.shortcutDetails?.targetId;
  if (targetId) {
    lines.push(`   shortcutTarget: ${targetId}`);
    if (file.shortcutDetails?.targetMimeType) {
      lines.push(`   shortcutMime: ${file.shortcutDetails.targetMimeType}`);
    }
  }
  return lines.join("\n");
}

export function formatFileList(files: DriveFile[]): string {
  if (files.length === 0) return "No files found.";
  return files.map((file, i) => formatFile(file, i + 1)).join("\n");
}

export function sortFiles(files: DriveFile[], mode: "modified" | "folderName"): DriveFile[] {
  const copy = [...files];
  if (mode === "modified") {
    copy.sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
    return copy;
  }
  copy.sort((a, b) => {
    const aFolder = a.mimeType === FOLDER_MIME ? 0 : 1;
    const bFolder = b.mimeType === FOLDER_MIME ? 0 : 1;
    if (aFolder !== bFolder) return aFolder - bFolder;
    return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
  });
  return copy;
}

export function stringifyCell(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "string") return cell.replace(/\t/g, " ").replace(/\n/g, " ");
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  return JSON.stringify(cell);
}

export function sheetValuesToText(values: unknown[][]): string {
  if (!Array.isArray(values) || values.length === 0) return "(no data)";
  return values
    .map((row) => (Array.isArray(row) ? row.map((cell) => stringifyCell(cell)).join("\t") : ""))
    .join("\n");
}

export function clampPageSize(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export function googleErrorMessage(data: JsonMap, status: number): string {
  const error = asJsonMap(data.error);
  const message = asString(error.message) ?? asString(data.error_description);
  return sanitizeErrorMessage(message ?? `Google API error (${status})`);
}
