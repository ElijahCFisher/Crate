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
- `search_ratings` — FilterBuilder.applyFilters as-is, same filter shape as the app's Filters panel (`field`/`op`/`value`/`caseSensitive`/`useRegex`/`connector`). Results include `identicals` (the entry's own field) when non-empty.
- `add_rating` — dataService.addBulkRating as-is, same `groups: Array<Array<entry>>` shape: entries within a group get `identicals` set to each other (same dish rated again — Rerate); separate groups aren't linked to each other (different dishes — "add another item from this visit"), but every entry across every group in the call is still recorded as one Bulk Adds entry.
- `update_rating` — dataService.modifyEntry as-is: named parameters for the common fields (with category-name resolution and score-snapping conveniences), plus a raw `fields` passthrough for anything else (e.g. `picture`) — same generic behavior as calling modifyEntry directly.
- `delete_rating` — delete by uuid, requires `confirm: true`.

## How it works

Reuses `crate-server`'s existing session/OAuth-token endpoints
(`/oauth/google/code`, `/api/google/access-token`) exactly like the web app
does — this server just replaces the browser's cookie jar with a file on
disk. Drive reads/writes reuse the same optimistic-concurrency (`version`
etag + retry loop) as the app, so it's safe to run alongside the web app or
other devices without clobbering concurrent edits. `csvService.js`,
`changelogUtils.js`, and `filterLogic.js` are imported directly from
`../src` — no forked copy to drift out of sync (`filterLogic.js` was
extracted out of `FilterBuilder.jsx` specifically so it could be imported
by plain Node — see that file's header comment). `driveService.js` and
`settingsService.js` are forked (Node-side auth instead of the browser's
cookie jar), and `dataService.js` mirrors the app's real functions
(`addBulkRating`/`modifyEntry`/`deleteEntry`) by hand for the same reason.
Keep those two forks in sync with `src/services/` if the real ones change.
