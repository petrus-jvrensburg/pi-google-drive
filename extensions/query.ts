import { FOLDER_MIME, MIME_ALIASES } from "./constants.ts";

const RAW_FIELD_RE =
  /(?:^|\s)(?:name|fullText|mimeType|trashed|modifiedTime|createdTime|starred|parents|owners|writers|readers|sharedWithMe|visibility|properties|appProperties|shortcutDetails)\s*(?:contains|=|!=|<|>|in\b)/i;

const RAW_PARENTS_RE = /'\s+in\s+parents/i;
const RAW_LOGIC_RE = /\b(?:and|or)\b.+(?:contains|=|in parents)/i;

export type SearchQueryInput = {
  query?: string;
  q?: string;
  mimeType?: string;
  folderId?: string;
  driveId?: string;
  name?: string;
  trashed?: boolean;
};

export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function looksLikeRawDriveQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  return RAW_FIELD_RE.test(q) || RAW_PARENTS_RE.test(q) || RAW_LOGIC_RE.test(q);
}

export function resolveMimeType(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return MIME_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function quoteSheetName(name: string): string {
  if (/^[A-Za-z0-9_]+$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

export function buildSearchQuery(input: SearchQueryInput): string {
  const parts: string[] = [];

  const raw = input.q?.trim();
  if (raw) parts.push(wrapClause(raw));

  const query = input.query?.trim();
  if (query) {
    if (looksLikeRawDriveQuery(query)) {
      parts.push(wrapClause(query));
    } else {
      const escaped = escapeDriveQueryValue(query);
      parts.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
    }
  }

  const name = input.name?.trim();
  if (name) {
    parts.push(`name contains '${escapeDriveQueryValue(name)}'`);
  }

  const mimeType = resolveMimeType(input.mimeType);
  if (mimeType) {
    parts.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
  }

  const folderId = input.folderId?.trim();
  if (folderId) {
    parts.push(`'${escapeDriveQueryValue(folderId)}' in parents`);
  }

  if (input.trashed === true) {
    parts.push("trashed = true");
  } else if (input.trashed !== undefined || !hasTrashedClause(parts)) {
    parts.push("trashed = false");
  }

  return parts.join(" and ");
}

export function buildFolderListQuery(folderId: string, trashed = false): string {
  const id = folderId.trim() || "root";
  const trashedClause = trashed ? "trashed = true" : "trashed = false";
  return `'${escapeDriveQueryValue(id)}' in parents and ${trashedClause}`;
}

export function folderMime(): string {
  return FOLDER_MIME;
}

function wrapClause(clause: string): string {
  const trimmed = clause.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) return trimmed;
  if (!/\b(?:and|or)\b/i.test(trimmed)) return trimmed;
  return `(${trimmed})`;
}

function hasTrashedClause(parts: string[]): boolean {
  return parts.some((part) => /\btrashed\s*=/.test(part));
}
