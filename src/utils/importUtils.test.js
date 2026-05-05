import { describe, it, expect } from 'vitest';
import { detectImportFormat, importFromLegacyCsv } from './importUtils';

// ── detectImportFormat ────────────────────────────────────────────────────────

describe('detectImportFormat', () => {
  it('detects app format by SECTION,COMBINED first line', () => {
    expect(detectImportFormat('SECTION,COMBINED\nrest...')).toBe('app');
  });

  it('detects changelog format by SECTION,CHANGELOG first line', () => {
    expect(detectImportFormat('SECTION,CHANGELOG\nrest...')).toBe('changelog');
  });

  it('detects changelog format by changelog header row', () => {
    const header = 'Entry UUID,Change UUID,Change Type,Field Name,Value,rest...';
    expect(detectImportFormat(header)).toBe('changelog');
  });

  it('returns legacy for any other format', () => {
    expect(detectImportFormat('UUID,Categories,Rating Category,Restaurant Names,Specifier')).toBe('legacy');
  });

  it('returns legacy for empty string', () => {
    expect(detectImportFormat('')).toBe('legacy');
  });

  it('returns legacy for null', () => {
    expect(detectImportFormat(null)).toBe('legacy');
  });

  it('trims whitespace from first line before comparing', () => {
    expect(detectImportFormat('  SECTION,COMBINED  \ndata')).toBe('app');
  });
});

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeCatRow(overrides = {}) {
  return {
    UUID: 'cat-uuid-1',
    'Category UUID': '',
    'Brand Name': '',
    Specifier: 'Fast Food',
    Location: '',
    Score: '',
    'Date Rated': '',
    'Additional Information': '',
    Picture: '',
    'Entry Type': 'category',
    ...overrides,
  };
}

function makeFoodRow(overrides = {}) {
  return {
    UUID: 'food-uuid-1',
    'Category UUID': 'cat-uuid-1',
    'Brand Name': 'McDonalds',
    Specifier: 'Big Mac',
    Location: 'NYC',
    Score: '8',
    'Date Rated': '6/26/21',
    'Additional Information': 'tasty',
    Picture: '',
    ...overrides,
  };
}

function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(',')),
  ];
  return lines.join('\n');
}

// ── importFromLegacyCsv — new schema (Category UUID column present) ───────────

