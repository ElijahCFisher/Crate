import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import * as driveService from './driveService.js';
import * as dataService from './dataService.js';
import { DRIVE_FOLDER_NAME, DRIVE_FILE_NAME, DRIVE_CHANGELOG_FILE_NAME } from './config.js';
import { roundToValidScore, VALID_SCORES } from '../../src/utils/scaleUtils.js';

// ── Drive file-id resolution (cached per process) ───────────────────────────

let fileIdsPromise = null;
function getFileIds() {
  if (!fileIdsPromise) {
    fileIdsPromise = (async () => {
      const folderId = await driveService.findOrCreateFolder(DRIVE_FOLDER_NAME);
      const [combinedFileId, changelogFileId] = await Promise.all([
        driveService.findOrCreateFile(folderId, DRIVE_FILE_NAME),
        driveService.findOrCreateFile(folderId, DRIVE_CHANGELOG_FILE_NAME),
      ]);
      return { combinedFileId, changelogFileId };
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

server.registerTool(
  'search_ratings',
  {
    title: 'Search food ratings',
    description: 'Search Crate food entries by free-text (restaurant/food/location/notes), category name, and/or score range. Returns up to `limit` matches.',
    inputSchema: {
      query: z.string().optional().describe('Substring match against restaurant name, specifier, location, and notes (case-insensitive).'),
      category: z.string().optional().describe('Substring match against the category path, e.g. "Pizza" or "Fast Food / Burgers".'),
      minScore: z.number().min(0).max(10).optional(),
      maxScore: z.number().min(0).max(10).optional(),
      limit: z.number().int().positive().max(200).default(25),
    },
  },
  async ({ query, category, minScore, maxScore, limit }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);
      const q = query?.trim().toLowerCase();
      const catQ = category?.trim().toLowerCase();

      let results = foodEntries(combined);
      if (q) {
        results = results.filter((e) =>
          [e.restaurantName, e.specifier, e.location, e.additionalInfo]
            .join(' ').toLowerCase().includes(q)
        );
      }
      if (catQ) {
        results = results.filter((e) => categoryPath(e.ratingCategory, combined).toLowerCase().includes(catQ));
      }
      if (minScore != null) {
        results = results.filter((e) => e.score != null && parseFloat(e.score) >= minScore);
      }
      if (maxScore != null) {
        results = results.filter((e) => e.score != null && parseFloat(e.score) <= maxScore);
      }

      const total = results.length;
      const page = results.slice(0, limit).map((e) => summarizeEntry(e, combined));
      return text({ total, returned: page.length, entries: page });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'add_rating',
  {
    title: 'Add a food rating',
    description: `Add a new food/restaurant rating to Crate. Score is 0-10 and snaps to the app's valid scale (${VALID_SCORES.join(', ')}). Provide either "category" (exact category name, must already exist) or "categoryUuid" (from list_categories) — omit both to leave it uncategorized.`,
    inputSchema: {
      restaurantName: z.string().min(1),
      specifier: z.string().optional().describe('The specific food/dish name.'),
      location: z.string().optional(),
      score: z.number().min(0).max(10),
      category: z.string().optional(),
      categoryUuid: z.string().optional(),
      notes: z.string().optional(),
      dateRated: z.string().optional().describe('YYYY-MM-DD; defaults to today.'),
    },
  },
  async ({ restaurantName, specifier, location, score, category, categoryUuid, notes, dateRated }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);

      let ratingCategory = categoryUuid || '';
      if (!ratingCategory && category) {
        const resolved = resolveCategory(category, combined);
        if (resolved.error) return errorResult(new Error(JSON.stringify(resolved)));
        ratingCategory = resolved.uuid;
      }
      if (ratingCategory && !combined.has(ratingCategory)) {
        return errorResult(new Error(`categoryUuid ${ratingCategory} does not exist.`));
      }

      const entryData = {
        restaurantName,
        specifier: specifier || '',
        location: location || '',
        score: String(roundToValidScore(score)),
        additionalInfo: notes || '',
        ratingCategory,
        categories: ratingCategory ? dataService.computeCategories(ratingCategory, combined) : [],
        dateRated: dateRated ? new Date(dateRated + 'T00:00:00').getTime() : Date.now(),
      };

      const { entry } = await dataService.addEntry(fileIds, entryData);
      return text({ added: summarizeEntry(entry, combined) });
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  'update_rating',
  {
    title: 'Update a food rating',
    description: 'Update one or more fields on an existing Crate entry, identified by uuid (get it from search_ratings). Only the fields you pass are changed.',
    inputSchema: {
      uuid: z.string().min(1),
      restaurantName: z.string().optional(),
      specifier: z.string().optional(),
      location: z.string().optional(),
      score: z.number().min(0).max(10).optional(),
      notes: z.string().optional(),
      category: z.string().optional(),
      categoryUuid: z.string().optional(),
    },
  },
  async ({ uuid, restaurantName, specifier, location, score, notes, category, categoryUuid }) => {
    try {
      const fileIds = await getFileIds();
      const combined = await dataService.readCombined(fileIds);
      if (!combined.has(uuid)) return errorResult(new Error(`No entry with uuid ${uuid}`));

      const updates = {};
      if (restaurantName !== undefined) updates.restaurantName = restaurantName;
      if (specifier !== undefined) updates.specifier = specifier;
      if (location !== undefined) updates.location = location;
      if (score !== undefined) updates.score = String(roundToValidScore(score));
      if (notes !== undefined) updates.additionalInfo = notes;

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
