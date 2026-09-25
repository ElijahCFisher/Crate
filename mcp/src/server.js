import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import * as driveService from './driveService.js';
import * as dataService from './dataService.js';
import * as settingsService from './settingsService.js';
import { DRIVE_FOLDER_NAME, DRIVE_FILE_NAME, DRIVE_CHANGELOG_FILE_NAME } from './config.js';
import { roundToValidScore, VALID_SCORES } from '../../src/utils/scaleUtils.js';
import { applyFilters } from '../../src/utils/filterLogic.js';
import { TOTRY_TYPE, findSimilarItems, makeToTryItem, statusOf } from '../../src/utils/toTryUtils.js';

// ── Drive file-id resolution (cached per process) ───────────────────────────

let fileIdsPromise = null;
function getFileIds() {
  if (!fileIdsPromise) {
    fileIdsPromise = (async () => {
      const folderId = await driveService.findOrCreateFolder(DRIVE_FOLDER_NAME);
      const [combinedFileId, changelogFileId, settingsFileId] = await Promise.all([
        driveService.findOrCreateFile(folderId, DRIVE_FILE_NAME),
        driveService.findOrCreateFile(folderId, DRIVE_CHANGELOG_FILE_NAME),
        settingsService.getOrCreateSettingsFile(folderId),
      ]);
      return { combinedFileId, changelogFileId, settingsFileId };
    })().catch((err) => { fileIdsPromise = null; throw err; });
  }
  return fileIdsPromise;
}

function text(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

function errorResult(err) {
  return { content: [{ type: 'text', text: err.message || String(err) }], isError: true };
}

function foodEntries(combined) {
  return Array.from(combined.values()).filter((e) => e.entryType === 'food');
}

function toTryEntries(combined) {
  return Array.from(combined.values()).filter((e) => e.entryType === TOTRY_TYPE);
}

function categoryEntries(combined) {
  return Array.from(combined.values()).filter((e) => e.entryType === 'category');
}

/** uuid -> full "Parent / Child / Grandchild" path, root first. */
function categoryPath(uuid, combined) {
  const parts = [];
  let current = uuid;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const cat = combined.get(current);
    if (!cat || cat.entryType !== 'category') break;
    parts.unshift(cat.restaurantName);
    current = cat.ratingCategory;
  }
  return parts.join(' / ');
}

/**
 * Read a date or a full timestamp into epoch ms.
 * A bare YYYY-MM-DD still means local midnight, exactly as before; anything
 * else goes through Date, so ISO 8601 with a time (and optional timezone)
 * works — "2026-08-31T19:42", "2026-08-31T19:42:00Z", "2026-08-31 19:42".
 * Epoch ms passes straight through.
 */
export function parseDateTimeInput(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;

  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const ms = new Date(`${str}T00:00:00`).getTime();
    if (Number.isNaN(ms)) throw new Error(`Could not read "${str}" as a date.`);
    return ms;
  }

  const ms = new Date(str.replace(' ', 'T')).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(
      `Could not read "${str}" as a date or time. Use YYYY-MM-DD for a date, ` +
      'or an ISO 8601 timestamp like 2026-08-31T19:42:00 for an exact time.'
    );
  }
  return ms;
}

const DATE_INPUT_HELP =
  'YYYY-MM-DD for a date, or an ISO 8601 timestamp for an exact time ' +
  '(e.g. 2026-08-31T19:42:00, or ...Z for UTC). Times are stored to the millisecond.';

function summarizeEntry(entry, combined) {
  return {
    uuid: entry.uuid,
    restaurantName: entry.restaurantName,
    specifier: entry.specifier || undefined,
    location: entry.location || undefined,
    score: entry.score ?? null,
    category: entry.ratingCategory ? categoryPath(entry.ratingCategory, combined) : undefined,
    // dateRated stays YYYY-MM-DD because that's the format the date filters
    // take; ratedAt carries the exact stored time alongside it.
    dateRated: entry.dateRated ? new Date(entry.dateRated).toISOString().slice(0, 10) : undefined,
    ratedAt: entry.dateRated ? new Date(entry.dateRated).toISOString() : undefined,
    notes: entry.additionalInfo || undefined,
    coordinates: entry.coordinates || undefined,
    identicals: entry.identicals?.length ? entry.identicals : undefined,
  };
}