describe('importFromLegacyCsv — new schema', () => {
  it('returns empty result for empty CSV', () => {
    const result = importFromLegacyCsv('', new Map());
    expect(result.entries).toEqual([]);
    expect(result.newCategories).toEqual([]);
  });

  it('parses a category row', () => {
    const csv = rowsToCsv([makeCatRow()]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories.length).toBe(1);
    expect(newCategories[0].uuid).toBe('cat-uuid-1');
    expect(newCategories[0].entryType).toBe('category');
    expect(newCategories[0].restaurantName).toBe('Fast Food');
  });

  it('parses a food row', () => {
    const existingCat = new Map([
      ['cat-uuid-1', { entryType: 'category', restaurantName: 'Fast Food', ratingCategory: '' }],
    ]);
    const csv = rowsToCsv([makeFoodRow()]);
    const { entries } = importFromLegacyCsv(csv, existingCat);
    expect(entries.length).toBe(1);
    expect(entries[0].uuid).toBe('food-uuid-1');
    expect(entries[0].entryType).toBe('food');
    expect(entries[0].restaurantName).toBe('McDonalds');
    expect(entries[0].specifier).toBe('Big Mac');
    expect(entries[0].ratingCategory).toBe('cat-uuid-1');
    expect(entries[0].score).toBe('8');
    expect(entries[0].location).toBe('NYC');
    expect(entries[0].additionalInfo).toBe('tasty');
  });

  it('parses legacy date field on food entry', () => {
    const existingCat = new Map([
      ['cat-uuid-1', { entryType: 'category', restaurantName: 'Fast Food', ratingCategory: '' }],
    ]);
    const csv = rowsToCsv([makeFoodRow({ 'Date Rated': '6/26/21' })]);
    const { entries } = importFromLegacyCsv(csv, existingCat);
    expect(entries[0].dateRated).toBe(new Date(2021, 5, 26).getTime());
  });

  it('sets null dateRated for empty date field', () => {
    const existingCat = new Map([
      ['cat-uuid-1', { entryType: 'category', restaurantName: 'Fast Food', ratingCategory: '' }],
    ]);
    const csv = rowsToCsv([makeFoodRow({ 'Date Rated': '' })]);
    const { entries } = importFromLegacyCsv(csv, existingCat);
    expect(entries[0].dateRated).toBeNull();
  });

  it('skips food rows with UUIDs already in existingCombined', () => {
    const existing = new Map([
      ['food-uuid-1', { entryType: 'food', restaurantName: 'McDonalds' }],
    ]);
    const csv = rowsToCsv([makeFoodRow()]);
    const { entries } = importFromLegacyCsv(csv, existing);
    expect(entries.length).toBe(0);
  });

  it('skips category rows with UUIDs already in existingCombined', () => {
    const existing = new Map([
      ['cat-uuid-1', { entryType: 'category', restaurantName: 'Fast Food', ratingCategory: '' }],
    ]);
    const csv = rowsToCsv([makeCatRow()]);
    const { newCategories } = importFromLegacyCsv(csv, existing);
    expect(newCategories.length).toBe(0);
  });

  it('skips category rows without a UUID', () => {
    const csv = rowsToCsv([makeCatRow({ UUID: '' })]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories.length).toBe(0);
  });

  it('computes categories ancestor chain for food entries', () => {
    const catRow = makeCatRow({ UUID: 'root', 'Category UUID': '', Specifier: 'Root' });
    const midRow = makeCatRow({ UUID: 'mid', 'Category UUID': 'root', Specifier: 'Mid', 'Brand Name': '' });
    const foodRow = makeFoodRow({ UUID: 'food1', 'Category UUID': 'mid' });
    const csv = rowsToCsv([catRow, midRow, foodRow]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].categories).toEqual(['mid', 'root']);
  });

  it('generates a UUID when food row has no UUID', () => {
    const csv = rowsToCsv([makeFoodRow({ UUID: '' })]);
    const existingCat = new Map([
      ['cat-uuid-1', { entryType: 'category', restaurantName: 'Fast Food', ratingCategory: '' }],
    ]);
    const { entries } = importFromLegacyCsv(csv, existingCat);
    expect(entries.length).toBe(1);
    expect(entries[0].uuid).toBeTruthy();
    expect(entries[0].uuid.length).toBeGreaterThan(0);
  });

  it('handles null score as null', () => {
    const csv = rowsToCsv([makeFoodRow({ Score: '' })]);
    const existingCat = new Map([
      ['cat-uuid-1', { entryType: 'category', restaurantName: 'Fast Food', ratingCategory: '' }],
    ]);
    const { entries } = importFromLegacyCsv(csv, existingCat);
    expect(entries[0].score).toBeNull();
  });

  it('preserves non-empty picture on new-schema food rows', () => {
    const csv = rowsToCsv([makeFoodRow({ Picture: 'http://example.com/food.jpg' })]);
    const existingCat = new Map([
      ['cat-uuid-1', { entryType: 'category', restaurantName: 'Fast Food', ratingCategory: '' }],
    ]);
    const { entries } = importFromLegacyCsv(csv, existingCat);
    expect(entries[0].picture).toBe('http://example.com/food.jpg');
  });

  it('preserves non-empty additionalInfo and picture on new-schema category rows', () => {
    const cat = makeCatRow({
      'Additional Information': 'top-level cat',
      Picture: 'http://example.com/cat.jpg',
    });
    const csv = rowsToCsv([cat]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories[0].additionalInfo).toBe('top-level cat');
    expect(newCategories[0].picture).toBe('http://example.com/cat.jpg');
  });

  it('preserves non-empty score on new-schema category rows', () => {
    const cat = makeCatRow({ Score: '6' });
    const csv = rowsToCsv([cat]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories[0].score).toBe('6');
  });

  it('handles new-schema category with empty Specifier', () => {
    const cat = makeCatRow({ UUID: 'cat-empty-spec', Specifier: '', 'Category UUID': 'parent-uuid' });
    const csv = rowsToCsv([cat]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories[0].restaurantName).toBe('');
    expect(newCategories[0].ratingCategory).toBe('parent-uuid');
  });

  it('handles new-schema food with empty optional fields', () => {
    const food = makeFoodRow({
      'Category UUID': '',
      Specifier: '',
      Location: '',
      'Additional Information': '',
    });
    const existingCat = new Map([
      ['cat-uuid-1', { entryType: 'category', restaurantName: 'Fast Food', ratingCategory: '' }],
    ]);
    const csv = rowsToCsv([food]);
    const { entries } = importFromLegacyCsv(csv, existingCat);
    expect(entries[0].ratingCategory).toBe('');
    expect(entries[0].specifier).toBe('');
    expect(entries[0].location).toBe('');
    expect(entries[0].additionalInfo).toBe('');
  });
});

// ── importFromLegacyCsv — old schema (name-based lookup) ─────────────────────

