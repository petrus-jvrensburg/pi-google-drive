---
name: gdrive
description: Search and read Google Drive, Docs, Sheets, and Slides with the signed-in user's OAuth. Use when the user asks to find or read Drive files, Google Docs, spreadsheets, slides, or Shared Drives.
---

# Google Drive (read-only)

Use the `gdrive_*` and `gsheets_read` tools. Do not guess file ids.

## Setup

If `gdrive_status` says the account is not connected, tell the user to run `/gdrive-setup` in Pi (interactive browser OAuth with their own Google Cloud Desktop client). Do not invent credentials.

The active login is the nearest `.pi/google-drive/oauth.json` at or above the session directory. A parent workspace login covers nested repos. A closer file overrides it. A token in `~/.pi/agent/google-drive/oauth.json` is not used. Do not assume one Google account applies to every repo.

## Workflow

1. `gdrive_search` with a short text query. Add `mimeType` aliases when useful: `doc`, `sheet`, `slides`, `folder`, `pdf`.
2. For a known folder or Shared Drive root, `gdrive_list`. Discover Shared Drive ids with `gdrive_list_shared_drives`.
3. `gdrive_get` if you only need metadata (MIME, size, link).
4. `gdrive_read` for Docs (Markdown), Slides (text), text files, or a Sheet exported as CSV (first tab).
5. `gsheets_read` for a specific tab or A1 range. Always prefer a range over dumping a whole workbook.

Raw Drive `q=` operators can go in `q` or in `query` when they look like `name contains '…'`, `mimeType = '…'`, `'folderId' in parents`, `modifiedTime > '…'`.

## Limits

- Read-only. Do not offer to create, edit, upload, or delete Drive files.
- Large results truncate. Narrow the search, folder, MIME type, or sheet range.
- Binaries (PDF, images, Office files) are not inlined. Report metadata instead.
- Visibility is whatever the signed-in Google account can already see, including Shared Drives.

## Privacy

Never print OAuth client secrets, refresh tokens, access tokens, or raw `.env` values. `gdrive_status` is the right way to inspect auth. It includes the config path and whether the login is inherited from a parent directory.
