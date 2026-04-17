import { v4 as uuidv4 } from 'uuid';
import * as driveService from './driveService';
import * as csvService from './csvService';
import {
  createAdditionChange,
  createModificationChange,
  createDeletionChange,
  isLatestChangeForField,
  computeCategories,
} from '../utils/changelogUtils';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYNC_TIMEOUT_MS = 30_000;

function parseFieldValue(fieldName, value) {
  switch (fieldName) {
    case 'score':
      return value !== '' && value != null ? value : null;
    case 'dateRated':
      return value !== '' && value != null ? parseInt(value, 10) : null;
    case 'identicals':
    case 'categories':
      return typeof value === 'string'
        ? value.split('|').filter(Boolean)
        : Array.isArray(value) ? value : [];
    default:
      return value;
  }
}

/**
 * Core retry loop: read Drive → apply → write with version check.
 * Returns { data: { combined, changelog }, ...extra } where extra comes from caller.
 */
async function applyChanges(fileId, changes, applyFn) {
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { content, etag } = await driveService.readFile(fileId);
    const data = csvService.parse(content);
    for (const change of changes) data.changelog.push(change);
    const extra = applyFn(data) ?? {};
    const result = await driveService.writeFile(fileId, csvService.generate(data), etag);
    if (result.ok) return { data, ...extra };
    if (result.status === 412) { await sleep(1000); continue; }
    throw new Error('Drive write failed unexpectedly.');
  }
  throw new Error('Sync failed after 30 seconds. Please try again.');
}

// ── Public API ────────────────────────────────────────────────────────────────

const ENTRY_DEFAULTS = {
  entryType: 'food',
  identicals: [],
  categories: [],
  ratingCategory: '',
  restaurantName: '',
  specifier: '',
  location: '',
  score: null,
  dateRated: null,
  additionalInfo: '',
  picture: '',
};

/**
 * Add one or more entries (multi-rating). When multiple are passed, they are
 * cross-linked via `identicals`. Ancestor `categories` are computed from
 * the live combined map inside the retry loop.
 * Returns { data, entries }.
 */
export async function addEntry(fileId, entryDataArray) {
  const raw = Array.isArray(entryDataArray) ? entryDataArray : [entryDataArray];
  const entries = raw.map((d) => ({ ...ENTRY_DEFAULTS, uuid: uuidv4(), dateRated: Date.now(), ...d }));

  // Cross-link identicals
  if (entries.length > 1) {
    const uuids = entries.map((e) => e.uuid);
    entries.forEach((e, i) => { e.identicals = uuids.filter((_, j) => j !== i); });
  }

  const changes = entries.map((e) => createAdditionChange(e));
  return applyChanges(fileId, changes, (data) => {
    for (const e of entries) {
      // Do NOT recompute categories here — use the pre-computed value from local
      // state. A newly created parent category may not be in Drive's combined map
      // yet (its own sync may still be in flight), which would cause
      // computeCategories to return []. Same pattern as importEntries.
      data.combined.set(e.uuid, e);
    }
    return { entries };
  });
}

/**
 * Add a category meta-entry. Takes a full categoryData object:
 *   { name, ratingCategory?, score?, dateRated?, additionalInfo?, uuid? }
 * Returns { data, entry }.
 */
export async function addCategory(fileId, categoryData) {
  const entry = {
    ...ENTRY_DEFAULTS,
    entryType: 'category',
    uuid: categoryData.uuid || uuidv4(),
    restaurantName: categoryData.name || '',
    ratingCategory: categoryData.ratingCategory || '',
    score: categoryData.score ?? null,
    dateRated: categoryData.dateRated ?? null,
    additionalInfo: categoryData.additionalInfo || '',
  };
  const change = createAdditionChange(entry);
  return applyChanges(fileId, [change], (data) => {
    entry.categories = computeCategories(entry.ratingCategory, data.combined);
    data.combined.set(entry.uuid, entry);
    return { entry };
  });
}

/**
 * Modify an entry. `updates` contains only the fields that actually changed
 * (diff computed in UI). Recomputes ancestor `categories` if ratingCategory changed.
 */
export async function modifyEntry(fileId, entryUuid, updates) {
  const now = Date.now();
  const changes = Object.entries(updates).map(([field, value]) =>
    createModificationChange(entryUuid, field, String(value ?? ''))
  );
  changes.forEach((c, i) => { c.dateOfChange = now + i; });

  return applyChanges(fileId, changes, (data) => {
    const entry = data.combined.get(entryUuid);
    if (!entry) return {};
    let updated = { ...entry };
    for (const change of changes) {
      if (isLatestChangeForField(data.changelog, change)) {
        updated = { ...updated, [change.fieldName]: parseFieldValue(change.fieldName, change.value) };
      }
    }
    // Recompute ancestor chain whenever ratingCategory changed
    if ('ratingCategory' in updates) {
      updated.categories = computeCategories(updated.ratingCategory, data.combined);
    }
    data.combined.set(entryUuid, updated);
    return {};
  });
}

export async function deleteEntry(fileId, entryUuid) {
  const change = createDeletionChange(entryUuid);
  return applyChanges(fileId, [change], (data) => {
    if (isLatestChangeForField(data.changelog, change)) data.combined.delete(entryUuid);
    return {};
  });
}

/**
 * Batch-import entries that already have UUIDs and pre-computed ancestor chains.
 * Skips entries whose UUID already exists in combined.
 */
export async function importEntries(fileId, entries, newCategories) {
  const allEntries = [...newCategories, ...entries];
  const changes = allEntries.map((e) => createAdditionChange(e, 'imported from CSV'));
  return applyChanges(fileId, changes, (data) => {
    for (const e of allEntries) {
      if (!data.combined.has(e.uuid)) {
        // Use pre-computed categories from importFromLegacyCsv — do NOT recompute
        // here because CSV order puts sub-categories before parents, so data.combined
        // won't have the parent yet and computeCategories would return [].
        data.combined.set(e.uuid, e);
      }
    }
    return {};
  });
}