function makeOldCatRow(overrides = {}) {
  return {
    UUID: 'cat-old-1',
    Categories: '',           // top-level hint
    'Rating Category': '',    // parent name
    'Restaurant Names': '',   // empty = category row
    Specifier: 'Snacks',
    Location: '',
    Score: '',
    'Date Rated': '',
    'Additional Information': '',
    Picture: '',
    ...overrides,
  };
}

function makeOldFoodRow(overrides = {}) {
  return {
    UUID: 'food-old-1',
    Categories: '',
    'Rating Category': 'Snacks',
    'Restaurant Names': 'Pringles',
    Specifier: 'Original',
    Location: 'Home',
    Score: '7',
    'Date Rated': '1/1/22',
    'Additional Information': '',
    Picture: '',
    ...overrides,
  };
}

describe('importFromLegacyCsv — old schema', () => {
  it('detects old schema (no Category UUID column)', () => {
    const csv = rowsToCsv([makeOldCatRow()]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories.length).toBe(1);
    expect(newCategories[0].restaurantName).toBe('Snacks');
  });

  it('resolves food entry parent category by name', () => {
    const csv = rowsToCsv([makeOldCatRow(), makeOldFoodRow()]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries.length).toBe(1);
    expect(entries[0].ratingCategory).toBe('cat-old-1');
  });

  it('returns empty ratingCategory when name not found', () => {
    const csv = rowsToCsv([makeOldFoodRow({ 'Rating Category': 'Unknown Category' })]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].ratingCategory).toBe('');
  });

  it('uses top-level hint to disambiguate duplicate category names', () => {
    const cat1 = makeOldCatRow({ UUID: 'cat-a', Specifier: 'Chicken', Categories: 'Meat', 'Rating Category': 'Meat' });
    const cat2 = makeOldCatRow({ UUID: 'cat-b', Specifier: 'Chicken', Categories: 'Veg',  'Rating Category': 'Veg' });
    const food = makeOldFoodRow({
      UUID: 'food-x',
      'Rating Category': 'Chicken',
      Categories: 'Veg',
      'Restaurant Names': 'Tofu Place',
    });
    const csv = rowsToCsv([cat1, cat2, food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].ratingCategory).toBe('cat-b');
  });

  it('falls back to first registered match when hint is ambiguous', () => {
    const cat1 = makeOldCatRow({ UUID: 'cat-first', Specifier: 'Snacks' });
    const cat2 = makeOldCatRow({ UUID: 'cat-second', Specifier: 'Snacks' });
    const food = makeOldFoodRow({ 'Rating Category': 'Snacks', Categories: 'NoMatch' });
    const csv = rowsToCsv([cat1, cat2, food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].ratingCategory).toBe('cat-first');
  });

  it('resolves category names case-insensitively', () => {
    const cat = makeOldCatRow({ UUID: 'cat-ci', Specifier: 'SNACKS' });
    const food = makeOldFoodRow({ 'Rating Category': 'snacks' });
    const csv = rowsToCsv([cat, food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].ratingCategory).toBe('cat-ci');
  });

  it('returns empty ratingCategory for "???" parent name', () => {
    const food = makeOldFoodRow({ 'Rating Category': '???' });
    const csv = rowsToCsv([food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].ratingCategory).toBe('');
  });

  it('seeds the name lookup from existingCombined categories', () => {
    const existing = new Map([
      ['existing-cat', { entryType: 'category', restaurantName: 'Drinks', ratingCategory: '' }],
    ]);
    const food = makeOldFoodRow({ 'Rating Category': 'Drinks' });
    const csv = rowsToCsv([food]);
    const { entries } = importFromLegacyCsv(csv, existing);
    expect(entries[0].ratingCategory).toBe('existing-cat');
  });

  it('computes ancestor chain for food in old schema', () => {
    const root = makeOldCatRow({ UUID: 'root', Specifier: 'Root', 'Rating Category': '' });
    const mid  = makeOldCatRow({ UUID: 'mid',  Specifier: 'Mid',  'Rating Category': 'Root' });
    const food = makeOldFoodRow({ UUID: 'f1',  'Rating Category': 'Mid' });
    const csv = rowsToCsv([root, mid, food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].categories).toEqual(['mid', 'root']);
  });

  it('skips existing UUID entries in old schema', () => {
    const existing = new Map([
      ['food-old-1', { entryType: 'food', restaurantName: 'Pringles' }],
    ]);
    const csv = rowsToCsv([makeOldFoodRow()]);
    const { entries } = importFromLegacyCsv(csv, existing);
    expect(entries.length).toBe(0);
  });

  it('generates UUID for food row with no UUID in old schema', () => {
    const food = makeOldFoodRow({ UUID: '' });
    const csv = rowsToCsv([food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries.length).toBe(1);
    expect(entries[0].uuid).toBeTruthy();
  });

  it('preserves non-empty additionalInfo and picture on old-schema food rows', () => {
    const food = makeOldFoodRow({
      'Additional Information': 'very salty',
      Picture: 'http://example.com/img.jpg',
    });
    const csv = rowsToCsv([makeOldCatRow(), food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].additionalInfo).toBe('very salty');
    expect(entries[0].picture).toBe('http://example.com/img.jpg');
  });

  it('preserves non-empty score on old-schema category rows', () => {
    const cat = makeOldCatRow({ Score: '9' });
    const csv = rowsToCsv([cat]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories[0].score).toBe('9');
  });

  it('preserves non-empty additionalInfo and picture on old-schema category rows', () => {
    const cat = makeOldCatRow({
      'Additional Information': 'a note',
      Picture: 'http://example.com/cat.jpg',
    });
    const csv = rowsToCsv([cat]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories[0].additionalInfo).toBe('a note');
    expect(newCategories[0].picture).toBe('http://example.com/cat.jpg');
  });

  it('skips old-schema category rows with empty UUID (registerCat and pass 1)', () => {
    const cat = makeOldCatRow({ UUID: '' });
    const csv = rowsToCsv([cat]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories.length).toBe(0);
  });

  it('skips old-schema category rows with UUID already in workingCombined', () => {
    const existing = new Map([
      ['cat-old-1', { entryType: 'category', restaurantName: 'Snacks', ratingCategory: '' }],
    ]);
    const csv = rowsToCsv([makeOldCatRow()]);
    const { newCategories } = importFromLegacyCsv(csv, existing);
    expect(newCategories.length).toBe(0);
  });

  it('handles old-schema category with empty Specifier', () => {
    const cat = makeOldCatRow({ Specifier: '' });
    const csv = rowsToCsv([cat]);
    const { newCategories } = importFromLegacyCsv(csv, new Map());
    expect(newCategories[0].restaurantName).toBe('');
  });

  it('handles old-schema food with empty Rating Category, Specifier, Location, and no score', () => {
    const food = makeOldFoodRow({
      'Rating Category': '',
      Specifier: '',
      Location: '',
      Score: '',
    });
    const csv = rowsToCsv([food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    expect(entries[0].ratingCategory).toBe('');
    expect(entries[0].specifier).toBe('');
    expect(entries[0].location).toBe('');
    expect(entries[0].score).toBeNull();
  });

  it('resolves category by parentName hint when topLevel hint fails', () => {
    // Two categories named "Sauce"; hint by topLevel fails but hint by parentName succeeds
    const cat1 = makeOldCatRow({ UUID: 'sauce-a', Specifier: 'Sauce', 'Rating Category': 'Italian', Categories: 'Food' });
    const cat2 = makeOldCatRow({ UUID: 'sauce-b', Specifier: 'Sauce', 'Rating Category': 'Asian',   Categories: 'Food' });
    const food = makeOldFoodRow({
      'Rating Category': 'Sauce',
      Categories: 'Asian',  // topLevel matches cat2's Categories, but let's use parentName hint
      'Restaurant Names': 'SauceCo',
    });
    const csv = rowsToCsv([cat1, cat2, food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    // topLevel 'Asian' matches cat2.Categories 'Asian' → should resolve to cat2
    expect(entries[0].ratingCategory).toBe('sauce-b');
  });

  it('resolves category by topLevel hint when topLevelHint is empty (falsy || branch)', () => {
    // Two Sauce categories, food row has empty Categories (topLevel hint is '')
    // → hint = '' → no topLevel match → falls back to first registered
    const cat1 = makeOldCatRow({ UUID: 'sauce-first', Specifier: 'Sauce', Categories: '', 'Rating Category': '' });
    const cat2 = makeOldCatRow({ UUID: 'sauce-second', Specifier: 'Sauce', Categories: '', 'Rating Category': '' });
    const food = makeOldFoodRow({ 'Rating Category': 'Sauce', Categories: '' });
    const csv = rowsToCsv([cat1, cat2, food]);
    const { entries } = importFromLegacyCsv(csv, new Map());
    // With empty hint, falls back to first registered uuid
    expect(entries[0].ratingCategory).toBe('sauce-first');
  });

  it('registerCat skips entry when existing category has empty restaurantName', () => {
    // existingCombined has a category with empty restaurantName → registerCat does early return
    const existing = new Map([
      ['existing-uuid', { entryType: 'category', restaurantName: '', ratingCategory: '' }],
    ]);
    const food = makeOldFoodRow({ 'Rating Category': '' });
    const csv = rowsToCsv([food]);
    // Should not throw; empty restaurantName just means that category isn't registered
    const { entries } = importFromLegacyCsv(csv, existing);
    expect(entries[0].ratingCategory).toBe('');
  });
});
