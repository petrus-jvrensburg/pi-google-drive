# pi-google-drive

Read-only [Pi](https://pi.dev) extension for **Google Drive, Docs, Sheets, and Slides**. After a one-time browser OAuth login, the model can search and read files the signed-in Google account can already see — including Shared Drives.

This package is **not** an MCP proxy. It registers native `pi.registerTool()` tools.

Default scopes are read-only. There are no write tools in v1.

## Install

```bash
pi install git:github.com/petrus-jvrensburg/pi-google-drive
```

From a local clone:

```bash
pi install /absolute/path/to/pi-google-drive
```

Restart Pi, or run `/reload` in an existing session.

A later `pi install npm:pi-google-drive` path may be added once the package is published to npm.

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

## Behavior notes

- **Visibility** matches the signed-in user, including Shared Drives (`supportsAllDrives` / `includeItemsFromAllDrives`).
- **Read-only.** The model is instructed not to offer Drive writes.
- **Truncation.** Tool output is capped around 50KB / 2000 lines. Downloads over 5MB are refused. Narrow the query, folder, MIME type, or sheet range.
- **PDF / images / other binaries** are not extracted in v1. Metadata is available via `gdrive_get`.
- **Docs → Markdown** uses Drive export, with a Docs JSON converter as fallback.
- Missing auth returns a “run `/gdrive-setup`” error. It does not crash Pi.

## Security

Tokens are stored at `~/.pi/agent/google-drive/oauth.json` with mode `0600`.

Never put OAuth client secrets, refresh tokens, or `.env` contents in git, issues, or chat logs. This repository is public and company-neutral on purpose.

The status tool and `/gdrive-status` redact credentials. Error messages strip common Google token prefixes.

Revoke access from your Google Account if the machine is shared or the client is compromised.

## Development

```bash
npm test
```

Tests cover query building, export MIME mapping, truncation, Docs → Markdown fixtures, and status sanitization. They do not perform live OAuth.

## License

MIT