/**
 * Resolve a human-typed category to a uuid: a name ("Coffee"), or a path when
 * names repeat — the end of one is enough ("Sandwich > Chicken", "Main/Chicken").
 * Returns {uuid} or {error, candidates}.
 */
function resolveCategory(categoryName, combined) {
  const segments = categoryName.split(/\s*(?:>|\/)\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const matches = categoryEntries(combined).filter((c) => {
    const path = categoryPath(c.uuid, combined).split(' / ').map((s) => s.trim().toLowerCase());
    return segments.length > 0 && segments.every((seg, i) => path[path.length - segments.length + i] === seg);
  });
  if (matches.length === 1) return { uuid: matches[0].uuid };
  if (matches.length === 0) return { error: `No category named "${categoryName}" found.` };
  return {
    error: `Multiple categories are named "${categoryName}" — pass categoryUuid instead.`,
    candidates: matches.map((c) => ({ uuid: c.uuid, path: categoryPath(c.uuid, combined) })),
  };
}

/** Shared add-rating field resolution (category name/uuid, score snap, date). Returns {entryData} or {error}. */
function buildEntryData({ restaurantName, specifier, location, coordinates, score, category, categoryUuid, notes, dateRated }, combined) {
  let ratingCategory = categoryUuid || '';
  if (!ratingCategory && category) {
    const resolved = resolveCategory(category, combined);
    if (resolved.error) return { error: resolved };
    ratingCategory = resolved.uuid;
  }
  if (ratingCategory && !combined.has(ratingCategory)) {
    return { error: { error: `categoryUuid ${ratingCategory} does not exist.` } };
  }

  return {
    entryData: {
      restaurantName,
      specifier: specifier || '',
      location: location || '',
      coordinates: coordinates || '',
      score: String(roundToValidScore(score)),
      additionalInfo: notes || '',
      ratingCategory,
      categories: ratingCategory ? dataService.computeCategories(ratingCategory, combined) : [],
      dateRated: dateRated ? parseDateTimeInput(dateRated) : Date.now(),
    },
  };
}

const server = new McpServer({ name: 'crate', version: '1.0.0' });

server.registerTool(
  'list_categories',
  {
    title: 'List rating categories',
    description: 'List every category in the Crate food-rating tree, with its full path and current score. Use this to find a categoryUuid before adding or moving a rating.',
    inputSchema: {},
  },
  async () => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);
      const categories = categoryEntries(combined).map((c) => ({
        uuid: c.uuid,
        path: categoryPath(c.uuid, combined),
        score: c.score ?? null,
      })).sort((a, b) => a.path.localeCompare(b.path));
      return text(categories);
    } catch (err) {
      return errorResult(err);
    }
  }
);

const FILTER_FIELDS = ['any', 'restaurantName', 'specifier', 'location', 'score', 'additionalInfo', 'ratingCategory', 'dateRated', 'uuid'];
const FILTER_OPS = [
  'contains', 'equals', 'notContains', 'isEmpty', 'isNotEmpty',
  'dateOn', 'dateBefore', 'dateAfter',
  'ratingEquals', 'ratingNotEquals', 'ratingGreater', 'ratingGreaterOrEqual', 'ratingLess', 'ratingLessOrEqual',
];

const filterInput = {
  field: z.enum(FILTER_FIELDS),
  op: z.enum(FILTER_OPS),
  value: z.string().optional().default(''),
  caseSensitive: z.boolean().optional().default(false),
  useRegex: z.boolean().optional().default(false),
  connector: z.enum(['AND', 'OR']).optional().default('AND').describe('How this filter combines with the PREVIOUS one in the array (ignored on the first filter).'),
};

