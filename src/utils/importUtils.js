import Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';
import { parseLegacyDate } from './dateUtils';
import { computeCategories } from './changelogUtils';

// ── Format detection ──────────────────────────────────────────────────────────

/**
 * Sniff the CSV text and return 'app' or 'legacy'.
 * App format starts with the SECTION,COMBINED marker.
 */
export function detectImportFormat(csvText) {
  const firstLine = (csvText || '').trim().split('\n')[0].trim();
  return firstLine === 'SECTION,COMBINED' ? 'app' : 'legacy';
}

// ── Legacy import ─────────────────────────────────────────────────────────────

/**
 * Import from the original spreadsheet CSV format.
 *
 * Supports two schema versions, auto-detected by the presence of a
 * "Category UUID" header column:
 *
 * NEW schema (Category UUID present):
 *   0  UUID
 *   1  Category UUID   — direct parent UUID (no name lookup needed)
 *   2  Category Name   — parent name (informational only)
 *   3  Brand Name      — EMPTY for category rows, non-empty for food rows
 *   4  Specifier       — for category rows: the category's own NAME
 *                        for food rows: the food specifier (e.g. "Chocolate")
 *   5  Location
 *   6  Score
 *   7  Date Rated      — M/D/YY or M/D/YYYY
 *   8  Additional Information
 *   9  Picture
 *   10 Entry Type
 *
 * OLD schema (no Category UUID column):
 *   0  UUID
 *   1  Categories       — top-level category name (disambiguation hint)
 *   2  Rating Category  — direct parent name
 *   3  Restaurant Names — EMPTY for category rows, non-empty for food rows
 *   4  Specifier
 *   5  Location
 *   6  Score
 *   7  Date Rated
 *   8  Additional Information
 *   9  Picture
 *
 * Original UUIDs are preserved so re-importing an updated file does not
 * create duplicates (importEntries in dataService skips existing UUIDs).
 */
export function importFromLegacyCsv(csvText, existingCombined) {
  const result = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
  const rows = result.data;

  if (!rows.length) return { entries: [], newCategories: [] };

  // Detect schema version by presence of the 'Category UUID' header
  const isNewSchema = 'Category UUID' in rows[0];

  return isNewSchema
    ? importFromNewSchema(rows, existingCombined)
    : importFromOldSchema(rows, existingCombined);
}

// ── New-schema import (Category UUID column present) ─────────────────────────

/**
 * New schema: col 1 is the direct parent UUID — no name-based lookup needed.
 * Category rows have an empty Brand Name; food rows have a non-empty Brand Name.
 */
function importFromNewSchema(rows, existingCombined) {
  const catRows  = rows.filter((r) => !(r['Brand Name'] || '').trim());
  const foodRows = rows.filter((r)  =>  (r['Brand Name'] || '').trim());

  const workingCombined = new Map(existingCombined);

  // ── Pass 1: build category entries ────────────────────────────────────────
  const newCategories = [];
  for (const row of catRows) {
    const uuid = (row['UUID'] || '').trim();
    if (!uuid) continue;
    if (workingCombined.has(uuid)) continue; // already imported / existing

    const name       = (row['Specifier']     || '').trim(); // category's own name
    const parentUuid = (row['Category UUID'] || '').trim();

    const cat = {
      uuid,
      entryType: 'category',
      identicals: [],
      categories: [],           // filled in pass 3
      ratingCategory: parentUuid,
      restaurantName: name,     // app stores category name in restaurantName
      specifier: '',
      location: '',
      score: row['Score'] != null && row['Score'] !== '' ? row['Score'] : null,
      dateRated: parseLegacyDate(row['Date Rated']),
      additionalInfo: row['Additional Information'] || '',
      picture: row['Picture'] || '',
    };
    newCategories.push(cat);
    workingCombined.set(uuid, cat);
  }

  // ── Pass 2: build food entries ────────────────────────────────────────────
  const entries = [];
  for (const row of foodRows) {
    const uuid = (row['UUID'] || '').trim() || uuidv4();
    if (workingCombined.has(uuid)) continue; // skip existing

    const entry = {
      uuid,
      entryType: 'food',
      identicals: [],
      categories: [],           // filled in pass 3
      ratingCategory: (row['Category UUID'] || '').trim(),
      restaurantName: row['Brand Name'] || '',
      specifier: row['Specifier'] || '',
      location: row['Location'] || '',
      score: row['Score'] != null && row['Score'] !== '' ? row['Score'] : null,
      dateRated: parseLegacyDate(row['Date Rated']),
      additionalInfo: row['Additional Information'] || '',
      picture: row['Picture'] || '',
    };
    entries.push(entry);
    workingCombined.set(uuid, entry);
  }

  // ── Pass 3: compute full ancestor chain for every new entry ───────────────
  for (const e of [...newCategories, ...entries]) {
    e.categories = computeCategories(e.ratingCategory, workingCombined);
  }

  return { entries, newCategories };
}

// ── Old-schema import (name-based lookup) ─────────────────────────────────────

/**
 * Old schema: parent category identified by name + top-level hint.
 * Requires name-based disambiguation when duplicate category names exist.
 */
