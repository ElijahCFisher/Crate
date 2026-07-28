import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import * as driveService from './driveService.js';
import * as dataService from './dataService.js';
import * as settingsService from './settingsService.js';
import { DRIVE_FOLDER_NAME, DRIVE_FILE_NAME, DRIVE_CHANGELOG_FILE_NAME } from './config.js';
import { roundToValidScore, VALID_SCORES } from '../../src/utils/scaleUtils.js';
import { applyFilters } from '../../src/utils/filterLogic.js';

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

function summarizeEntry(entry, combined) {
  return {
    uuid: entry.uuid,
    restaurantName: entry.restaurantName,
    specifier: entry.specifier || undefined,
    location: entry.location || undefined,
    score: entry.score ?? null,
    category: entry.ratingCategory ? categoryPath(entry.ratingCategory, combined) : undefined,
    dateRated: entry.dateRated ? new Date(entry.dateRated).toISOString().slice(0, 10) : undefined,
    notes: entry.additionalInfo || undefined,
    identicals: entry.identicals?.length ? entry.identicals : undefined,
  };
}

/** Resolve a human-typed category name to a uuid. Returns {uuid} or {error, candidates}. */
function resolveCategory(categoryName, combined) {
  const needle = categoryName.trim().toLowerCase();
  const matches = categoryEntries(combined).filter(
    (c) => c.restaurantName.trim().toLowerCase() === needle
  );
  if (matches.length === 1) return { uuid: matches[0].uuid };
  if (matches.length === 0) return { error: `No category named "${categoryName}" found.` };
  return {
    error: `Multiple categories are named "${categoryName}" — pass categoryUuid instead.`,
    candidates: matches.map((c) => ({ uuid: c.uuid, path: categoryPath(c.uuid, combined) })),
  };
}

/** Shared add-rating field resolution (category name/uuid, score snap, date). Returns {entryData} or {error}. */
function buildEntryData({ restaurantName, specifier, location, score, category, categoryUuid, notes, dateRated }, combined) {
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
      score: String(roundToValidScore(score)),
      additionalInfo: notes || '',
      ratingCategory,
      categories: ratingCategory ? dataService.computeCategories(ratingCategory, combined) : [],
      dateRated: dateRated ? new Date(dateRated + 'T00:00:00').getTime() : Date.now(),
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
    description: `Search Crate food entries — this calls the app's real filter engine (FilterBuilder.applyFilters), same fields/operators as the Filters panel in the app. Fields: ${FILTER_FIELDS.join(', ')}. Text ops (most fields): contains, equals, notContains, isEmpty, isNotEmpty. Date ops (field="dateRated"): dateOn, dateBefore, dateAfter, isEmpty, isNotEmpty — value is "YYYY-MM-DD". Rating ops (field="score"): ratingEquals, ratingNotEquals, ratingGreater, ratingGreaterOrEqual, ratingLess, ratingLessOrEqual, isEmpty, isNotEmpty — value is a number as a string, e.g. "7.5". Multiple filters combine left to right via each one's own "connector" (AND/OR) — same as the app's default un-edited logic; no parenthesized custom logic.`,
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
  score: z.number().min(0).max(10),
  category: z.string().optional(),
  categoryUuid: z.string().optional(),
  notes: z.string().optional(),
  dateRated: z.string().optional().describe('YYYY-MM-DD; defaults to today.'),
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
      score: z.number().min(0).max(10).optional(),
      notes: z.string().optional(),
      category: z.string().optional(),
      categoryUuid: z.string().optional(),
      identicals: z.array(z.string()).optional().describe('Full replacement list of uuids this entry is identicals with. Pass [] to clear.'),
      dateRated: z.string().optional().describe('YYYY-MM-DD.'),
      fields: z.record(z.string(), z.any()).optional().describe('Raw field/value pairs passed straight to dataService.modifyEntry, for anything the named parameters above don\'t cover.'),
    },
  },
  async ({ uuid, restaurantName, specifier, location, score, notes, category, categoryUuid, identicals, dateRated, fields }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);
      if (!combined.has(uuid)) return errorResult(new Error(`No entry with uuid ${uuid}`));

      const updates = { ...fields };
      if (restaurantName !== undefined) updates.restaurantName = restaurantName;
      if (specifier !== undefined) updates.specifier = specifier;
      if (location !== undefined) updates.location = location;
      if (score !== undefined) updates.score = String(roundToValidScore(score));
      if (notes !== undefined) updates.additionalInfo = notes;
      if (identicals !== undefined) updates.identicals = identicals;
      if (dateRated !== undefined) updates.dateRated = new Date(dateRated + 'T00:00:00').getTime();

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

const transport = new StdioServerTransport();
await server.connect(transport);
