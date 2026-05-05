import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAdditionChange,
  createModificationChange,
  createDeletionChange,
  isLatestChangeForField,
  computeCategories,
} from './changelogUtils';

// ── createAdditionChange ──────────────────────────────────────────────────────

describe('createAdditionChange', () => {
  it('sets changeType to addition', () => {
    const c = createAdditionChange({ uuid: 'u1' });
    expect(c.changeType).toBe('addition');
  });

  it('copies entryUuid from entry.uuid', () => {
    const c = createAdditionChange({ uuid: 'abc' });
    expect(c.entryUuid).toBe('abc');
  });

  it('generates a unique changeUuid each call', () => {
    const a = createAdditionChange({ uuid: 'u1' });
    const b = createAdditionChange({ uuid: 'u1' });
    expect(a.changeUuid).not.toBe(b.changeUuid);
  });

  it('uses default changeMethod when not supplied', () => {
    const c = createAdditionChange({ uuid: 'u1' });
    expect(c.changeMethod).toBe('manual, through the app');
  });

  it('uses provided changeMethod', () => {
    const c = createAdditionChange({ uuid: 'u1' }, 'import');
    expect(c.changeMethod).toBe('import');
  });

  it('copies all entry fields', () => {
    const entry = {
      uuid: 'u1',
      identicals: ['x', 'y'],
      categories: ['cat1'],
      ratingCategory: 'rc1',
      restaurantName: 'Burger King',
      specifier: 'Whopper',
      location: 'NY',
      score: '8',
      dateRated: 1234567890,
      additionalInfo: 'crispy',
      picture: 'http://img',
      entryType: 'food',
    };
    const c = createAdditionChange(entry);
    expect(c.identicals).toEqual(['x', 'y']);
    expect(c.categories).toEqual(['cat1']);
    expect(c.ratingCategory).toBe('rc1');
    expect(c.restaurantName).toBe('Burger King');
    expect(c.specifier).toBe('Whopper');
    expect(c.location).toBe('NY');
    expect(c.score).toBe('8');
    expect(c.dateRated).toBe(1234567890);
    expect(c.additionalInfo).toBe('crispy');
    expect(c.picture).toBe('http://img');
    expect(c.entryType).toBe('food');
  });

  it('uses defaults for missing entry fields', () => {
    const c = createAdditionChange({ uuid: 'u1' });
    expect(c.identicals).toEqual([]);
    expect(c.categories).toEqual([]);
    expect(c.ratingCategory).toBe('');
    expect(c.restaurantName).toBe('');
    expect(c.specifier).toBe('');
    expect(c.location).toBe('');
    expect(c.score).toBeNull();
    expect(c.dateRated).toBeNull();
    expect(c.additionalInfo).toBe('');
    expect(c.picture).toBe('');
    expect(c.entryType).toBe('food');
  });

  it('sets fieldName and value to empty strings', () => {
    const c = createAdditionChange({ uuid: 'u1' });
    expect(c.fieldName).toBe('');
    expect(c.value).toBe('');
  });

  it('sets dateOfChange to approximately now', () => {
    const before = Date.now();
    const c = createAdditionChange({ uuid: 'u1' });
    const after = Date.now();
    expect(c.dateOfChange).toBeGreaterThanOrEqual(before);
    expect(c.dateOfChange).toBeLessThanOrEqual(after);
  });
});

// ── createModificationChange ──────────────────────────────────────────────────

describe('createModificationChange', () => {
  it('sets changeType to modification', () => {
    const c = createModificationChange('u1', 'score', '9');
    expect(c.changeType).toBe('modification');
  });

  it('copies entryUuid', () => {
    const c = createModificationChange('uuid-abc', 'score', '9');
    expect(c.entryUuid).toBe('uuid-abc');
  });

  it('sets fieldName and value', () => {
    const c = createModificationChange('u1', 'restaurantName', 'McDonalds');
    expect(c.fieldName).toBe('restaurantName');
    expect(c.value).toBe('McDonalds');
  });

  it('coerces value to string', () => {
    const c = createModificationChange('u1', 'score', 9);
    expect(c.value).toBe('9');
  });

  it('coerces null value to empty string', () => {
    const c = createModificationChange('u1', 'score', null);
    expect(c.value).toBe('');
  });

  it('generates a unique changeUuid', () => {
    const a = createModificationChange('u1', 'f', 'v');
    const b = createModificationChange('u1', 'f', 'v');
    expect(a.changeUuid).not.toBe(b.changeUuid);
  });

  it('uses default changeMethod', () => {
    const c = createModificationChange('u1', 'f', 'v');
    expect(c.changeMethod).toBe('manual, through the app');
  });

  it('uses provided changeMethod', () => {
    const c = createModificationChange('u1', 'f', 'v', 'sync');
    expect(c.changeMethod).toBe('sync');
  });

  it('sets non-relevant fields to their empty defaults', () => {
    const c = createModificationChange('u1', 'f', 'v');
    expect(c.identicals).toEqual([]);
    expect(c.categories).toEqual([]);
    expect(c.score).toBeNull();
    expect(c.dateRated).toBeNull();
  });
});

// ── createDeletionChange ──────────────────────────────────────────────────────