server.registerTool(
  'search_ratings',
  {
    title: 'Search food ratings',
    description: `Search Crate food entries — this calls the app's real filter engine (FilterBuilder.applyFilters), same fields/operators as the Filters panel in the app. Fields: ${FILTER_FIELDS.join(', ')}. Text ops (most fields): contains, equals, notContains, isEmpty, isNotEmpty. Date ops (field="dateRated"): dateOn, dateBefore, dateAfter, isEmpty, isNotEmpty — value is "YYYY-MM-DD". Rating ops (field="score"): ratingEquals, ratingNotEquals, ratingGreater, ratingGreaterOrEqual, ratingLess, ratingLessOrEqual, isEmpty, isNotEmpty — value is a number as a string, e.g. "7.5". Multiple filters combine left to right via each one's own "connector" (AND/OR) — same as the app's default un-edited logic; no parenthesized custom logic. Each result carries both "dateRated" (YYYY-MM-DD, the format these filters take) and "ratedAt" (full ISO 8601 timestamp) — read "ratedAt" when the exact time matters.`,
    inputSchema: {
      filters: z.array(z.object(filterInput)).min(1).max(20),
      limit: z.number().int().positive().max(200).default(25),
    },
  },
  async ({ filters, limit }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);

      const withIds = filters.map((f, i) => ({ id: i, ...f }));
      const results = applyFilters(foodEntries(combined), withIds, categoryEntries(combined));

      const total = results.length;
      const page = results.slice(0, limit).map((e) => summarizeEntry(e, combined));
      return text({ total, returned: page.length, entries: page });
    } catch (err) {
      return errorResult(err);
    }
  }
);

const ratingInput = {
  restaurantName: z.string().min(1),
  specifier: z.string().optional().describe('The specific food/dish name.'),
  location: z.string().optional(),
  coordinates: z.string().optional().describe('Where it was, as "lat, lon" (e.g. "39.73921, -104.99025"). The app records this from the device; location stays the name you would write.'),
  score: z.number().min(0).max(10),
  category: z.string().optional(),
  categoryUuid: z.string().optional(),
  notes: z.string().optional(),
  dateRated: z.string().optional().describe(`${DATE_INPUT_HELP} Defaults to now.`),
};

server.registerTool(
  'add_rating',
  {
    title: 'Add food rating(s)',
    description: `Add food/restaurant ratings to Crate — this is exactly dataService.addBulkRating from the app, same "groups" shape. Each inner array in "groups" is one identicals group: entries within a group get their "identicals" fields set to each other's uuids (use this for the same dish rated again — Rerate). Separate groups in the same call are NOT linked to each other (use this for different dishes — "add another item from this visit"), but every entry across every group in the call is still recorded together as one Bulk Adds entry. Pass a single group with a single entry for a normal, unlinked add. Score is 0-10 and snaps to the app's valid scale (${VALID_SCORES.join(', ')}). Provide either "category" (exact category name, must already exist) or "categoryUuid" (from list_categories) — omit both to leave uncategorized.`,
    inputSchema: {
      groups: z.array(z.array(z.object(ratingInput)).min(1).max(50)).min(1).max(50),
    },
  },
  async ({ groups }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);

      const resolvedGroups = groups.map((groupEntries, gi) =>
        groupEntries.map((e, i) => ({ gi, i, ...buildEntryData(e, combined) }))
      );
      const failed = resolvedGroups.flat().filter((b) => b.error);
      if (failed.length) {
        return errorResult(new Error(JSON.stringify({
          message: 'No entries were added — fix these and retry.',
          problems: failed.map((b) => ({ group: b.gi, index: b.i, ...b.error })),
        })));
      }

      const entryGroups = resolvedGroups.map((g) => g.map((b) => b.entryData));
      const { builtGroups } = await dataService.addBulkRating(fileIds, fileIds.settingsFileId, entryGroups);
      return text({ added: builtGroups.map((group) => group.map((e) => summarizeEntry(e, combined))) });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'update_rating',
  {
    title: 'Update a food rating',
    description: 'Update one or more fields on an existing Crate entry, identified by uuid (get it from search_ratings). Only the fields you pass are changed. This is dataService.modifyEntry from the app — a genuinely generic field setter. The named parameters below (restaurantName, score, category, etc.) are conveniences that resolve category names and snap scores; "identicals" is a plain field like any other, set as a raw replacement array (only changes this one entry\'s value, not the other side — call update_rating on each entry if you want them to agree). For anything not covered by the named parameters (e.g. "picture"), pass raw field/value pairs in "fields" — same as calling modifyEntry directly, no translation or validation applied.',
    inputSchema: {
      uuid: z.string().min(1),
      restaurantName: z.string().optional(),
      specifier: z.string().optional(),
      location: z.string().optional(),
      coordinates: z.string().optional().describe('Where it was, as "lat, lon". Pass "" to forget it.'),
      score: z.number().min(0).max(10).optional(),
      notes: z.string().optional(),
      category: z.string().optional(),
      categoryUuid: z.string().optional(),
      identicals: z.array(z.string()).optional().describe('Full replacement list of uuids this entry is identicals with. Pass [] to clear.'),
      dateRated: z.string().optional().describe(DATE_INPUT_HELP),
      fields: z.record(z.string(), z.any()).optional().describe('Raw field/value pairs passed straight to dataService.modifyEntry, for anything the named parameters above don\'t cover.'),
    },
  },
  async ({ uuid, restaurantName, specifier, location, coordinates, score, notes, category, categoryUuid, identicals, dateRated, fields }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);
      if (!combined.has(uuid)) return errorResult(new Error(`No entry with uuid ${uuid}`));

      const updates = { ...fields };
      if (restaurantName !== undefined) updates.restaurantName = restaurantName;
      if (specifier !== undefined) updates.specifier = specifier;
      if (location !== undefined) updates.location = location;
      if (coordinates !== undefined) updates.coordinates = coordinates;
      if (score !== undefined) updates.score = String(roundToValidScore(score));
      if (notes !== undefined) updates.additionalInfo = notes;
      if (identicals !== undefined) updates.identicals = identicals;
      if (dateRated !== undefined) updates.dateRated = parseDateTimeInput(dateRated);

      if (categoryUuid !== undefined) {
        if (categoryUuid && !combined.has(categoryUuid)) return errorResult(new Error(`categoryUuid ${categoryUuid} does not exist.`));
        updates.ratingCategory = categoryUuid;
      } else if (category !== undefined) {
        const resolved = resolveCategory(category, combined);
        if (resolved.error) return errorResult(new Error(JSON.stringify(resolved)));
        updates.ratingCategory = resolved.uuid;
      }

      if (Object.keys(updates).length === 0) return errorResult(new Error('No fields to update were provided.'));

      const { entry } = await dataService.modifyEntry(fileIds, uuid, updates);
      return text({ updated: summarizeEntry(entry, combined) });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'delete_rating',
  {
    title: 'Delete a food rating',
    description: 'Permanently delete a Crate entry by uuid. Destructive — confirm with the user before calling this, and pass confirm=true.',
    inputSchema: {
      uuid: z.string().min(1),
      confirm: z.boolean().describe('Must be true. Safety valve so this cannot fire accidentally.'),
    },
  },
  async ({ uuid, confirm }) => {
    if (!confirm) return errorResult(new Error('Refusing to delete: confirm must be true.'));
    try {
      const fileIds = await getFileIds();
      await dataService.deleteEntry(fileIds, uuid);
      return text({ deleted: uuid });
    } catch (err) {
      return errorResult(err);
    }
  }
);

