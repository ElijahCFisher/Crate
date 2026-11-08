import { v4 as uuidv4 } from 'uuid';
import * as driveService from './driveService';
import * as csvService from './csvService';
import * as settingsService from './settingsService';
import { createSheetStore } from './sheetStore';
import { DRIVE_FILE_NAME, DRIVE_CHANGELOG_FILE_NAME } from '../config';
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

// driveRequest is looked up per call, so a test that mocks driveService
// without it still loads this module.
const sheets = createSheetStore((url, options) => driveService.driveRequest(url, options));

function parseFieldValue(fieldName, value) {
  switch (fieldName) {
    case 'score':
      return value !== '' && value != null ? value : null;
    case 'dateRated':
      return value !== '' && value != null ? parseInt(value, 10) : null;
    case 'identicals':
    case 'categories':
    case 'tags':
    case 'triedRatings':
      return typeof value === 'string'
        ? value.split('|').filter(Boolean)
        : Array.isArray(value) ? value : [];
    case 'linkedFields':
      return typeof value === 'string' ? csvService.parseLinkedFields(value) : (value || {});
    default:
      return value;
  }
}

/**
 * Flatten an updates value into the changelog's single `Value` string column.
 * `linkedFields` is an object map, so it needs its own serializer — a plain
 * String() would write "[object Object]" into the log.
 */
export function serializeFieldValue(fieldName, value) {
  if (fieldName === 'linkedFields') return csvService.serializeLinkedFields(value);
  return Array.isArray(value) ? value.join('|') : String(value ?? '');
}

function entryFromAdditionChange(change) {
  return {
    ...ENTRY_DEFAULTS,
    uuid: change.entryUuid,
    entryType: change.entryType || 'food',
    identicals: change.identicals ?? [],
    categories: change.categories ?? [],
    ratingCategory: change.ratingCategory ?? '',
    restaurantName: change.restaurantName ?? '',
    specifier: change.specifier ?? '',
    location: change.location ?? '',
    score: change.score ?? null,
    dateRated: change.dateRated ?? null,
    additionalInfo: change.additionalInfo ?? '',
    picture: change.picture ?? '',
    linkedFields: change.linkedFields ?? {},
    status: change.status ?? '',
    tags: change.tags ?? [],
    triedRatings: change.triedRatings ?? [],
    coordinates: change.coordinates ?? '',
  };
}

/**
 * Core retry loop: read Drive → apply → write with version check.
 * Reads/writes combined and changelog files in parallel. With
 * `fileIds.backend === 'sheets'` the Google Sheets store does the same job
 * by appending and editing cells instead.
 * Returns { data: { combined, changelog }, ...extra } where extra comes from caller.
 */
async function applyChanges(fileIds, changes, applyFn) {
  if (fileIds.backend === 'sheets') return sheets.applyChanges(fileIds, changes, applyFn);
  const { combinedFileId, changelogFileId } = fileIds;
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [
      { content: combinedContent, etag: combinedEtag },
      { content: changelogContent, etag: changelogEtag },
    ] = await Promise.all([
      driveService.readFile(combinedFileId),
      driveService.readFile(changelogFileId),
    ]);
    const data = {
      combined: csvService.parseCombined(combinedContent),
      changelog: csvService.parseChangelog(changelogContent),
    };
    for (const change of changes) data.changelog.push(change);
    const extra = applyFn(data) ?? {};
    const [combinedResult, changelogResult] = await Promise.all([
      driveService.writeFile(combinedFileId, csvService.generateCombined(data), combinedEtag),
      driveService.writeFile(changelogFileId, csvService.generateChangelog(data), changelogEtag),
    ]);
    if (combinedResult.ok && changelogResult.ok) return { data, ...extra };
    if (combinedResult.status === 412 || changelogResult.status === 412) { await sleep(1000); continue; }
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
  linkedFields: {},
  status: '',
  tags: [],
  triedRatings: [],
  coordinates: '',
};

/**
 * Add one or more entries (multi-rating). When multiple are passed, they are
 * cross-linked via `identicals`. Ancestor `categories` are computed from
 * the live combined map inside the retry loop.
 * Returns { data, entries }.
 */