function importFromOldSchema(rows, existingCombined) {
  // Separate category rows (empty restaurant) from food rows
  const catRows  = rows.filter((r) => !(r['Restaurant Names'] || '').trim());
  const foodRows = rows.filter((r)  => (r['Restaurant Names'] || '').trim());

  // ── Build name lookup table ───────────────────────────────────────────────
  // catsByName: lowerName → Array<{ uuid, parentName, topLevel }>
  // Used to resolve text category names → UUIDs, with topLevel disambiguation
  const catsByName = new Map();

  function registerCat(uuid, name, parentName, topLevel) {
    if (!uuid || !name) return;
    const key = name.toLowerCase().trim();
    if (!catsByName.has(key)) catsByName.set(key, []);
    catsByName.get(key).push({ uuid, parentName: (parentName || '').trim(), topLevel: (topLevel || '').trim() });
  }

  // Seed from existing app categories (restaurantName = category's display name)
  for (const [uuid, entry] of existingCombined) {
    if (entry.entryType === 'category') {
      registerCat(uuid, entry.restaurantName, '', '');
    }
  }

  // Register every category row from the import CSV
  // field 4 (Specifier) = category's own name; field 2 = parent name; field 1 = top-level
  for (const row of catRows) {
    const uuid      = (row['UUID']             || '').trim();
    const name      = (row['Specifier']        || '').trim();
    const parentName = (row['Rating Category'] || '').trim();
    const topLevel  = (row['Categories']       || '').trim();
    registerCat(uuid, name, parentName, topLevel);
  }

  /**
   * Resolve a text category name to a UUID.
   * @param {string} name         — text name to look up
   * @param {string} topLevelHint — field 1 value of the row being processed
   */
  function findCatUuid(name, topLevelHint) {
    if (!name || name.trim() === '' || name.trim() === '???') return '';
    const key = name.toLowerCase().trim();
    const matches = catsByName.get(key) || [];
    if (matches.length === 0) return '';
    if (matches.length === 1) return matches[0].uuid;
    // Prefer the entry whose topLevel matches the hint
    const hint = (topLevelHint || '').toLowerCase().trim();
    const hintMatch = matches.find((m) => m.topLevel.toLowerCase() === hint);
    if (hintMatch) return hintMatch.uuid;
    // Also try matching by parentName (e.g. "Chicken" with hint "Main")
    const parentMatch = matches.find((m) => m.parentName.toLowerCase() === hint);
    if (parentMatch) return parentMatch.uuid;
    return matches[0].uuid; // fallback: first registered
  }

  // Working map includes existing data so ancestor computation can chain upward
  const workingCombined = new Map(existingCombined);

  // ── Pass 1: build category entries ────────────────────────────────────────
  const newCategories = [];
  for (const row of catRows) {
    const uuid = (row['UUID'] || '').trim();
    if (!uuid) continue;
    if (workingCombined.has(uuid)) continue; // already imported / existing

    const name       = (row['Specifier']        || '').trim();
    const parentName = (row['Rating Category']  || '').trim();
    const topLevel   = (row['Categories']       || '').trim();

    // "Food" root has an empty Rating Category → no parent UUID
    const parentUuid = findCatUuid(parentName, topLevel);

    const cat = {
      uuid,
      entryType: 'category',
      identicals: [],
      categories: [],        // filled in pass 3
      ratingCategory: parentUuid,
      restaurantName: name,  // app stores category name in restaurantName
      specifier: '',
      location: '',
      score: row['Score'] != null && row['Score'] !== '' ? row['Score'] : null,
      dateRated: parseLegacyDate(row['Date Rated']),
      additionalInfo: row['Additional Information'] || '',
      picture: row['Picture'] || '',
    };
    newCategories.push(cat);
    workingCombined.set(uuid, cat);
  }

  // ── Pass 2: build food entries ────────────────────────────────────────────
  const entries = [];
  for (const row of foodRows) {
    const uuid = (row['UUID'] || '').trim() || uuidv4();
    if (workingCombined.has(uuid)) continue; // skip existing

    const ratingCategoryName = (row['Rating Category'] || '').trim();
    const topLevel           = (row['Categories']      || '').trim();
    const ratingCategoryUuid = findCatUuid(ratingCategoryName, topLevel);

    const entry = {
      uuid,
      entryType: 'food',
      identicals: [],
      categories: [],        // filled in pass 3
      ratingCategory: ratingCategoryUuid,
      restaurantName: row['Restaurant Names'] || '',
      specifier: row['Specifier'] || '',
      location: row['Location'] || '',
      score: row['Score'] != null && row['Score'] !== '' ? row['Score'] : null,
      dateRated: parseLegacyDate(row['Date Rated']),
      additionalInfo: row['Additional Information'] || '',
      picture: row['Picture'] || '',
    };
    entries.push(entry);
    workingCombined.set(uuid, entry);
  }

  // ── Pass 3: compute full ancestor chain for every new entry ───────────────
  for (const e of [...newCategories, ...entries]) {
    e.categories = computeCategories(e.ratingCategory, workingCombined);
  }

  return { entries, newCategories };
}
