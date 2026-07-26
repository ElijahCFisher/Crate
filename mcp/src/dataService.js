/**
 * Trimmed fork of src/services/dataService.js for the Node MCP server —
 * only the mutation functions ratings tools need (add/modify/delete).
 * csvService and changelogUtils are pure JS and imported directly from the
 * real app source so parsing/serialization never drifts from the web app.
 */
import { v4 as uuidv4 } from 'uuid';
import * as driveService from './driveService.js';
import * as csvService from '../../src/services/csvService.js';
import {
  createAdditionChange,
  createModificationChange,
  createDeletionChange,
  isLatestChangeForField,
  computeCategories,
} from '../../src/utils/changelogUtils.js';

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

async function applyChanges({ combinedFileId, changelogFileId }, changes, applyFn) {
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

const CHANGE_METHOD = 'MCP tool';

/** Read the current combined dataset (no changelog replay needed for reads). */
export async function readCombined(fileIds) {
  const { content } = await driveService.readFile(fileIds.combinedFileId);
  return csvService.parseCombined(content);
}

export async function addEntry(fileIds, entryData) {
  const entry = { ...ENTRY_DEFAULTS, uuid: uuidv4(), dateRated: Date.now(), ...entryData };
  const change = createAdditionChange(entry, CHANGE_METHOD);
  return applyChanges(fileIds, [change], (data) => {
    data.combined.set(entry.uuid, entry);
    return { entry };
  });
}

export async function modifyEntry(fileIds, entryUuid, updates) {
  const now = Date.now();
  const changes = Object.entries(updates).map(([field, value]) =>
    createModificationChange(entryUuid, field, Array.isArray(value) ? value.join('|') : String(value ?? ''), CHANGE_METHOD)
  );
  changes.forEach((c, i) => { c.dateOfChange = now + i; });

  return applyChanges(fileIds, changes, (data) => {
    const entry = data.combined.get(entryUuid);
    if (!entry) throw new Error(`No entry with uuid ${entryUuid}`);
    let updated = { ...entry };
    for (const change of changes) {
      if (isLatestChangeForField(data.changelog, change)) {
        updated = { ...updated, [change.fieldName]: parseFieldValue(change.fieldName, change.value) };
      }
    }
    if ('ratingCategory' in updates) {
      updated.categories = computeCategories(updated.ratingCategory, data.combined);
    }
    data.combined.set(entryUuid, updated);
    return { entry: updated };
  });
}

export async function deleteEntry(fileIds, entryUuid) {
  const change = createDeletionChange(entryUuid, CHANGE_METHOD);
  return applyChanges(fileIds, [change], (data) => {
    if (!data.combined.has(entryUuid)) throw new Error(`No entry with uuid ${entryUuid}`);
    if (isLatestChangeForField(data.changelog, change)) data.combined.delete(entryUuid);
    return {};
  });
}

export { computeCategories };