export async function addEntry(fileIds, entryDataArray) {
  const raw = Array.isArray(entryDataArray) ? entryDataArray : [entryDataArray];
  const entries = raw.map((d) => ({ ...ENTRY_DEFAULTS, uuid: uuidv4(), dateRated: Date.now(), ...d }));

  // Cross-link identicals
  if (entries.length > 1) {
    const uuids = entries.map((e) => e.uuid);
    entries.forEach((e, i) => { e.identicals = uuids.filter((_, j) => j !== i); });
  }

  const changes = entries.map((e) => createAdditionChange(e));
  return applyChanges(fileIds, changes, (data) => {
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
export async function addCategory(fileIds, categoryData) {
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
  return applyChanges(fileIds, [change], (data) => {
    entry.categories = computeCategories(entry.ratingCategory, data.combined);
    data.combined.set(entry.uuid, entry);
    return { entry };
  });
}

/**
 * Modify an entry. `updates` contains only the fields that actually changed
 * (diff computed in UI). Recomputes ancestor `categories` if ratingCategory changed.
 */
export async function modifyEntry(fileIds, entryUuid, updates) {
  const now = Date.now();
  const changes = Object.entries(updates).map(([field, value]) =>
    createModificationChange(entryUuid, field, serializeFieldValue(field, value))
  );
  changes.forEach((c, i) => { c.dateOfChange = now + i; });

  return applyChanges(fileIds, changes, (data) => {
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

/**
 * Modify many entries in one write. `edits` is [{ uuid, updates }], the same
 * shape modifyEntry takes per entry.
 */
export async function modifyEntries(fileIds, edits) {
  const now = Date.now();
  const changes = [];
  for (const { uuid, updates } of edits) {
    for (const [field, value] of Object.entries(updates)) {
      const change = createModificationChange(uuid, field, serializeFieldValue(field, value));
      change.dateOfChange = now + changes.length;
      changes.push(change);
    }
  }

  return applyChanges(fileIds, changes, (data) => {
    const moved = [];
    for (const change of changes) {
      const entry = data.combined.get(change.entryUuid);
      if (!entry || !isLatestChangeForField(data.changelog, change)) continue;
      data.combined.set(change.entryUuid, {
        ...entry,
        [change.fieldName]: parseFieldValue(change.fieldName, change.value),
      });
      if (change.fieldName === 'ratingCategory') moved.push(change.entryUuid);
    }
    for (const uuid of moved) {
      const entry = data.combined.get(uuid);
      data.combined.set(uuid, { ...entry, categories: computeCategories(entry.ratingCategory, data.combined) });
    }
    return {};
  });
}

export async function deleteEntry(fileIds, entryUuid) {
  const change = createDeletionChange(entryUuid);
  return applyChanges(fileIds, [change], (data) => {
    if (isLatestChangeForField(data.changelog, change)) data.combined.delete(entryUuid);
    return {};
  });
}

/**
 * Add entries and cross-link them with existing entries — all in one Drive write.
 * `entries` must already have UUIDs and internal identicals set (cross-links
 * within the new group). `existingUuids` are existing entries to link bidirectionally.
 */
export async function addEntriesWithLinks(fileIds, entries, existingUuids = []) {
  const addChanges = entries.map((e) => createAdditionChange(e));
  const now = Date.now();
  let changeIdx = addChanges.length;
  const newUuids = entries.map((e) => e.uuid);

  return applyChanges(fileIds, addChanges, (data) => {
    for (const e of entries) data.combined.set(e.uuid, e);
    if (existingUuids.length === 0) return { entries };

    for (const existingUuid of existingUuids) {
      const existing = data.combined.get(existingUuid);
      if (!existing) continue;
      const updated = [...new Set([...(existing.identicals || []), ...newUuids])];
      const change = createModificationChange(existingUuid, 'identicals', updated.join('|'));
      change.dateOfChange = now + changeIdx++;
      data.changelog.push(change);
      data.combined.set(existingUuid, { ...existing, identicals: updated });
    }

    for (const entry of entries) {
      const e = data.combined.get(entry.uuid);
      if (!e) continue;
      const updated = [...new Set([...(e.identicals || []), ...existingUuids])];
      const change = createModificationChange(entry.uuid, 'identicals', updated.join('|'));
      change.dateOfChange = now + changeIdx++;
      data.changelog.push(change);
      data.combined.set(entry.uuid, { ...e, identicals: updated });
    }

    return { entries };
  });
}

/**
 * Write a flat list of pre-built entries in one atomic applyChanges pass.
 * Callers are responsible for cross-linking identicals before calling this.
 */
export async function addEntries(fileIds, entries) {
  const normalized = entries.map((d) => ({ ...ENTRY_DEFAULTS, ...d }));
  const changes = normalized.map((e) => createAdditionChange(e));
  return applyChanges(fileIds, changes, (data) => {
    for (const e of normalized) data.combined.set(e.uuid, e);
    return {};
  });
}

/**
 * Add multiple entry groups (each group's entries cross-linked via identicals,
 * same as addEntry does for an array) in one Drive write, and record the
 * combined uuid list in the settings file's bulkAdds list — the same thing
 * that happens when you use Rerate / "add another item from this visit" in
 * the app and submit, making the group show up in the Bulk Adds tab.
 *
 * `groups`: Array<Array<partial entry data>> — same convention as addEntry,
 * uuid/dateRated are defaulted here if the caller didn't already set them.
 * Returns { builtGroups, bulkAdds } — bulkAdds is null when nothing new was
 * recorded (a single 1-entry total doesn't count as a bulk add).
 */
export async function addBulkRating(fileIds, settingsFileId, groups) {
  const builtGroups = groups.map((groupData) => {
    const entries = groupData.map((d) => ({ ...ENTRY_DEFAULTS, uuid: uuidv4(), dateRated: Date.now(), ...d }));
    if (entries.length > 1) {
      const uuids = entries.map((e) => e.uuid);
      entries.forEach((e, i) => { e.identicals = uuids.filter((_, j) => j !== i); });
    }
    return entries;
  });
  const allEntries = builtGroups.flat();

  const changes = allEntries.map((e) => createAdditionChange(e));
  await applyChanges(fileIds, changes, (data) => {
    for (const e of allEntries) data.combined.set(e.uuid, e);
    return {};
  });

  let bulkAdds = null;
  const allUuids = allEntries.map((e) => e.uuid);
  if (allUuids.length > 1) {
    const settings = await settingsService.readSettings(settingsFileId);
    bulkAdds = [allUuids, ...(settings.bulkAdds || [])];
    await settingsService.writeSettings(settingsFileId, { ...settings, bulkAdds });
  }

  return { builtGroups, bulkAdds };
}

/**
 * Batch-import entries that already have UUIDs and pre-computed ancestor chains.
 * Skips entries whose UUID already exists in combined.
 */
export async function importEntries(fileIds, entries, newCategories) {
  const allEntries = [...newCategories, ...entries];
  const changes = allEntries.map((e) => createAdditionChange(e, 'imported from CSV'));
  return applyChanges(fileIds, changes, (data) => {
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

/**
 * Batch-update the `score` field on multiple entries in a single atomic Drive write.
 * `updates` is a Map<uuid, newScore> (or any iterable of [uuid, score] pairs).
 * All changes share the given changeMethod so the audit trail is clear.
 */
export async function batchModifyScores(fileIds, updates, changeMethod) {
  const now = Date.now();
  const changes = [];
  let idx = 0;
  for (const [uuid, newScore] of updates) {
    const change = createModificationChange(
      uuid, 'score',
      newScore != null ? String(newScore) : '',
      changeMethod,
    );
    change.dateOfChange = now + idx++;
    changes.push(change);
  }

  return applyChanges(fileIds, changes, (data) => {
    for (const change of changes) {
      const entry = data.combined.get(change.entryUuid);
      if (!entry) continue;
      if (isLatestChangeForField(data.changelog, change)) {
        data.combined.set(change.entryUuid, {
          ...entry,
          score: change.value !== '' ? change.value : null,
        });
      }
    }
    return {};
  });
}

/**
 * Replay a changelog-only CSV against the current data set.
 * Existing change UUIDs are ignored so importing the same partial log is
 * idempotent.
 */
export async function importChangelog(fileIds, incomingChanges) {
  return applyChanges(fileIds, [], (data) => {
    const existingChangeUuids = new Set(data.changelog.map((change) => change.changeUuid));
    const changes = incomingChanges.filter((change) =>
      change.changeUuid && change.entryUuid && !existingChangeUuids.has(change.changeUuid)
    );

    data.changelog.push(...changes);

    for (const change of changes) {
      if (change.changeType === 'addition') {
        if (!data.combined.has(change.entryUuid)) {
          const entry = entryFromAdditionChange(change);
          if (entry.categories.length === 0 && entry.ratingCategory) {
            entry.categories = computeCategories(entry.ratingCategory, data.combined);
          }
          data.combined.set(entry.uuid, entry);
        }
      } else if (change.changeType === 'modification') {
        const entry = data.combined.get(change.entryUuid);
        if (entry && isLatestChangeForField(data.changelog, change)) {
          const updated = {
            ...entry,
            [change.fieldName]: parseFieldValue(change.fieldName, change.value),
          };
          if (change.fieldName === 'ratingCategory') {
            updated.categories = computeCategories(updated.ratingCategory, data.combined);
          }
          data.combined.set(change.entryUuid, updated);
        }
      } else if (change.changeType === 'deletion') {
        if (isLatestChangeForField(data.changelog, change)) data.combined.delete(change.entryUuid);
      }
    }

    return { importedChanges: changes.length };
  });
}

// ── Where the data lives ──────────────────────────────────────────────────────

/**
 * The file ids every other call here takes: the Google Sheets copy (made from
 * the CSV files the first time), or the CSV files themselves if that copy
 * can't be made yet. Returns { backend, combinedFileId, changelogFileId, … }.
 */
export async function openStorage(folderId) {
  const storage = await sheets.resolveStorage(folderId, {
    data: DRIVE_FILE_NAME,
    changelog: DRIVE_CHANGELOG_FILE_NAME,
  });
  if (storage) return storage;
  const [combinedFileId, changelogFileId] = await Promise.all([
    driveService.findOrCreateFile(folderId, DRIVE_FILE_NAME),
    driveService.findOrCreateFile(folderId, DRIVE_CHANGELOG_FILE_NAME),
  ]);
  return { backend: 'csv', combinedFileId, changelogFileId };
}

/** Everything in the sheets, as { combined, changelog }. */
export async function readData(fileIds) {
  return (await sheets.readData(fileIds)).data;
}

/**
 * Overwrite the stored data with `data` wholesale. On the CSVs, `etags` guard
 * the write the same way every other write is guarded; returns whether it
 * went through.
 */
export async function replaceData(fileIds, data, etags = {}) {
  if (fileIds.backend === 'sheets') {
    await sheets.replaceData(fileIds, data);
    return true;
  }
  const [combinedResult, changelogResult] = await Promise.all([
    driveService.writeFile(fileIds.combinedFileId, csvService.generateCombined(data), etags.combined),
    driveService.writeFile(fileIds.changelogFileId, csvService.generateChangelog(data), etags.changelog),
  ]);
  return combinedResult.ok && changelogResult.ok;
}

/**
 * Bring into the sheets anything written to the changelog CSV since it was
 * copied — by a device or MCP server still on the old files. Replays like a
 * changelog import, so it's safe to repeat. Returns that import's result, or
 * null when there was nothing to bring over (or it couldn't be checked: the
 * sheets are still right, just possibly missing those late changes until the
 * next load).
 */
export async function catchUpFromCsv(storage, folderId) {
  try {
    const pending = await sheets.csvChangesSince(storage, folderId, DRIVE_CHANGELOG_FILE_NAME);
    if (!pending) return null;
    const result = await importChangelog(storage, pending.changes);
    await sheets.markCsvRead(storage, pending.version);
    return result;
  } catch (err) {
    console.warn('Could not check the old changelog CSV for late changes:', err);
    return null;
  }
}

/**
 * A followed friend's ratings. Prefers their Sheet when they've moved to one
 * and shared it, since the CSV they first shared stops changing then.
 */
export async function readFriendRatings({ fileId, email }) {
  const sheetId = email ? await sheets.findSharedDataSheet(email) : null;
  if (sheetId) return sheets.readCombined(sheetId);
  if (await sheets.isSpreadsheet(fileId)) return sheets.readCombined(fileId);
  const { content } = await driveService.readFile(fileId);
  return csvService.parseCombined(content);
}
