# TODO

Ideas that aren't built yet, with what each would take and what needs deciding
first. (Shipped items live in the git log, not here.)

## Needs a decision first

- **Percentage rating for brands.** What's the percentage of? Share of a brand's
  ratings above some score? Its average as a percent of 10? Its rank against
  other brands in the same category? Once that's pinned down it's a column or
  stat on a restaurant/brand view, which doesn't exist yet either.

- **Score for brands that aren't rated enough / rate each result by its main
  filter.** E.g. McDonald's judged against fast food, not against everything.
  Needs: (1) what "main filter" means per brand — probably its most common
  category, or a category you assign to the brand; (2) a shrinkage rule so a
  brand with 2 ratings doesn't outrank one with 40 (a Bayesian average toward the
  category mean is the usual answer); (3) where it shows — a Brands tab? The
  table's stats code (`getScoreStats` in `EntryTable.jsx`) and
  `convertToBaseScore` are the starting points.

- **Displayed ratings relative to Food.** The entries table already has a
  **Show as Food** switch (it converts every score to the root category's scale —
  your root is Food). Is that what you meant, or something more: making it the
  default, applying it to averages/exports, or relative to a category other than
  the root?

- **"Bubble sort the last 100 entries to make sure they're in date order."** The
  table always sorts on the fly, so this presumably means the stored order in
  `food-ratings-data.csv` (or the changelog). Where does the out-of-order data
  show up — the Drive file, the MCP server's results, bulk adds? A one-time
  "sort stored rows by date" (a stable sort, not literally bubble sort) is easy
  once we know which order matters.

- **Food to try integration.** Integration with what — a list inside Crate
  ("want to try" entries with no score), or an outside app/list?

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
  few ratings), "try something new" (categories or restaurants you rarely rate),
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

- **The MCP server doesn't know about search aliases/places.** `applyFilters`
  takes the vocabulary as an option; the MCP search tool could read
  `searchVocabulary` from `SettingsEtc.json` and pass it through.

- **Tests.** There's a Vitest suite (360+ tests) covering the filter engine, text
  mode, CSV/import, scales and the entry form's pure logic. What's missing is
  component-level coverage (no React Testing Library yet) — e.g. row-click vs
  button-click in the table, the paste-filter dialog, pagination staying put.
