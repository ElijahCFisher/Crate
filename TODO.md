# TODO

Ideas that aren't built yet, with what each would take and what needs deciding
first. (Shipped items live in the git log, not here.)

## Needs a decision first

- **Percentage rating for brands — "like their product line".** Most likely
  meaning: how much of a brand's product line you've rated (e.g. 14 of Dutch
  Bros' drinks). The hard part is knowing the whole line — there's no source for
  it. The To Try tab can stand in: a brand's to-try items (tried or not) plus its
  rated items make a known line to take a percentage of.

- **Score for brands that aren't rated enough / rate each result by its main
  filter.** E.g. McDonald's judged against fast food, not against everything.
  Undecided what "main filter" should mean. Options when this comes back up: the
  brand's most common category, or a category you assign per brand; plus a
  shrinkage rule so a brand with 2 ratings doesn't outrank one with 40 (a
  Bayesian average toward the category mean). Starting points: `getScoreStats`
  in `EntryTable.jsx`, `convertToBaseScore`.

## Bigger features

- **Suggested ratings to update** — a review queue of things that look wrong or
  unfinished:
  - recent entries missing a score, category or location;
  - a guessed location that should be confirmed (Google Maps Timeline could
    supply real visits, but Timeline moved on-device in 2024 and has no public
    API — it'd mean importing a Takeout export);
  - older entries that probably should match newer ones (same food and place,
    different spelling or category);
  - duplicate records to merge (e.g. "cookie" filed under several brands).
  Most of these are queries over existing data; the design work is the review
  UI (accept / edit / dismiss, and remembering dismissals — `SettingsEtc.json`).

- **What to eat suggestions** — modes like "need more info" (places/foods with
  few ratings), "try something new" (categories or restaurants you rarely rate,
  and open items from the To Try tab),
  "eat good food" (your best-rated nearby), filtered by genre. The first three
  are pure local data. Online ratings and DoorDash need outside APIs: DoorDash
  has no public consumer ordering/menu API (Drive is Crate's only backend today,
  so this would also mean adding a server-side piece to the Worker).

- **Auto-balance suggestions.** Rebalancing exists (Categories → edit →
  Rebalance). A suggestion would flag categories whose children have drifted —
  e.g. the category's own score is far from its children's converted average.
  `computeRebalance` in `scaleUtils.js` already computes the average to compare.

- **Photo metadata.** Photos are already stored in Drive. Reading the date taken
  from EXIF to fill Date Rated is modest work but needs an EXIF parser
  dependency (e.g. `exifr`). GPS → a place name needs reverse geocoding (an
  outside API, and a location-privacy decision). Guessing the food category from
  the image needs a vision model.

## Noticed while working

- **The app freezes for several seconds at times** with ~10.7k entries —
  browser automation hit 30s renderer timeouts right after the Drive sync
  finished and around opening/closing the entry dialog. Worth profiling: likely
  candidates are the entry dialog's suggestion lists (rebuilt from every entry
  when it opens) and re-sorting/re-grouping the full table on each data change.

- **Sign-out on the server side is unverified.** Sign-out now clears everything
  this device holds and reports if the Worker's `/logout` call fails, but
  whether `/logout` actually revokes the session lives in the `crate-server`
  Worker, which isn't in this repo.

- **The MCP server doesn't know about search aliases/places or To Try.**
  `applyFilters` takes the vocabulary as an option; the MCP search tool could
  read `searchVocabulary` from `SettingsEtc.json` and pass it through. To-try
  items (Entry Type `totry`) are invisible to it; tools to list/add them would
  follow the ratings tools.

- **Tests.** There's a Vitest suite (360+ tests) covering the filter engine, text
  mode, CSV/import, scales and the entry form's pure logic. What's missing is
  component-level coverage (no React Testing Library yet) — e.g. row-click vs
  button-click in the table, the paste-filter dialog, pagination staying put.
