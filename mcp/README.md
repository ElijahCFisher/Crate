# Crate MCP server

Lets an MCP client (e.g. Claude Code) search, add, and update ratings in your
Crate food-rating data — same Google Drive files the web app uses, via the
same `crate-server` Worker backend for auth.

## Setup

```bash
cd mcp
npm install
```

### 1. Sign in (one-time, and again whenever the session expires)

```bash
npm run login
```

This starts a tiny local server on **http://localhost:3000** — stop
`npm run dev` first if it's using that port. Open the printed URL, click
"Sign in to Crate", and approve the Google consent screen. This is the same
auth-code flow the web app uses; it saves a session to
`~/.crate-mcp/session.json` that the MCP server reuses on every run. The
session lasts 30 days — rerun `npm run login` if the server reports
"Not authenticated".

Port 3000 specifically because it's the app's own local-dev origin, already
authorized for the Google OAuth client and whitelisted in the Worker's CORS
config — any other port will likely fail. If login fails with a
`redirect_uri_mismatch` or CORS-type error even on port 3000, the client's
authorized origins may need updating in Google Cloud Console.

### 2. Register the server with Claude Code

Add to your MCP config (`claude mcp add`, or edit `.mcp.json` /
`claude_desktop_config.json` directly):

```json
{
  "mcpServers": {
    "crate": {
      "command": "node",
      "args": ["src/server.js"],
      "cwd": "C:\\Users\\Elij\\Documents\\Programming\\Crate\\mcp"
    }
  }
}
```

## Tools

- `list_categories` — full category tree with uuids and paths.
- `search_ratings` — filter by text, category, score range.
- `add_rating` — add a new entry (score auto-snaps to the app's valid scale).
- `update_rating` — patch fields on an existing entry by uuid.
- `delete_rating` — delete by uuid, requires `confirm: true`.

## How it works

Reuses `crate-server`'s existing session/OAuth-token endpoints
(`/oauth/google/code`, `/api/google/access-token`) exactly like the web app
does — this server just replaces the browser's cookie jar with a file on
disk. Drive reads/writes reuse the same optimistic-concurrency (`version`
etag + retry loop) as the app, so it's safe to run alongside the web app or
other devices without clobbering concurrent edits. `csvService.js` and
`changelogUtils.js` are imported directly from `../src` — no forked copy to
drift out of sync; only `driveService.js` (Node-side auth) is forked.