describe('createDeletionChange', () => {
  it('sets changeType to deletion', () => {
    const c = createDeletionChange('u1');
    expect(c.changeType).toBe('deletion');
  });

  it('copies entryUuid', () => {
    const c = createDeletionChange('uuid-xyz');
    expect(c.entryUuid).toBe('uuid-xyz');
  });

  it('generates a unique changeUuid', () => {
    const a = createDeletionChange('u1');
    const b = createDeletionChange('u1');
    expect(a.changeUuid).not.toBe(b.changeUuid);
  });

  it('uses default changeMethod', () => {
    const c = createDeletionChange('u1');
    expect(c.changeMethod).toBe('manual, through the app');
  });

  it('uses provided changeMethod', () => {
    const c = createDeletionChange('u1', 'bulk');
    expect(c.changeMethod).toBe('bulk');
  });

  it('sets non-relevant fields to empty defaults', () => {
    const c = createDeletionChange('u1');
    expect(c.fieldName).toBe('');
    expect(c.value).toBe('');
    expect(c.identicals).toEqual([]);
  });
});

// ── isLatestChangeForField ────────────────────────────────────────────────────

describe('isLatestChangeForField', () => {
  const base = {
    entryUuid: 'u1',
    changeType: 'modification',
    fieldName: 'score',
    dateOfChange: 1000,
  };

  it('returns true when no newer modification exists for that field', () => {
    const changelog = [base];
    expect(isLatestChangeForField(changelog, base)).toBe(true);
  });

  it('returns false when a newer modification exists for the same field', () => {
    const newer = { ...base, changeUuid: 'c2', dateOfChange: 2000 };
    const changelog = [base, newer];
    expect(isLatestChangeForField(changelog, base)).toBe(false);
  });

  it('returns true when newer change targets a different field', () => {
    const newerDiff = { ...base, changeUuid: 'c2', fieldName: 'location', dateOfChange: 2000 };
    const changelog = [base, newerDiff];
    expect(isLatestChangeForField(changelog, base)).toBe(true);
  });

  it('returns true when newer change targets a different entry', () => {
    const newerDiff = { ...base, changeUuid: 'c2', entryUuid: 'u2', dateOfChange: 2000 };
    const changelog = [base, newerDiff];
    expect(isLatestChangeForField(changelog, base)).toBe(true);
  });

  it('returns true for addition changeType (always)', () => {
    const addChange = { entryUuid: 'u1', changeType: 'addition', fieldName: '', dateOfChange: 1000 };
    const changelog = [addChange, { ...addChange, changeUuid: 'c2', dateOfChange: 2000 }];
    expect(isLatestChangeForField(changelog, addChange)).toBe(true);
  });

  it('returns false for deletion when a newer deletion exists', () => {
    const del = { entryUuid: 'u1', changeType: 'deletion', fieldName: '', dateOfChange: 1000 };
    const newerDel = { ...del, changeUuid: 'c2', dateOfChange: 2000 };
    const changelog = [del, newerDel];
    expect(isLatestChangeForField(changelog, del)).toBe(false);
  });

  it('returns true for deletion when it is the newest', () => {
    const del = { entryUuid: 'u1', changeType: 'deletion', fieldName: '', dateOfChange: 2000 };
    const olderDel = { ...del, changeUuid: 'c0', dateOfChange: 1000 };
    const changelog = [olderDel, del];
    expect(isLatestChangeForField(changelog, del)).toBe(true);
  });

  it('treats equal timestamps as latest (not strictly newer)', () => {
    const same = { ...base, changeUuid: 'c2', dateOfChange: 1000 };
    const changelog = [base, same];
    // Neither is strictly greater, so base should still be considered latest
    expect(isLatestChangeForField(changelog, base)).toBe(true);
  });
});

// ── computeCategories ─────────────────────────────────────────────────────────

describe('computeCategories', () => {
  it('returns empty array for empty/null uuid', () => {
    expect(computeCategories('', new Map())).toEqual([]);
    expect(computeCategories(null, new Map())).toEqual([]);
  });

  it('returns empty array when uuid not found in combined', () => {
    expect(computeCategories('missing', new Map())).toEqual([]);
  });

  it('returns empty array when entry is not a category', () => {
    const combined = new Map([['u1', { entryType: 'food', ratingCategory: '' }]]);
    expect(computeCategories('u1', combined)).toEqual([]);
  });

  it('returns single-element array for root category', () => {
    const combined = new Map([
      ['cat1', { entryType: 'category', ratingCategory: '' }],
    ]);
    expect(computeCategories('cat1', combined)).toEqual(['cat1']);
  });

  it('returns ancestor chain from leaf to root', () => {
    const combined = new Map([
      ['root', { entryType: 'category', ratingCategory: '' }],
      ['mid',  { entryType: 'category', ratingCategory: 'root' }],
      ['leaf', { entryType: 'category', ratingCategory: 'mid' }],
    ]);
    expect(computeCategories('leaf', combined)).toEqual(['leaf', 'mid', 'root']);
  });

  it('stops when parent is a food entry (not a category)', () => {
    const combined = new Map([
      ['food1', { entryType: 'food', ratingCategory: '' }],
      ['cat1',  { entryType: 'category', ratingCategory: 'food1' }],
    ]);
    expect(computeCategories('cat1', combined)).toEqual(['cat1']);
  });

  it('prevents infinite loop on circular references', () => {
    const combined = new Map([
      ['a', { entryType: 'category', ratingCategory: 'b' }],
      ['b', { entryType: 'category', ratingCategory: 'a' }],
    ]);
    const result = computeCategories('a', combined);
    expect(result).toEqual(['a', 'b']);
  });

  it('handles deeply nested hierarchy', () => {
    const combined = new Map(
      ['r', 'c1', 'c2', 'c3', 'c4'].map((id, i, arr) => [
        id,
        { entryType: 'category', ratingCategory: i === 0 ? '' : arr[i - 1] },
      ])
    );
    expect(computeCategories('c4', combined)).toEqual(['c4', 'c3', 'c2', 'c1', 'r']);
  });
});
