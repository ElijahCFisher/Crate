import { describe, it, expect } from 'vitest';
import {
  convertBetweenScales,
  convertToBaseScore,
  roundToValidScore,
  VALID_SCORES,
} from './scaleUtils';

/**
 * root (no parent, defines the base scale)
 *  ├── harsh   scored 3 in root's scale — a 5 here is only a 3 up there
 *  ├── kind    scored 8 in root's scale
 *  └── mid     scored 5 in root's scale (neutral — same as the base scale)
 *       └── deep  scored 3 in mid's scale
 */
const categories = [
  { uuid: 'root', restaurantName: 'Food', ratingCategory: '', score: '5' },
  { uuid: 'harsh', restaurantName: 'Harsh', ratingCategory: 'root', score: '3' },
  { uuid: 'kind', restaurantName: 'Kind', ratingCategory: 'root', score: '8' },
  { uuid: 'mid', restaurantName: 'Mid', ratingCategory: 'root', score: '5' },
  { uuid: 'deep', restaurantName: 'Deep', ratingCategory: 'mid', score: '3' },
];
const map = new Map(categories.map((c) => [c.uuid, c]));

describe('convertBetweenScales', () => {
  it('maps a category midpoint to the score that category has in its parent', () => {
    // 5 in "harsh" means exactly what 3 means in root's scale.
    expect(convertBetweenScales(5, 'harsh', 'root', map)).toBeCloseTo(3, 10);
    expect(convertBetweenScales(5, 'kind', 'root', map)).toBeCloseTo(8, 10);
  });

  it('round-trips a score back to where it started', () => {
    for (const score of [0, 2, 5, 7.5, 9.4, 10]) {
      const there = convertBetweenScales(score, 'harsh', 'kind', map);
      const back = convertBetweenScales(there, 'kind', 'harsh', map);
      expect(back).toBeCloseTo(score, 10);
    }
  });

  it('is a no-op between a category and itself', () => {
    expect(convertBetweenScales(7, 'harsh', 'harsh', map)).toBe(7);
  });

  it('is a no-op through a neutral category scored at the midpoint', () => {
    expect(convertBetweenScales(7, 'mid', 'root', map)).toBeCloseTo(7, 10);
    expect(convertBetweenScales(7, 'root', 'mid', map)).toBeCloseTo(7, 10);
  });

  it('agrees with convertToBaseScore when converting to the root', () => {
    for (const score of [1, 4, 6, 9]) {
      expect(convertBetweenScales(score, 'deep', 'root', map))
        .toBeCloseTo(convertToBaseScore(score, 'deep', map), 10);
    }
  });

  it('composes through more than one level', () => {
    // 5 in "deep" is 3 in "mid"; "mid" is neutral, so it stays 3 in root.
    expect(convertBetweenScales(5, 'deep', 'root', map)).toBeCloseTo(3, 10);
  });

  it('keeps the endpoints pinned', () => {
    expect(convertBetweenScales(0, 'harsh', 'kind', map)).toBeCloseTo(0, 10);
    expect(convertBetweenScales(10, 'harsh', 'kind', map)).toBeCloseTo(10, 10);
  });

  it('preserves ordering — a better rating stays better', () => {
    const converted = [2, 4, 6, 8].map((s) => convertBetweenScales(s, 'harsh', 'kind', map));
    const sorted = [...converted].sort((a, b) => a - b);
    expect(converted).toEqual(sorted);
  });

  it('moving to a harsher category raises the number', () => {
    // The same experience needs a higher score under a harsh scale to mean as much.
    expect(convertBetweenScales(5, 'kind', 'harsh', map)).toBeGreaterThan(5);
    expect(convertBetweenScales(5, 'harsh', 'kind', map)).toBeLessThan(5);
  });

  it('treats an uncategorized entry as already being in base scale', () => {
    expect(convertBetweenScales(6, '', 'root', map)).toBeCloseTo(6, 10);
  });

  it('passes non-numeric scores straight through', () => {
    expect(convertBetweenScales('', 'harsh', 'kind', map)).toBeNaN();
    expect(convertBetweenScales(null, 'harsh', 'kind', map)).toBeNaN();
  });

  it('survives a category whose parent is missing', () => {
    const orphanMap = new Map([['orphan', { uuid: 'orphan', ratingCategory: 'gone', score: '4' }]]);
    expect(Number.isFinite(convertBetweenScales(5, 'orphan', 'orphan', orphanMap))).toBe(true);
  });
});

describe('converted scores snap to the app scale', () => {
  it('always lands on a valid score', () => {
    for (const score of [1, 3, 5, 7, 8, 9, 9.5, 10]) {
      const converted = roundToValidScore(convertBetweenScales(score, 'harsh', 'kind', map));
      expect(VALID_SCORES).toContain(converted);
    }
  });

  it('has no value between 8.5 and 9 to land on', () => {
    expect(roundToValidScore(8.7)).toBe(8.5);
    expect(roundToValidScore(8.9)).toBe(9);
    expect(roundToValidScore(9.44)).toBe(9.4);
  });
});

describe('converting a mixed result set into one category', () => {
  it('converts each entry from its own category, not a shared source', () => {
    // The same raw number under two different scales does NOT mean the same
    // thing, so moving both into one destination has to produce two different
    // results — that's the whole point of converting per source category.
    const fromHarsh = convertBetweenScales(5, 'harsh', 'mid', map);
    const fromKind = convertBetweenScales(5, 'kind', 'mid', map);

    // 5 under "harsh" means 3 in base; 5 under "kind" means 8 in base.
    expect(fromHarsh).toBeCloseTo(3, 10);
    expect(fromKind).toBeCloseTo(8, 10);
    expect(fromHarsh).not.toBeCloseTo(fromKind, 5);
  });

  it('leaves an entry already in the destination untouched', () => {
    expect(convertBetweenScales(7, 'mid', 'mid', map)).toBe(7);
  });

  it('handles an uncategorized entry in the same pass', () => {
    // No category means base scale, so moving it into a harsh category has to
    // raise the number the same way any other base-scale score would.
    expect(convertBetweenScales(3, '', 'harsh', map))
      .toBeCloseTo(convertBetweenScales(3, 'root', 'harsh', map), 10);
  });
});
