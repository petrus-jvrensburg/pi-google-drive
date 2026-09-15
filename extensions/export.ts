import {
  DOCUMENT_MIME,
  FOLDER_MIME,
  PRESENTATION_MIME,
  SHORTCUT_MIME,
  SPREADSHEET_MIME,
  TEXT_MIME_EXACT,
  TEXT_NAME_RE,
} from "./constants.ts";

const GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps.";

const EXPORT_MIME: Record<string, string> = {
  [DOCUMENT_MIME]: "text/markdown",
  [SPREADSHEET_MIME]: "text/csv",
  [PRESENTATION_MIME]: "text/plain",
  "application/vnd.google-apps.script": "application/vnd.google-apps.script+json",
  "application/vnd.google-apps.site": "text/plain",
  "application/vnd.google-apps.jam": "application/pdf",
};

const UNREADABLE_GOOGLE = new Set([
  FOLDER_MIME,
  SHORTCUT_MIME,
  "application/vnd.google-apps.form",
  "application/vnd.google-apps.map",
  "application/vnd.google-apps.drive-sdk",
]);

export function isGoogleNative(mimeType: string): boolean {
  return mimeType.startsWith(GOOGLE_NATIVE_PREFIX);
}

export function isFolderMime(mimeType: string): boolean {
  return mimeType === FOLDER_MIME;
}

export function isShortcutMime(mimeType: string): boolean {
  return mimeType === SHORTCUT_MIME;
}

export function getExportMime(mimeType: string): string | undefined {
  if (!isGoogleNative(mimeType)) return undefined;
  if (UNREADABLE_GOOGLE.has(mimeType)) return undefined;
  return EXPORT_MIME[mimeType] ?? "text/plain";
}

export function canExportAsText(mimeType: string): boolean {
  const exportMime = getExportMime(mimeType);
  return Boolean(exportMime && isTextMime(exportMime));
}

export function isTextMime(mimeType: string, name?: string): boolean {
  const mime = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!mime) return false;
  if (mime.startsWith("text/")) return true;
  if (mime.endsWith("+json") || mime.endsWith("+xml")) return true;
  if (TEXT_MIME_EXACT.has(mime)) return true;
  if (name && TEXT_NAME_RE.test(name)) return true;
  return false;
}

export function describeReadPlan(mimeType: string, name?: string): string {
  if (isFolderMime(mimeType)) return "list-folder";
  if (isShortcutMime(mimeType)) return "follow-shortcut";
  const exportMime = getExportMime(mimeType);
  if (exportMime) return `export:${exportMime}`;
  if (isTextMime(mimeType, name)) return "download-text";
  return "binary";
}
