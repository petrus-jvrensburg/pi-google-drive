export const EXTENSION_NAME = "gdrive";

export const CONFIG_DIR_NAME = "google-drive";
export const CONFIG_FILE_NAME = "oauth.json";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const SHEETS_API = "https://sheets.googleapis.com/v4";
export const DOCS_API = "https://docs.googleapis.com/v1";

export const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
] as const;

export const OAUTH_TIMEOUT_MS = 180_000;
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_SHEET_ROWS = 200;
export const MAX_SHEET_ROWS = 500;

/** Match Pi built-in tool truncation (~50KB / 2000 lines). */
export const MAX_TOOL_BYTES = 50 * 1024;
export const MAX_TOOL_LINES = 2000;
export const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
export const DOCUMENT_MIME = "application/vnd.google-apps.document";
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const PRESENTATION_MIME = "application/vnd.google-apps.presentation";

export const FILE_LIST_FIELDS =
  "nextPageToken,files(id,name,mimeType,modifiedTime,size,parents,webViewLink,driveId,shortcutDetails,owners(displayName,emailAddress))";

export const FILE_GET_FIELDS =
  "id,name,mimeType,description,size,createdTime,modifiedTime,parents,webViewLink,webContentLink,driveId,md5Checksum,shortcutDetails,owners(displayName,emailAddress),capabilities,exportLinks";

export const MIME_ALIASES: Record<string, string> = {
  folder: FOLDER_MIME,
  folders: FOLDER_MIME,
  doc: DOCUMENT_MIME,
  docs: DOCUMENT_MIME,
  document: DOCUMENT_MIME,
  documents: DOCUMENT_MIME,
  sheet: SPREADSHEET_MIME,
  sheets: SPREADSHEET_MIME,
  spreadsheet: SPREADSHEET_MIME,
  spreadsheets: SPREADSHEET_MIME,
  slide: PRESENTATION_MIME,
  slides: PRESENTATION_MIME,
  presentation: PRESENTATION_MIME,
  presentations: PRESENTATION_MIME,
  pdf: "application/pdf",
};

export const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/yaml",
  "application/x-yaml",
  "application/csv",
  "application/x-csv",
  "application/rtf",
  "application/sql",
  "application/toml",
  "application/x-sh",
  "application/x-httpd-php",
  "image/svg+xml",
]);

export const TEXT_NAME_RE =
  /\.(txt|md|markdown|csv|tsv|json|xml|html|htm|css|js|mjs|cjs|ts|tsx|jsx|yml|yaml|svg|log|ini|cfg|conf|sh|bash|zsh|py|rb|go|rs|java|c|h|cpp|cc|hpp|toml|sql|r|php|vue|svelte|graphql|gql)$/i;

export const WRITE_SCOPE_RE =
  /\/auth\/(?:drive|documents|spreadsheets|presentations)$/i;
