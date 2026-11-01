# Crate

A food-rating app. React + Vite + MUI on the front, Google Drive as the entire
backend — your ratings live in CSV files in your own Drive, not in a database
someone else owns. Installable as a PWA and works offline (changes queue up and
sync when you're back).

## Running it

Needs Node 18+.

```bash
npm install
cp .env.example .env    # then fill in the two values
npm run dev
```

Open **http://localhost:3000** and sign in with Google.

The port matters: `3000` is the origin authorized on the Google OAuth client and
whitelisted in the `crate-server` Worker's CORS config. Vite is pinned to it in
`vite.config.js`, but if something else is already on 3000 Vite will silently
pick 3001 and sign-in will fail with a `redirect_uri_mismatch`. Free the port
rather than letting it move.

### Environment

`.env` (gitignored — copy from `.env.example`):

| Variable | What it is |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID, `*.apps.googleusercontent.com` |
| `VITE_API_BASE` | The `crate-server` Cloudflare Worker that handles the auth-code exchange |

The Worker only brokers auth. All reads and writes go from the browser straight
to Drive.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build into `dist/` (also generates the service worker) |
| `npm run preview` | Serve the built `dist/` locally |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Vitest in watch mode |

Tests are Vitest with happy-dom, colocated as `*.test.js` / `*.test.jsx` next to
what they test.

## Where the data lives

On first sign-in the app creates a **Food Ratings** folder in your Drive:

- **Food Ratings Data** (Google Sheet) — current state, one row per entry
  (ratings, categories and to-try items, distinguished by `Entry Type`)
- **Food Ratings Changelog** (Google Sheet) — append-only log of every
  add/modify/delete, which is what makes multi-device sync and changelog import
  work
- `SettingsEtc.json` — bulk-add groups, friends, notes, preferences
- `Pictures/` — uploaded photos, referenced by file ID

A change appends a row to the changelog and edits only the cells it changed in
the data sheet, through the Sheets API. Rows are found by UUID and columns by
header name, so you can add your own columns or edit cells by hand. The app
finds the two sheets by a Drive property, not by name, so renaming them is
fine too. Offline edits go to a write-ahead log in `localStorage` and replay on
reconnect.

**Older data: the CSV files.** Before the Sheets, data lived in
`food-ratings-data.csv` and `food-ratings-changelog.csv` in the same folder.
The first time the app (or the MCP server) loads, it copies them into the
Sheets and switches over (`src/services/sheetStore.js`). The CSVs are never
deleted or written again. If something still on the old version writes to the
changelog CSV afterwards, the next load replays those changes into the Sheets.
If the copy can't be made, for example because the Sheets API isn't enabled,
the app keeps using the CSVs exactly as before and tries again on the next
load. When you move to the Sheets, the people you share with get the data
Sheet shared with them too, and following a friend reads their Sheet once they
have one.

**Sheets API:** it has to be enabled in the Google Cloud project that owns the
OAuth client (APIs & Services → Library → Google Sheets API → Enable). No new
scope is needed, because the existing `drive` scope covers it.

## Layout

```
src/
  components/     UI, grouped by feature (Entries, Categories, Filters, Friends…)
  hooks/          useData — all CRUD + sync + offline queue lives here
  services/       csvService (schema, parse/serialize), sheetStore (Sheets storage + CSV migration),
                  dataService (writes), driveService, auth
  utils/          filter logic, changelog helpers, field links, math/date helpers
mcp/              MCP server — see mcp/README.md
```

`src/services/csvService.js` is the schema: the `COMBINED_FIELDS` and
`CHANGELOG_FIELDS` arrays are the columns, for both the Sheets and the CSVs (a
Sheet missing a new column gets it added on the next write). Adding a column means touching
both those arrays *and* all four row converters in that file, plus
`parseFieldValue` in `dataService.js` — otherwise the field won't survive a
changelog replay.

## MCP server

`mcp/` is a Model Context Protocol server that lets Claude Code search, add, and
update your ratings against the same Drive files. Setup and tool list are in
[`mcp/README.md`](mcp/README.md) — short version:

```bash
cd mcp && npm install && npm run login
```

Stop `npm run dev` first; the login flow wants port 3000 too.
