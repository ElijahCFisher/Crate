import { describe, expect, it } from 'vitest';
import { buildBulkEdits } from './bulkEdit';
import { convertBetweenScales, roundToValidScore } from './scaleUtils';

const cats = [
  { uuid: 'root', entryType: 'category', restaurantName: 'Food', ratingCategory: '', score: '5' },
  { uuid: 'harsh', entryType: 'category', restaurantName: 'Harsh', ratingCategory: 'root', score: '8' },
  { uuid: 'kind', entryType: 'category', restaurantName: 'Kind', ratingCategory: 'root', score: '3' },
  { uuid: 'other', entryType: 'category', restaurantName: 'Other root', ratingCategory: '', score: '5' },
];

function setup(entries) {
  const combined = new Map([...cats, ...entries].map((e) => [e.uuid, e]));
  const categoriesMap = new Map(cats.map((c) => [c.uuid, c]));
  return { combined, categoriesMap };
}

const food = (uuid, extra) => ({
  uuid, entryType: 'food', restaurantName: 'A', location: 'X', dateRated: 1, ratingCategory: 'harsh', score: '7', ...extra,
});

describe('buildBulkEdits', () => {
  it('moves category and converts scores when asked', () => {
    const a = food('a');
    const { combined, categoriesMap } = setup([a]);
    const { edits, rows } = buildBulkEdits({
      selected: [a], values: { ratingCategory: 'kind' }, convertScores: true, combined, categoriesMap,
    });
    const expected = String(roundToValidScore(convertBetweenScales('7', 'harsh', 'kind', categoriesMap)));
    expect(expected).not.toBe('7');
    expect(edits).toEqual([{ uuid: 'a', updates: { ratingCategory: 'kind', score: expected } }]);
    expect(rows[0].newScore).toBe(expected);
  });

  it('leaves scores alone when conversion is off', () => {
    const a = food('a');
    const { combined, categoriesMap } = setup([a]);
    const { edits } = buildBulkEdits({
      selected: [a], values: { ratingCategory: 'kind' }, convertScores: false, combined, categoriesMap,
    });
    expect(edits).toEqual([{ uuid: 'a', updates: { ratingCategory: 'kind' } }]);
  });

  it('converts each entry from its own category', () => {
    const a = food('a', { ratingCategory: 'harsh' });
    const b = food('b', { ratingCategory: 'kind' });
    const { combined, categoriesMap } = setup([a, b]);
    const { edits } = buildBulkEdits({
      selected: [a, b], values: { ratingCategory: 'root' }, convertScores: true, combined, categoriesMap,
    });
    const byUuid = Object.fromEntries(edits.map((e) => [e.uuid, e.updates]));
    expect(byUuid.a.score).toBe(String(roundToValidScore(convertBetweenScales('7', 'harsh', 'root', categoriesMap))));
    expect(byUuid.b.score).toBe(String(roundToValidScore(convertBetweenScales('7', 'kind', 'root', categoriesMap))));
  });

  it('skips entries already in the target and blank fields', () => {
    const a = food('a', { ratingCategory: 'kind' });
    const { combined, categoriesMap } = setup([a]);
    const { edits, rows } = buildBulkEdits({
      selected: [a], values: { ratingCategory: 'kind', restaurantName: '', location: 'X' }, convertScores: true, combined, categoriesMap,
    });
    expect(edits).toEqual([]);
    expect(rows[0].changed).toBe(false);
  });

  it('sets plain fields and leaves unscored entries unscored', () => {
    const a = food('a', { score: null });
    const { combined, categoriesMap } = setup([a]);
    const { edits } = buildBulkEdits({
      selected: [a], values: { ratingCategory: 'kind', restaurantName: 'B', dateRated: 5 }, convertScores: true, combined, categoriesMap,
    });
    expect(edits).toEqual([{ uuid: 'a', updates: { restaurantName: 'B', dateRated: 5, ratingCategory: 'kind' } }]);
  });

  it('carries changes to linked followers that were not selected', () => {
    const a = food('a', { linkedFields: { ratingCategory: ['f'], score: ['f'] } });
    const f = food('f');
    const { combined, categoriesMap } = setup([a, f]);
    const { edits, linkedCount } = buildBulkEdits({
      selected: [a], values: { ratingCategory: 'kind' }, convertScores: true, combined, categoriesMap,
    });
    expect(linkedCount).toBe(1);
    expect(edits[1]).toEqual({ uuid: 'f', updates: edits[0].updates });
  });

  it('a selected follower keeps its own result', () => {
    const a = food('a', { linkedFields: { ratingCategory: ['f'] } });
    const f = food('f', { ratingCategory: 'kind', score: '4' });
    const { combined, categoriesMap } = setup([a, f]);
    const { edits, linkedCount } = buildBulkEdits({
      selected: [a, f], values: { ratingCategory: 'root' }, convertScores: true, combined, categoriesMap,
    });
    expect(linkedCount).toBe(0);
    expect(edits.find((e) => e.uuid === 'f').updates.score)
      .toBe(String(roundToValidScore(convertBetweenScales('4', 'kind', 'root', categoriesMap))));
  });

  it('counts conversions across unrelated root categories', () => {
    const a = food('a');
    const { combined, categoriesMap } = setup([a]);
    const { crossTreeCount } = buildBulkEdits({
      selected: [a], values: { ratingCategory: 'other' }, convertScores: true, combined, categoriesMap,
    });
    expect(crossTreeCount).toBe(1);
  });
});
