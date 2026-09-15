import { DOCS_API, DRIVE_API, FILE_LIST_FIELDS, SHEETS_API } from "./constants.ts";
import { asJsonMap, asString, googleErrorMessage, parseJson, type JsonMap } from "./format.ts";
import { getValidConfig, refreshConfig, type AuthConfig } from "./oauth.ts";

export type QueryValue = string | number | boolean | undefined;

export class GDriveError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GDriveError";
    this.status = status;
  }
}

function applyQuery(url: URL, query?: Record<string, QueryValue>): void {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
}

function resolveUrl(path: string): URL {
  if (path.startsWith("http://") || path.startsWith("https://")) return new URL(path);
  if (path.startsWith("/drive/v3")) return new URL(`https://www.googleapis.com${path}`);
  if (path.startsWith("/v4/spreadsheets")) return new URL(`${SHEETS_API}${path.slice("/v4".length)}`);
  if (path.startsWith("/v1/documents")) return new URL(`${DOCS_API}${path.slice("/v1".length)}`);
  if (path.startsWith("/files") || path.startsWith("/drives") || path.startsWith("/about")) {
    return new URL(`${DRIVE_API}${path}`);
  }
  return new URL(path, DRIVE_API);
}

async function authorizedFetch(
  url: URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<{ res: Response; config: AuthConfig }> {
  let config = await getValidConfig(signal);
  const make = (accessToken: string) =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
      signal,
    });

  let res = await make(config.tokens.access_token);
  if (res.status === 401 && config.tokens.refresh_token) {
    config = await refreshConfig(config, signal);
    res = await make(config.tokens.access_token);
  }
  return { res, config };
}

export async function googleJson(
  path: string,
  options: {
    method?: "GET" | "POST";
    query?: Record<string, QueryValue>;
    body?: JsonMap;
    signal?: AbortSignal;
  } = {},
): Promise<JsonMap> {
  const url = resolveUrl(path);
  applyQuery(url, options.query);
  const { res } = await authorizedFetch(
    url,
    {
      method: options.method ?? "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.signal,
  );

  const text = await res.text();
  const data = parseJson(text);
  if (!res.ok) {
    throw new GDriveError(googleErrorMessage(data, res.status), res.status);
  }
  return data;
}

export async function googleText(
  path: string,
  options: {
    query?: Record<string, QueryValue>;
    signal?: AbortSignal;
    maxBytes?: number;
  } = {},
): Promise<{ text: string; contentType: string }> {
  const binary = await googleBytes(path, options);
  return {
    text: Buffer.from(binary.bytes).toString("utf8"),
    contentType: binary.contentType,
  };
}

export async function googleBytes(
  path: string,
  options: {
    query?: Record<string, QueryValue>;
    signal?: AbortSignal;
    maxBytes?: number;
  } = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const url = resolveUrl(path);
  applyQuery(url, options.query);
  const { res } = await authorizedFetch(url, { method: "GET" }, options.signal);

  if (!res.ok) {
    const text = await res.text();
    throw new GDriveError(googleErrorMessage(parseJson(text), res.status), res.status);
  }

  const contentLength = asString(res.headers.get("content-length"));
  if (options.maxBytes && contentLength && Number(contentLength) > options.maxBytes) {
    res.body?.cancel();
    throw new GDriveError(
      `File is larger than the ${options.maxBytes} byte download limit. Narrow the request or use gdrive_get for metadata.`,
      413,
    );
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (options.maxBytes && bytes.byteLength > options.maxBytes) {
    throw new GDriveError(
      `Downloaded content exceeded the ${options.maxBytes} byte limit. Narrow the request.`,
      413,
    );
  }

  return {
    bytes,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function driveAboutUser(signal?: AbortSignal): Promise<{ email?: string; displayName?: string }> {
  const data = await googleJson("/about", {
    query: { fields: "user(displayName,emailAddress)" },
    signal,
  });
  const user = asJsonMap(data.user);
  return {
    email: asString(user.emailAddress),
    displayName: asString(user.displayName),
  };
}

export const allDrivesParams = {
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
  corpora: "allDrives",
} as const;

export function driveListParams(extra: Record<string, QueryValue> = {}, driveId?: string): Record<string, QueryValue> {
  if (driveId) {
    return {
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "drive",
      driveId,
      ...extra,
    };
  }
  return {
    ...allDrivesParams,
    ...extra,
  };
}

export async function listDriveFiles(options: {
  q: string;
  pageSize: number;
  pageToken?: string;
  driveId?: string;
  signal?: AbortSignal;
}): Promise<JsonMap> {
  const extra: Record<string, QueryValue> = {
    q: options.q,
    pageSize: options.pageSize,
    pageToken: options.pageToken,
    fields: FILE_LIST_FIELDS,
  };
  try {
    return await googleJson("/files", {
      query: driveListParams(extra, options.driveId),
      signal: options.signal,
    });
  } catch (error) {
    if (options.driveId) throw error;
    const message = error instanceof Error ? error.message : "";
    if (!/corpora|allDrives|orderBy/i.test(message)) throw error;
    return await googleJson("/files", {
      query: {
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        ...extra,
      },
      signal: options.signal,
    });
  }
}
