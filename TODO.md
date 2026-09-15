# TODO

Ideas that aren't built yet, with what each would take and what needs deciding
first. (Shipped items live in the git log, not here.)

## Needs a decision first

- **Percentage rating for brands — "like their product line".** Most likely
  meaning: how much of a brand's product line you've rated (e.g. 14 of Dutch
  Bros' drinks). The hard part is knowing the whole line — there's no source for
  it. The To Try list (below) can stand in: a brand's to-try items plus its rated
  items make a known line to take a percentage of. Revisit once To Try exists.

- **Score for brands that aren't rated enough / rate each result by its main
  filter.** E.g. McDonald's judged against fast food, not against everything.
  Undecided what "main filter" should mean. Options when this comes back up: the
  brand's most common category, or a category you assign per brand; plus a
  shrinkage rule so a brand with 2 ratings doesn't outrank one with 40 (a
  Bayesian average toward the category mean). Starting points: `getScoreStats`
  in `EntryTable.jsx`, `convertToBaseScore`.

## Bigger features

- **To Try tab.** Replaces a long hand-kept doc of places and foods to try. What
  that doc shows the feature needs:
  - **Items at different grains** — a restaurant ("Big Sky Burger"), a restaurant
    plus specific dishes (a deli, "challah french toast"), a chain's menu items
    (a long list of Dutch Bros drinks, McDonald's flavors), a grocery or frozen
    brand, a food type with no restaurant ("Sonoran dog", "elote"), a recipe or
    homemade idea, even an event (a food festival). So: restaurant/brand and food
    both optional, at least one required, and a brand can hold many food items
    checked off one at a time.
  - **Grouped by place, then genre** — cities (Denver, Colorado Springs, Tucson,
    NYC, LA, Japan…), sometimes a neighborhood or "10 min NE", then Coffee,
    Burgers, Pizza, Dessert… Location should use the same place hierarchy as
    search (`Denver > CO`), genre should be an existing category, and the list
    should use the same filter bar. Chain and grocery items have no place.
  - **Notes that are really fields** — who recommended it or where from ("#79 on
    Yelp's top 100", "server says it's better than X"), who to go with (the doc
    marks some with a letter prefix), hours ("closed Sun, Mon"), how to get it
    (in person, DoorDash, Goldbelly for shipping), and links (Maps, a separate
    spreadsheet for one city). Tags for people and "how to get it", free text
    for the rest.
  - **Tried states** — "had it, try more (curry)?", "what I doordashed wasn't
    great", an item that already has a score written next to it. "Rate it" should
    open Add Entry prefilled from the item (the Clone prefill already does this)
    and mark the item tried, linked to the new rating; the item can stay open
    for "try more".
  - **Gone** — a "Limited Time Gone" section: items that can't be tried anymore,
    kept for the record rather than deleted.
  - **Duplicates** — the same place appears twice in different sections, with a
    spelling variant too; adding one should warn about a close match.
  - **Import** — typing ~300 lines back in by hand is the real barrier. A paste
    importer in the spirit of text mode: a line ending in ":" is a section (place
    or genre), "Name - notes" splits into name and notes, a leading prefix
    becomes a tag, and a preview to fix up before saving.
  - **Hooks elsewhere** — adding a rating that matches an open to-try item offers
    to check it off; "try something new" suggestions draw from it.
  - **Storage** — either a new Entry Type in the data CSV (gets sync, changelog
    and conflict handling for free) or a list in `SettingsEtc.json` (simpler, but
    that file is rewritten whole). The CSV is the safer choice.
  - **Open question** — what the doc's "D" and "DD" prefixes mean (seen in the
    Tucson and Colorado Springs sections) before they become tags.

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
