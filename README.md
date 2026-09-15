# pi-google-drive

Read-only [Pi](https://pi.dev) extension for **Google Drive, Docs, Sheets, and Slides**. After a one-time browser OAuth login, the model can search and read files the signed-in Google account can already see — including Shared Drives.

Native `pi.registerTool()` tools, not an MCP proxy. Default scopes are read-only; there are no write tools. See [Limitations](#limitations) before extending it.

## Install

```bash
pi install git:github.com/petrus-jvrensburg/pi-google-drive
```

From a local clone:

```bash
pi install /absolute/path/to/pi-google-drive
```

Restart Pi, or run `/reload` in an existing session.

## One-time Google Cloud setup

Bring your own OAuth client. This package does **not** ship a shared client secret.

1. Create or select a Google Cloud project at [Google Cloud Console](https://console.cloud.google.com/).
2. Enable APIs:
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
3. Configure the [OAuth consent screen](https://console.cloud.google.com/auth/clients).
   - User type **External** is fine for a personal desktop client.
   - If the app is in **Testing**, add your Google account as a test user.
   - You do not need to publish the app to use it yourself.
4. Create an OAuth client:
   - Application type: **Desktop app**
   - Copy the **Client ID**
   - Copy the **Client secret** (Google still issues one for Desktop clients; treat it as a secret)
5. Desktop clients automatically allow loopback redirects (`http://127.0.0.1:<port>/...`). You do not need to register a redirect URI.

If you use a **Web application** client instead, you must add the exact loopback redirect URI (for example `http://127.0.0.1:53682/oauth2callback`) in the Google Cloud client settings, then pass that same URI to `/gdrive-setup`.

## Connect Pi

In Pi:

```text
/gdrive-setup
```

You will be asked for:

- Client ID
- Client secret (optional in the prompt; Desktop clients from Google Cloud include one — paste it)
- Redirect URI (leave blank to bind `http://127.0.0.1:<ephemeral-port>/oauth2callback`)

Pi opens a browser. Sign in with the Google account whose Drive you want the agent to see. Grant the read-only Drive and Sheets scopes.

Then:

```text
/gdrive-status
```

That should show the account email, `read-only: yes`, and that a refresh token is stored. It never prints tokens or the client secret.

Logout (local tokens only):

```text
/gdrive-logout
```

Also revoke the app under [Google Account → Third-party access](https://myaccount.google.com/permissions) if you want Google to drop the grant.

## What the model can do

| Tool | Purpose |
|---|---|
| `gdrive_status` | Auth state (account, scopes, read-only). No secrets. |
| `gdrive_search` | Search My Drive and Shared Drives. Simple text or raw Drive `q=` operators. |
| `gdrive_list` | List a folder. Optional Shared Drive id. |
| `gdrive_list_shared_drives` | List Shared Drives the user can access. |
| `gdrive_get` | Metadata for a file id. |
| `gdrive_read` | File content. Docs → Markdown; Sheets → CSV (first tab); Slides → text; other Google types via export; text files inlined; large/binaries refused. |
| `gsheets_read` | Spreadsheet tabs + A1 ranges. Capped so giant sheets are not dumped. |

Commands: `/gdrive-setup`, `/gdrive-logout`, `/gdrive-status`.

## Example prompts

- Search my Drive for last quarter’s budget spreadsheet
- List Shared Drives I can access, then list the root of one of them
- Read this Google Doc as Markdown
- Read the Summary tab of that sheet, columns A–F only
- What MIME type is this file id, and can you read it?

The tools search before they need a file id. Prefer `gsheets_read` with a range over asking `gdrive_read` to dump an entire workbook.

## Limitations

Current constraints:

### Setup and auth

- `/gdrive-setup` needs interactive UI (TUI or RPC). `pi -p` / JSON mode cannot finish OAuth.
- Bring-your-own Google Cloud **Desktop** OAuth client. This package will not ship a shared client secret.
- Consent screen in **Testing** only works for listed test users. Unverified apps show Google’s warning; Workspace admins can block them.
- OAuth loopback callback waits **3 minutes**, then times out.
- `/gdrive-logout` deletes `~/.pi/agent/google-drive/oauth.json` only. The Google grant remains until the user revokes it.
- Scopes: `drive.readonly` and `spreadsheets.readonly`. Docs and Slides go through Drive export. The Docs JSON → Markdown fallback may 403 because `documents.readonly` is not requested; plain-text export is the last resort.

### IDs, search, and listing

- Tools take Drive **file ids** (and spreadsheet ids). They do **not** parse `docs.google.com` / `drive.google.com` URLs.
- There is no `gdrive_recent` and no folder-path breadcrumbs. The model must search or walk parents.
- Search/list `pageSize` defaults to **20**, max **50**. `orderBy` is not sent with `corpora=allDrives` (unsupported); results are sorted client-side.
- Drive `name contains` / `fullText contains` is literal, not Google’s consumer search box.

### Reads

- **Read-only.** No upload, create, update, delete, or sharing.
- `gdrive_read` on a spreadsheet exports **the first tab as CSV**. Other tabs and A1 ranges need `gsheets_read`.
- `gsheets_read` defaults to **200** rows, max **500**. Unbounded ranges are still sliced.
- Tool text is truncated at **~50KB / 2000 lines**. Media downloads over **5MB** are refused. Nothing is written to a temp file.
- **Not extracted:** PDF, images, Office binaries, Google Forms, Drawings, Maps. Use `gdrive_get` for metadata.
- Slides are **plain text**, not structured speaker notes / slide objects.
- No export-to-local-file helper (PDF/DOCX/XLSX/PPTX on disk).
- No Doc comments or suggested edits.
- Missing auth returns “run `/gdrive-setup`”. The extension does not crash Pi.

### Out of scope

- npm publishing
- Gmail, Calendar, Chat, Tasks
- MCP client / wrapping a giant Workspace MCP
- Service accounts or domain-wide delegation (user OAuth is the product)
- Write tools without an explicit follow-up and a confirm gate

## Where to focus next

Highest leverage, in order:

1. **Accept Drive/Docs/Sheets URLs** in `gdrive_get` / `gdrive_read` / `gsheets_read`, and add `gdrive_recent`. Most prompts are a link, not an id.
2. **Confirm-gated export to a local file** for PDF/DOCX/XLSX so Pi’s `read` tool can take over. Optional cheap PDF text for small files only.
3. **Tiny write surface**, off by default (`drive.file` or a `/gdrive-writes` flag), always `ctx.ui.confirm`: upload, `gsheets_update` for a range, `gdocs_append`. No delete, no share, no replace-entire-doc.
4. **Recorded HTTP fixtures** for Shared Drive `files.list`, shortcut follow, 401 refresh, and a fat sheet truncation. Still no live OAuth in CI.

Keep the tool catalog small.

## Behavior notes

- Visibility matches the signed-in user, including Shared Drives (`supportsAllDrives` / `includeItemsFromAllDrives`). Search defaults to `corpora=allDrives` and retries without that corpora if Google rejects it.
- Docs → Markdown uses Drive `text/markdown` export, then Docs JSON conversion, then `text/plain`.
- Shortcuts are followed (capped depth). Folders must be listed with `gdrive_list`, not read.

## Security

Tokens are stored at `~/.pi/agent/google-drive/oauth.json` with mode `0600`.

Never put OAuth client secrets, refresh tokens, or `.env` contents in git, issues, or chat logs.

The status tool and `/gdrive-status` redact credentials. Error messages strip common Google token prefixes.

Revoke access from your Google Account if the machine is shared or the client is compromised.

## Development

```bash
npm test
```

Tests cover query building, export MIME mapping, truncation, Docs → Markdown fixtures, and status sanitization. They do not perform live OAuth.

## License

MIT
