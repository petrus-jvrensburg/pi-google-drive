import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SHEET_ROWS,
  DOCUMENT_MIME,
  FILE_GET_FIELDS,
  MAX_DOWNLOAD_BYTES,
  MAX_PAGE_SIZE,
  MAX_SHEET_ROWS,
  MAX_TOOL_BYTES,
  MAX_TOOL_LINES,
} from "./constants.ts";
import { driveAboutUser, GDriveError, googleJson, googleText, listDriveFiles } from "./client.ts";
import { canExportAsText, describeReadPlan, getExportMime, isFolderMime, isShortcutMime, isTextMime } from "./export.ts";
import {
  asJsonMap,
  asString,
  clampPageSize,
  formatFile,
  formatFileList,
  sanitizeErrorMessage,
  sheetValuesToText,
  sortFiles,
  type DriveFile,
  type JsonMap,
} from "./format.ts";
import { googleDocToMarkdown } from "./markdown.ts";
import {
  CONFIG_PATH,
  formatPublicStatus,
  getValidConfig,
  readConfig,
  saveConfig,
  toPublicStatus,
} from "./oauth.ts";
import { buildFolderListQuery, buildSearchQuery, quoteSheetName } from "./query.ts";
import { formatBytes, withTruncationNotice } from "./truncate.ts";

function toolText(text: string, details: JsonMap = {}, isError = false) {
  const truncated = withTruncationNotice(text);
  return {
    content: [{ type: "text" as const, text: truncated.text }],
    details: { ...details, truncated: truncated.truncated },
    isError,
  };
}

function toolError(error: unknown) {
  const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
  return toolText(message, { error: message }, true);
}

function asDriveFiles(data: JsonMap): DriveFile[] {
  const files = data.files;
  if (!Array.isArray(files)) return [];
  return files as DriveFile[];
}

async function getFileMetadata(fileId: string, signal?: AbortSignal): Promise<DriveFile> {
  const data = await googleJson(`/files/${encodeURIComponent(fileId)}`, {
    query: {
      fields: FILE_GET_FIELDS,
      supportsAllDrives: true,
    },
    signal,
  });
  return data as DriveFile;
}

