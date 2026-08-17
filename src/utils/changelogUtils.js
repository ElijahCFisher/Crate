import { v4 as uuidv4 } from 'uuid';

const DEFAULT_METHOD = 'manual, through the app';

export function createAdditionChange(entry, changeMethod = DEFAULT_METHOD) {
  return {
    changeUuid: uuidv4(),
    entryUuid: entry.uuid,
    changeType: 'addition',
    fieldName: '',
    value: '',
    identicals: entry.identicals ?? [],
    categories: entry.categories ?? [],
    ratingCategory: entry.ratingCategory ?? '',
    restaurantName: entry.restaurantName ?? '',
    specifier: entry.specifier ?? '',
    location: entry.location ?? '',
    score: entry.score ?? null,
    dateRated: entry.dateRated ?? null,
    additionalInfo: entry.additionalInfo ?? '',
    picture: entry.picture ?? '',
    entryType: entry.entryType ?? 'food',
    linkedFields: entry.linkedFields ?? {},
    changeMethod,
    dateOfChange: Date.now(),
  };
}

export function createModificationChange(entryUuid, fieldName, value, changeMethod = DEFAULT_METHOD) {
  return {
    changeUuid: uuidv4(),
    entryUuid,
    changeType: 'modification',
    fieldName,
    value: String(value ?? ''),
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
    entryType: '',
    linkedFields: {},
    changeMethod,
    dateOfChange: Date.now(),
  };
}

export function createDeletionChange(entryUuid, changeMethod = DEFAULT_METHOD) {
  return {
    changeUuid: uuidv4(),
    entryUuid,
    changeType: 'deletion',
    fieldName: '',
    value: '',
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
    entryType: '',
    linkedFields: {},
    changeMethod,
    dateOfChange: Date.now(),
  };
}

export function isLatestChangeForField(changelog, change) {
  const { entryUuid, changeType, fieldName, dateOfChange } = change;
  if (changeType === 'modification') {
    return !changelog.some(
      (c) => c.entryUuid === entryUuid && c.changeType === 'modification' &&
             c.fieldName === fieldName && c.dateOfChange > dateOfChange
    );
  }
  if (changeType === 'deletion') {
    return !changelog.some(
      (c) => c.entryUuid === entryUuid && c.changeType === 'deletion' && c.dateOfChange > dateOfChange
    );
  }
  return true;
}

/**
 * Traverse the rating-category hierarchy and return all ancestor UUIDs
 * starting from (and including) ratingCategoryUuid up to the root.
 * Used to populate the `categories` cache field on entries.
 */
export function computeCategories(ratingCategoryUuid, combined) {
  const ancestors = [];
  let current = ratingCategoryUuid;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const cat = combined.get(current);
    if (!cat || cat.entryType !== 'category') break;
    ancestors.push(current);
    current = cat.ratingCategory;
  }
  return ancestors;
}