function summarizeToTry(item, combined) {
  return {
    uuid: item.uuid,
    restaurantName: item.restaurantName || undefined,
    food: item.specifier || undefined,
    location: item.location || undefined,
    category: item.ratingCategory ? categoryPath(item.ratingCategory, combined) : undefined,
    tags: item.tags?.length ? item.tags : undefined,
    notes: item.additionalInfo || undefined,
    status: statusOf(item),
    triedRatings: item.triedRatings?.length ? item.triedRatings : undefined,
    addedAt: item.dateRated ? new Date(item.dateRated).toISOString() : undefined,
  };
}

server.registerTool(
  'list_to_try',
  {
    title: 'List To Try items',
    description: 'List items on the To Try tab — places and foods to get to. Filter by status, and/or by a case-insensitive substring matched against place/brand, food, location, category, tags and notes.',
    inputSchema: {
      status: z.enum(['open', 'tried', 'gone', 'all']).optional().default('all'),
      search: z.string().optional(),
      limit: z.number().int().positive().max(1000).default(200),
    },
  },
  async ({ status, search, limit }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);
      const needle = (search || '').trim().toLowerCase();
      const results = toTryEntries(combined)
        .filter((item) => status === 'all' || statusOf(item) === status)
        .map((item) => summarizeToTry(item, combined))
        .filter((s) => !needle || [s.restaurantName, s.food, s.location, s.category, s.notes, ...(s.tags || [])]
          .some((v) => String(v || '').toLowerCase().includes(needle)));
      return text({ total: results.length, returned: Math.min(limit, results.length), items: results.slice(0, limit) });
    } catch (err) {
      return errorResult(err);
    }
  }
);