async function readGoogleDoc(file: DriveFile, signal?: AbortSignal): Promise<string> {
  const fileId = file.id as string;
  try {
    const exported = await googleText(`/files/${encodeURIComponent(fileId)}/export`, {
      query: { mimeType: "text/markdown" },
      signal,
      maxBytes: MAX_DOWNLOAD_BYTES,
    });
    if (exported.text.trim()) return exported.text;
  } catch {
    // Fall through to Docs JSON → markdown.
  }

  try {
    const document = await googleJson(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`, {
      signal,
    });
    const markdown = googleDocToMarkdown(document);
    if (markdown.trim()) return markdown;
  } catch {
    // Fall through to plain text export.
  }

  const plain = await googleText(`/files/${encodeURIComponent(fileId)}/export`, {
    query: { mimeType: "text/plain" },
    signal,
    maxBytes: MAX_DOWNLOAD_BYTES,
  });
  return plain.text;
}

async function readFileContent(file: DriveFile, signal?: AbortSignal, depth = 0): Promise<{ title: string; body: string; plan: string }> {
  const mimeType = file.mimeType ?? "application/octet-stream";
  const name = file.name ?? file.id ?? "file";

  if (isShortcutMime(mimeType)) {
    const targetId = file.shortcutDetails?.targetId;
    if (!targetId) throw new GDriveError("Shortcut is missing a target id.");
    if (depth > 3) throw new GDriveError("Shortcut chain is too deep.");
    const target = await getFileMetadata(targetId, signal);
    return readFileContent(target, signal, depth + 1);
  }

  if (isFolderMime(mimeType)) {
    throw new GDriveError(`This is a folder. Use gdrive_list with folderId=${file.id}.`);
  }

  if (mimeType === DOCUMENT_MIME) {
    return { title: name, body: await readGoogleDoc(file, signal), plan: "export:text/markdown" };
  }

  const exportMime = getExportMime(mimeType);
  if (exportMime) {
    if (!canExportAsText(mimeType) && exportMime !== "text/csv" && exportMime !== "text/plain" && exportMime !== "text/markdown") {
      throw new GDriveError(`Google file type ${mimeType} cannot be inlined as text. Use gdrive_get for metadata.`);
    }
    const exported = await googleText(`/files/${encodeURIComponent(file.id as string)}/export`, {
      query: { mimeType: exportMime },
      signal,
      maxBytes: MAX_DOWNLOAD_BYTES,
    });
    return { title: name, body: exported.text, plan: `export:${exportMime}` };
  }

  if (!isTextMime(mimeType, name)) {
    const size = file.size ? formatBytes(Number(file.size)) : "unknown size";
    throw new GDriveError(
      `Binary file (${mimeType}, ${size}) is not inlined. Use gdrive_get for metadata.`,
    );
  }

  const size = file.size ? Number(file.size) : undefined;
  if (size && size > MAX_DOWNLOAD_BYTES) {
    throw new GDriveError(
      `File is ${formatBytes(size)}, which exceeds the ${formatBytes(MAX_DOWNLOAD_BYTES)} download limit.`,
    );
  }

  const downloaded = await googleText(`/files/${encodeURIComponent(file.id as string)}`, {
    query: { alt: "media", supportsAllDrives: true },
    signal,
    maxBytes: MAX_DOWNLOAD_BYTES,
  });
  return { title: name, body: downloaded.text, plan: "download-text" };
}

async function listSheetTabs(spreadsheetId: string, signal?: AbortSignal) {
  const data = await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`, {
    query: { fields: "properties.title,sheets(properties(sheetId,title,index,gridProperties))" },
    signal,
  });
  const title = asString(asJsonMap(data.properties).title) ?? spreadsheetId;
  const sheets = Array.isArray(data.sheets) ? data.sheets : [];
  const tabs = sheets.map((sheet) => {
    const properties = asJsonMap(asJsonMap(sheet).properties);
    const grid = asJsonMap(properties.gridProperties);
    return {
      title: asString(properties.title) ?? "Sheet1",
      sheetId: properties.sheetId,
      index: properties.index,
      rowCount: grid.rowCount,
      columnCount: grid.columnCount,
    };
  });
  return { title, tabs };
}

export function registerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "gdrive_status",
    label: "Google Drive Status",
    description: "Show Google Drive OAuth status (account, scopes, read-only). Never returns secrets.",
    promptSnippet: "Check Google Drive auth status without exposing tokens",
    promptGuidelines: ["Use gdrive_status to check whether Google Drive OAuth is configured. If it is not, tell the user to run /gdrive-setup."],
    parameters: Type.Object({}),
    async execute() {
      try {
        const config = await readConfig();
        if (!config) {
          return toolText(`Google Drive is not connected. Run /gdrive-setup.\nconfig: ${CONFIG_PATH}`, {
            configured: false,
            configPath: CONFIG_PATH,
          });
        }

        try {
          await getValidConfig();
          const account = await driveAboutUser();
          if (account.email || account.displayName) {
            config.account = { ...config.account, ...account };
            await saveConfig(config);
          }
        } catch (error) {
          const status = toPublicStatus(config);
          return toolText(
            `${formatPublicStatus(status)}\n\nToken check failed: ${sanitizeErrorMessage((error as Error).message)}\nRun /gdrive-setup if this persists.`,
            { ...status, tokenOk: false },
            true,
          );
        }

        const status = toPublicStatus(config);
        return toolText(formatPublicStatus(status), { ...status, tokenOk: true });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "gdrive_search",
    label: "Google Drive Search",
    description: `Search Google Drive, including Shared Drives the signed-in user can access. Use query for simple text, or q for raw Drive operators (name contains, mimeType, modifiedTime). Results are truncated to ${MAX_TOOL_LINES} lines or ${formatBytes(MAX_TOOL_BYTES)}.`,
    promptSnippet: "Search My Drive and Shared Drives by name, text, MIME type, or folder",
    promptGuidelines: [
      "Use gdrive_search before guessing Google Drive file IDs.",
      "Do not offer to create, update, or delete Drive files; gdrive tools are read-only.",
      "Prefer a narrower gdrive_search, folder, MIME type, or sheet range instead of dumping large files.",
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Simple search text (name and fullText). Raw Drive q= syntax is also accepted." })),
      q: Type.Optional(Type.String({ description: "Raw Drive files.list q operators, combined with other filters using AND" })),
      mimeType: Type.Optional(Type.String({ description: "MIME type or alias: doc, sheet, slides, folder, pdf" })),
      folderId: Type.Optional(Type.String({ description: "Limit to files in this folder id" })),
      driveId: Type.Optional(Type.String({ description: "Limit to this Shared Drive id" })),
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE, description: `Results per page (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE})` })),
      pageToken: Type.Optional(Type.String({ description: "Pagination token from a previous search" })),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const q = buildSearchQuery({
          query: params.query,
          q: params.q,
          mimeType: params.mimeType,
          folderId: params.folderId,
        });
        const pageSize = clampPageSize(params.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const data = await listDriveFiles({
          q,
          pageSize,
          pageToken: params.pageToken,
          driveId: params.driveId,
          signal,
        });
        const files = sortFiles(asDriveFiles(data), "modified");
        const nextPageToken = asString(data.nextPageToken);
        const lines = [
          `Query: ${q}`,
          `Found ${files.length} file(s)${nextPageToken ? " (more available)" : ""}`,
          "",
          formatFileList(files),
        ];
        if (nextPageToken) lines.push("", `nextPageToken: ${nextPageToken}`);
        return toolText(lines.join("\n"), { q, count: files.length, files, nextPageToken: nextPageToken ?? null });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "gdrive_list",
    label: "Google Drive List Folder",
    description: "List files in a Drive folder. Use folderId=root for My Drive, or a Shared Drive id as folderId for that drive's root.",
    promptSnippet: "List a Drive folder, including Shared Drive folders",
    promptGuidelines: ["Use gdrive_list to list a folder after you have a folder id or Shared Drive id."],
    parameters: Type.Object({
      folderId: Type.Optional(Type.String({ description: "Folder id (default: root)" })),
      driveId: Type.Optional(Type.String({ description: "Shared Drive id when listing that drive" })),
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      pageToken: Type.Optional(Type.String({ description: "Pagination token" })),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const folderId = params.folderId?.trim() || params.driveId?.trim() || "root";
        const q = buildFolderListQuery(folderId);
        const pageSize = clampPageSize(params.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const data = await listDriveFiles({
          q,
          pageSize,
          pageToken: params.pageToken,
          driveId: params.driveId,
          signal,
        });
        const files = sortFiles(asDriveFiles(data), "folderName");
        const nextPageToken = asString(data.nextPageToken);
        const lines = [
          `Folder: ${folderId}`,
          `Found ${files.length} item(s)${nextPageToken ? " (more available)" : ""}`,
          "",
          formatFileList(files),
        ];
        if (nextPageToken) lines.push("", `nextPageToken: ${nextPageToken}`);
        return toolText(lines.join("\n"), { folderId, count: files.length, files, nextPageToken: nextPageToken ?? null });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "gdrive_list_shared_drives",
    label: "Google Drive List Shared Drives",
    description: "List Shared Drives (Team Drives) the signed-in user can access.",
    promptSnippet: "List Shared Drives visible to the signed-in Google account",
    promptGuidelines: ["Use gdrive_list_shared_drives when the user asks about Shared Drives or Team Drives."],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Optional name contains filter" })),
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE })),
      pageToken: Type.Optional(Type.String({ description: "Pagination token" })),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const pageSize = clampPageSize(params.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const data = await googleJson("/drives", {
          query: {
            pageSize,
            pageToken: params.pageToken,
            q: params.query?.trim() ? `name contains '${params.query.trim().replace(/'/g, "\\'")}'` : undefined,
            fields: "nextPageToken,drives(id,name,createdTime)",
          },
          signal,
        });
        const drives = Array.isArray(data.drives) ? (data.drives as JsonMap[]) : [];
        const nextPageToken = asString(data.nextPageToken);
        const body =
          drives.length === 0
            ? "No Shared Drives found."
            : drives
                .map((drive, i) => {
                  const name = asString(drive.name) ?? "(unnamed)";
                  const id = asString(drive.id) ?? "";
                  const created = asString(drive.createdTime);
                  return `${i + 1}. ${name}\n   id: ${id}${created ? `\n   created: ${created}` : ""}`;
                })
                .join("\n");
        const lines = [`Found ${drives.length} Shared Drive(s)`, "", body];
        if (nextPageToken) lines.push("", `nextPageToken: ${nextPageToken}`);
        return toolText(lines.join("\n"), { count: drives.length, drives, nextPageToken: nextPageToken ?? null });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "gdrive_get",
    label: "Google Drive Get Metadata",
    description: "Get metadata for a Drive file id (name, MIME type, size, links, Shared Drive id). Does not return file content.",
    promptSnippet: "Get Drive file metadata by id without reading content",
    promptGuidelines: ["Use gdrive_get for metadata only; use gdrive_read for content."],
    parameters: Type.Object({
      fileId: Type.String({ description: "Drive file id" }),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const file = await getFileMetadata(params.fileId, signal);
        const plan = describeReadPlan(file.mimeType ?? "", file.name);
        const extra = [`   read: ${plan}`];
        if (file.description) extra.push(`   description: ${file.description}`);
        if (file.createdTime) extra.push(`   created: ${file.createdTime}`);
        return toolText(`${formatFile(file)}\n${extra.join("\n")}`, { file, plan });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "gdrive_read",
    label: "Google Drive Read",
    description: `Read a Drive file. Google Docs become Markdown, Sheets become CSV (first tab; use gsheets_read for ranges), Slides become text. Other Google types are exported when possible. Text files are downloaded. Binary files and files over ${formatBytes(MAX_DOWNLOAD_BYTES)} are refused. Output truncates at ${MAX_TOOL_LINES} lines or ${formatBytes(MAX_TOOL_BYTES)}.`,
    promptSnippet: "Read a Drive file as Markdown, CSV, text, or exported content",
    promptGuidelines: ["Use gdrive_read for Docs, Slides, and file content; use gsheets_read for spreadsheet tabs and A1 ranges."],
    parameters: Type.Object({
      fileId: Type.String({ description: "Drive file id" }),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const file = await getFileMetadata(params.fileId, signal);
        const result = await readFileContent(file, signal);
        const header = [
          `Title: ${result.title}`,
          `Id: ${file.id}`,
          `MIME: ${file.mimeType ?? "unknown"}`,
          `Read: ${result.plan}`,
          "",
        ].join("\n");
        return toolText(`${header}${result.body || "(empty)"}`, {
          fileId: file.id,
          name: result.title,
          mimeType: file.mimeType,
          plan: result.plan,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  pi.registerTool({
    name: "gsheets_read",
    label: "Google Sheets Read",
    description: `Read Google Sheets values. Pass spreadsheetId plus an A1 range and/or sheet name. Defaults to the first tab, capped at ${DEFAULT_SHEET_ROWS} rows (max ${MAX_SHEET_ROWS}). Does not dump giant sheets.`,
    promptSnippet: "Read spreadsheet tabs or A1 ranges without dumping the whole workbook",
    promptGuidelines: ["Use gsheets_read for a specific tab or A1 range instead of dumping an entire spreadsheet."],
    parameters: Type.Object({
      spreadsheetId: Type.String({ description: "Spreadsheet id" }),
      range: Type.Optional(Type.String({ description: "A1 range such as Sheet1!A1:D20" })),
      sheet: Type.Optional(Type.String({ description: "Sheet/tab name when range is omitted" })),
      maxRows: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SHEET_ROWS, description: `Row cap when range has no end (default ${DEFAULT_SHEET_ROWS})` })),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const maxRows = clampPageSize(params.maxRows, DEFAULT_SHEET_ROWS, MAX_SHEET_ROWS);
        const meta = await listSheetTabs(params.spreadsheetId, signal);
        const tabList = meta.tabs.map((tab, i) => `${i + 1}. ${tab.title}`).join("\n") || "(no tabs)";

        let range = params.range?.trim();
        if (!range) {
          const sheetName = params.sheet?.trim() || meta.tabs[0]?.title;
          if (!sheetName) throw new GDriveError("Spreadsheet has no tabs.");
          range = `${quoteSheetName(sheetName)}!A1:ZZ${maxRows}`;
        }

        const data = await googleJson(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(range)}`,
          {
            query: {
              valueRenderOption: "FORMATTED_VALUE",
              majorDimension: "ROWS",
            },
            signal,
          },
        );

        const values = Array.isArray(data.values) ? (data.values as unknown[][]) : [];
        const sliced = values.length > maxRows ? values.slice(0, maxRows) : values;
        const truncatedRows = values.length > sliced.length;
        const body = [
          `Spreadsheet: ${meta.title}`,
          `Id: ${params.spreadsheetId}`,
          `Range: ${asString(data.range) ?? range}`,
          `Rows: ${sliced.length}${truncatedRows ? ` (truncated from ${values.length}; raise maxRows or pass a smaller range)` : ""}`,
          "",
          "Tabs:",
          tabList,
          "",
          sheetValuesToText(sliced),
        ].join("\n");
        return toolText(body, {
          spreadsheetId: params.spreadsheetId,
          title: meta.title,
          range: asString(data.range) ?? range,
          tabs: meta.tabs,
          rowCount: sliced.length,
          truncatedRows,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  });
}