const toTryInput = {
  restaurantName: z.string().optional().describe('The place, chain or brand ("Big Sky Burger", "Dutch Bros"). Leave out for a food with no particular place ("Elote").'),
  food: z.string().optional().describe('A specific food or dish ("challah french toast"). Leave out when the item is the whole place.'),
  location: z.string().optional().describe("Where it is, written like your ratings' locations (\"Denver\", \"Larimer, Denver\", \"CS\"). Leave out for chains and grocery items."),
  category: z.string().optional().describe('An existing category name, or the end of its path when names repeat ("Sandwich > Hamburger").'),
  categoryUuid: z.string().optional(),
  tags: z.array(z.string()).optional().describe("Free-form tags — who to go with, \"DoorDash\", \"Goldbelly\", a cuisine that isn't a category."),
  notes: z.string().optional().describe('Hours, who recommended it, links, what to order.'),
  status: z.enum(['open', 'tried', 'gone']).optional().default('open').describe("\"gone\" for things that can't be had anymore (limited time)."),
  dateAdded: z.string().optional().describe(`${DATE_INPUT_HELP} Defaults to now.`),
};

server.registerTool(
  'add_to_try',
  {
    title: 'Add To Try items',
    description: "Add places and foods to the To Try tab, many at once, in a single Drive write. Each item needs a restaurantName or a food (or both). Everything is checked before anything is written: if any item has a problem (e.g. an unknown category), nothing is added and the problems are listed. Items that look like one already on the list (same place and food, allowing a small typo) are skipped and reported unless allowDuplicates is true. Returns the number added and their uuids, not the items themselves — call list_to_try to see them. To change or remove an item afterwards, use update_rating / delete_rating with its uuid; status and tags go in update_rating's \"fields\" (e.g. {\"status\": \"tried\"}, {\"tags\": [\"DoorDash\"]}).",
    inputSchema: {
      items: z.array(z.object(toTryInput)).min(1).max(500),
      allowDuplicates: z.boolean().optional().default(false),
    },
  },
  async ({ items, allowDuplicates }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);

      const problems = [];
      const built = items.map((item, index) => {
        const restaurantName = (item.restaurantName || '').trim();
        const specifier = (item.food || '').trim();
        if (!restaurantName && !specifier) problems.push({ index, error: 'Needs a restaurantName or a food.' });
        let ratingCategory = item.categoryUuid || '';
        if (!ratingCategory && item.category) {
          const resolved = resolveCategory(item.category, combined);
          if (resolved.error) problems.push({ index, ...resolved });
          else ratingCategory = resolved.uuid;
        }
        if (ratingCategory && !combined.has(ratingCategory)) problems.push({ index, error: `categoryUuid ${ratingCategory} does not exist.` });
        return makeToTryItem({
          restaurantName,
          specifier,
          location: (item.location || '').trim(),
          ratingCategory,
          categories: ratingCategory && combined.has(ratingCategory) ? dataService.computeCategories(ratingCategory, combined) : [],
          additionalInfo: (item.notes || '').trim(),
          tags: [...new Set((item.tags || []).map((t) => t.trim()).filter(Boolean))],
          status: item.status === 'open' ? '' : item.status,
          dateRated: item.dateAdded ? parseDateTimeInput(item.dateAdded) : Date.now(),
        });
      });
      if (problems.length) {
        return errorResult(new Error(JSON.stringify({ message: 'Nothing was added — fix these and retry.', problems })));
      }

      // Against what's saved and against earlier items in this same call.
      const existing = toTryEntries(combined);
      const toAdd = [];
      const skipped = [];
      built.forEach((item, index) => {
        const match = allowDuplicates ? null : findSimilarItems([...existing, ...toAdd], item)[0];
        if (match) skipped.push({ index, restaurantName: item.restaurantName, food: item.specifier || undefined, alreadyOnList: summarizeToTry(match, combined) });
        else toAdd.push(item);
      });

      const { entries } = toAdd.length
        ? await dataService.addUnlinkedEntries(fileIds, toAdd)
        : { entries: [] };
      // Just the count and uuids: echoing hundreds of items back is bigger
      // than the call that made them.
      return text({
        added: entries.length,
        skipped,
        addedUuids: entries.map((e) => e.uuid),
      });
    } catch (err) {
      return errorResult(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
