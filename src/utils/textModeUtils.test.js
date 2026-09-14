import { describe, it, expect } from 'vitest';
import {
  buildCategoryIndex,
  resolveCategoryPhrase,
  resolveCategoryMatches,
  parseDateLine,
  parseText,
  generateText,
  generateTextLines,
  alignLines,
} from './textModeUtils';

// "sandwich" > "chicken", plus a couple of flat ones.
const categories = [
  { uuid: 'c-sandwich', restaurantName: 'sandwich', ratingCategory: '' },
  { uuid: 'c-chicken', restaurantName: 'chicken', ratingCategory: 'c-sandwich' },
  { uuid: 'c-greek', restaurantName: 'greek', ratingCategory: '' },
  { uuid: 'c-ice-cream', restaurantName: 'ice cream', ratingCategory: '' },
];

const index = buildCategoryIndex(categories);

describe('resolveCategoryPhrase', () => {
  it('matches an exact name', () => {
    expect(resolveCategoryPhrase('greek', index)).toBe('c-greek');
  });

  it('matches case- and space-insensitively', () => {
    expect(resolveCategoryPhrase('  GREEK ', index)).toBe('c-greek');
  });

  it('matches a multi-word category name', () => {
    expect(resolveCategoryPhrase('ice cream', index)).toBe('c-ice-cream');
  });

  it('falls back to "chicken within sandwich" for "chicken sandwich"', () => {
    expect(resolveCategoryPhrase('chicken sandwich', index)).toBe('c-chicken');
  });

  it('never invents a category', () => {
    expect(resolveCategoryPhrase('elk tartare', index)).toBeNull();
    expect(resolveCategoryPhrase('', index)).toBeNull();
  });

  it('does not match a nesting that does not exist', () => {
    expect(resolveCategoryPhrase('greek sandwich', index)).toBeNull();
  });
});

describe('parseText', () => {
  it('reads restaurant, location and a rating line', () => {
    const { ratings, errors } = parseText("Zorba's\nDenver\nGyro 8 greek really tender", categories);
    expect(errors).toEqual([]);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]).toMatchObject({
      restaurantName: "Zorba's",
      location: 'Denver',
      specifier: 'Gyro',
      score: '8',
      ratingCategory: 'c-greek',
      additionalInfo: 'really tender',
    });
  });

  it('treats line 2 as a rating when it has a score, leaving location blank', () => {
    const { ratings } = parseText("Zorba's\nGyro 8", categories);
    expect(ratings[0]).toMatchObject({ location: '', specifier: 'Gyro', score: '8' });
  });

  it('leaves category blank and keeps the words as notes when nothing matches', () => {
    const { ratings } = parseText("Zorba's\nDenver\nGyro 8 was pretty dry", categories);
    expect(ratings[0].ratingCategory).toBe('');
    expect(ratings[0].additionalInfo).toBe('was pretty dry');
  });

  it('prefixes an indented line with "From <the food above>"', () => {
    const text = "Zorba's\nDenver\nCombo platter 7\n  Fries 5 too salty";
    const { ratings } = parseText(text, categories);
    expect(ratings[1]).toMatchObject({
      specifier: 'Fries',
      score: '5',
      additionalInfo: 'From Combo platter too salty',
    });
  });

  it('accepts a tab as the indent and works with no notes of its own', () => {
    const { ratings } = parseText("Zorba's\nDenver\nCombo 7\n\tFries 5", categories);
    expect(ratings[1].additionalInfo).toBe('From Combo');
  });

  it('keeps pointing at the most recent un-indented food', () => {
    const text = "Z\nDenver\nPlatter 7\n  Fries 5\nGyro 9\n  Sauce 6";
    const { ratings } = parseText(text, categories);
    expect(ratings[1].additionalInfo).toBe('From Platter');
    expect(ratings[3].additionalInfo).toBe('From Gyro');
  });

  it('starts a new restaurant after a blank line', () => {
    const text = "Zorba's\nDenver\nGyro 8\n\nPho Place\nAurora\nPho 9";
    const { ratings } = parseText(text, categories);
    expect(ratings).toHaveLength(2);
    expect(ratings[1]).toMatchObject({ restaurantName: 'Pho Place', location: 'Aurora', specifier: 'Pho' });
  });

  it('reports a line with no score instead of guessing', () => {
    const { ratings, errors } = parseText("Zorba's\nDenver\nGyro was good", categories);
    expect(ratings).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].lineNumber).toBe(3);
  });

  it('ignores numbers above 10 when looking for the score', () => {
    const { ratings } = parseText("Zorba's\nSuite 200\nGyro 8", categories);
    expect(ratings[0]).toMatchObject({ location: 'Suite 200', score: '8' });
  });

  it('handles decimal scores', () => {
    const { ratings } = parseText("Z\nDenver\nGyro 7.5", categories);
    expect(ratings[0].score).toBe('7.5');
  });

  it('resolves a nested category written as two words', () => {
    const { ratings } = parseText('Deli\nDenver\nSpicy Deluxe 8 chicken sandwich so good', categories);
    expect(ratings[0]).toMatchObject({
      specifier: 'Spicy Deluxe',
      ratingCategory: 'c-chicken',
      additionalInfo: 'so good',
    });
  });

  it('returns nothing for empty input', () => {
    expect(parseText('', categories).ratings).toEqual([]);
    expect(parseText(null, categories).ratings).toEqual([]);
  });
});

describe('generateText', () => {
  const ratings = [
    { id: 'a', restaurantName: "Zorba's", location: 'Denver', specifier: 'Gyro', score: '8', ratingCategory: 'c-greek', additionalInfo: 'tender' },
    { id: 'b', restaurantName: "Zorba's", location: 'Denver', specifier: 'Fries', score: '5', ratingCategory: '', additionalInfo: 'From Gyro salty' },
    { id: 'c', restaurantName: 'Pho Place', location: '', specifier: 'Pho', score: '9', ratingCategory: '', additionalInfo: '' },
  ];

  it('renders blocks, indentation and a blank line between restaurants', () => {
    expect(generateText(ratings, categories)).toBe(
      "Zorba's\nDenver\nGyro 8 greek tender\n  Fries 5 salty\n\nPho Place\nPho 9"
    );
  });

  it('tags each line with the rating it came from', () => {
    const lines = generateTextLines(ratings, categories);
    expect(lines.map((l) => l.id)).toEqual([null, null, 'a', 'b', null, null, 'c']);
  });

  it('round-trips back to the same values', () => {
    const { ratings: reparsed } = parseText(generateText(ratings, categories), categories);
    expect(reparsed.map((r) => ({
      restaurantName: r.restaurantName,
      location: r.location,
      specifier: r.specifier,
      score: r.score,
      ratingCategory: r.ratingCategory,
      additionalInfo: r.additionalInfo,
    }))).toEqual(ratings.map(({ id, ...rest }) => rest));
  });

  it('omits fields that are empty', () => {
    const bare = [{ id: 'x', restaurantName: 'R', location: '', specifier: 'Thing', score: '6', ratingCategory: '', additionalInfo: '' }];
    expect(generateText(bare, categories)).toBe('R\nThing 6');
  });
});

describe('alignLines', () => {
  it('keeps untouched lines pointing at themselves', () => {
    expect(alignLines(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([0, 1, 2]);
  });

  it('maps a line edited in place back to its original', () => {
    expect(alignLines(['a', 'b', 'c'], ['a', 'b EDITED', 'c'])).toEqual([0, 1, 2]);
  });

  it('marks an inserted line as new without shifting its neighbours', () => {
    expect(alignLines(['a', 'b'], ['a', 'NEW', 'b'])).toEqual([0, -1, 1]);
  });

  it('marks appended lines as new', () => {
    expect(alignLines(['a'], ['a', 'b', 'c'])).toEqual([0, -1, -1]);
  });

  it('does not misattribute when a line is removed', () => {
    expect(alignLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([0, 2]);
  });

  it('handles an empty baseline', () => {
    expect(alignLines([], ['a', 'b'])).toEqual([-1, -1]);
  });
});

// "egg" lives in two places, which is the whole reason paths exist.
const shared = [
  { uuid: 'c-breakfast', restaurantName: 'breakfast', ratingCategory: '' },
  { uuid: 'c-breakfast-egg', restaurantName: 'egg', ratingCategory: 'c-breakfast' },
  { uuid: 'c-side', restaurantName: 'side', ratingCategory: '' },
  { uuid: 'c-side-egg', restaurantName: 'egg', ratingCategory: 'c-side' },
  { uuid: 'c-greek', restaurantName: 'greek', ratingCategory: '' },
];
const sharedIndex = buildCategoryIndex(shared);

describe('category paths', () => {
  it('picks the subcategory named by the path', () => {
    expect(resolveCategoryPhrase('breakfast > egg', sharedIndex)).toBe('c-breakfast-egg');
    expect(resolveCategoryPhrase('side > egg', sharedIndex)).toBe('c-side-egg');
  });

  it('accepts -> and / and no spaces at all', () => {
    expect(resolveCategoryPhrase('side -> egg', sharedIndex)).toBe('c-side-egg');
    expect(resolveCategoryPhrase('side/egg', sharedIndex)).toBe('c-side-egg');
    expect(resolveCategoryPhrase('side>egg', sharedIndex)).toBe('c-side-egg');
  });

  it('skips levels — a path names ancestors, not just parents', () => {
    const deep = buildCategoryIndex([
      { uuid: 'c-food', restaurantName: 'food', ratingCategory: '' },
      { uuid: 'c-breakfast', restaurantName: 'breakfast', ratingCategory: 'c-food' },
      { uuid: 'c-egg', restaurantName: 'egg', ratingCategory: 'c-breakfast' },
    ]);
    expect(resolveCategoryPhrase('food > egg', deep)).toBe('c-egg');
    expect(resolveCategoryPhrase('food > breakfast > egg', deep)).toBe('c-egg');
    expect(resolveCategoryPhrase('egg > breakfast', deep)).toBeNull();
  });

  it('reports every category a bare name could mean', () => {
    expect(resolveCategoryMatches('egg', sharedIndex)).toEqual(['c-breakfast-egg', 'c-side-egg']);
    expect(resolveCategoryMatches('greek', sharedIndex)).toEqual(['c-greek']);
  });

  it('reads a path on a rating line and keeps the rest as notes', () => {
    const { ratings, warnings } = parseText('Diner\nDenver\nOmelet 8 breakfast > egg fluffy', shared);
    expect(warnings).toEqual([]);
    expect(ratings[0]).toMatchObject({
      specifier: 'Omelet',
      ratingCategory: 'c-breakfast-egg',
      additionalInfo: 'fluffy',
    });
  });

  it('warns instead of silently picking when a bare name is ambiguous', () => {
    const { ratings, warnings } = parseText('Diner\nDenver\nOmelet 8 egg fluffy', shared);
    expect(ratings[0].ratingCategory).toBe('c-breakfast-egg');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].lineNumber).toBe(3);
    expect(warnings[0].message).toContain('breakfast > egg');
    expect(warnings[0].message).toContain('side > egg');
  });

  it('warns when a path was clearly meant but matches nothing', () => {
    const { ratings, warnings } = parseText('Diner\nDenver\nOmelet 8 lunch > egg', shared);
    expect(ratings[0].ratingCategory).toBe('');
    expect(ratings[0].additionalInfo).toBe('lunch > egg');
    expect(warnings[0].message).toContain('No category matches');
  });

  it('writes an ambiguous category back as a path, and a unique one as its name', () => {
    const ratings = [
      { id: 'a', restaurantName: 'Diner', specifier: 'Omelet', score: '8', ratingCategory: 'c-side-egg', additionalInfo: '' },
      { id: 'b', restaurantName: 'Diner', specifier: 'Gyro', score: '7', ratingCategory: 'c-greek', additionalInfo: '' },
    ];
    expect(generateText(ratings, shared)).toBe('Diner\nOmelet 8 side > egg\nGyro 7 greek');
  });

  it('round-trips the path it wrote', () => {
    const ratings = [
      { id: 'a', restaurantName: 'Diner', specifier: 'Omelet', score: '8', ratingCategory: 'c-side-egg', additionalInfo: 'runny' },
    ];
    const { ratings: reparsed, warnings } = parseText(generateText(ratings, shared), shared);
    expect(warnings).toEqual([]);
    expect(reparsed[0]).toMatchObject({ ratingCategory: 'c-side-egg', additionalInfo: 'runny' });
  });
});

describe('ratings that are missing a piece', () => {
  it('marks a rating with no score so it cannot be read as the location', () => {
    const ratings = [
      { id: 'a', restaurantName: "Zorba's", location: 'Denver', specifier: 'Omelet', score: '', ratingCategory: 'c-greek', additionalInfo: '' },
      { id: 'b', restaurantName: "Zorba's", location: 'Denver', specifier: 'Fries', score: '5', ratingCategory: '', additionalInfo: '' },
    ];
    expect(generateText(ratings, categories)).toBe("Zorba's\nDenver\nOmelet ? greek\nFries 5");
  });

  it('reads the placeholder back as a rating with no score, location intact', () => {
    const { ratings, errors } = parseText("Zorba's\nDenver\nOmelet ? greek\nFries 5", categories);
    expect(errors).toEqual([]);
    expect(ratings).toHaveLength(2);
    expect(ratings[0]).toMatchObject({ specifier: 'Omelet', score: '', ratingCategory: 'c-greek', location: 'Denver' });
    expect(ratings[1]).toMatchObject({ specifier: 'Fries', score: '5', location: 'Denver' });
  });

  it('keeps an unscored rating in one block instead of splitting the restaurant in two', () => {
    const ratings = [
      { id: 'a', restaurantName: "Zorba's", location: 'Denver', specifier: 'Omelet', score: '', ratingCategory: '', additionalInfo: '' },
      { id: 'b', restaurantName: "Zorba's", location: 'Denver', specifier: 'Fries', score: '5', ratingCategory: '', additionalInfo: '' },
    ];
    const text = generateText(ratings, categories);
    const { ratings: reparsed } = parseText(text, categories);
    expect(reparsed.map((r) => [r.restaurantName, r.location, r.specifier, r.score])).toEqual([
      ["Zorba's", 'Denver', 'Omelet', ''],
      ["Zorba's", 'Denver', 'Fries', '5'],
    ]);
    expect(generateText(reparsed.map((r, i) => ({ ...r, id: ratings[i].id })), categories)).toBe(text);
  });

  it('gives a block with no restaurant a header to stand on', () => {
    const ratings = [{ id: 'a', restaurantName: '', location: 'Denver', specifier: 'Gyro', score: '8', ratingCategory: '', additionalInfo: '' }];
    const text = generateText(ratings, categories);
    expect(text).toBe('?\nDenver\nGyro 8');
    const { ratings: reparsed } = parseText(text, categories);
    expect(reparsed[0]).toMatchObject({ restaurantName: '', location: 'Denver', specifier: 'Gyro', score: '8' });
  });

  it('writes nothing at all for a rating that is entirely blank', () => {
    const blank = [{ id: 'a', restaurantName: '', location: '', specifier: '', score: '', ratingCategory: '', additionalInfo: '' }];
    expect(generateText(blank, categories)).toBe('');
    expect(generateTextLines(blank, categories)).toEqual([]);
  });

  it('still refuses a line that names neither a score nor the placeholder', () => {
    const { errors } = parseText("Zorba's\nDenver\nGyro 8\nFries was fine", categories);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('?');
  });
});

describe('date lines', () => {
  const now = new Date(2026, 8, 7); // Sep 7, 2026

  it('reads the formats and rejects everything else', () => {
    expect(parseDateLine('9/1', now)).toBe('2026-09-01');
    expect(parseDateLine('9/1/25', now)).toBe('2025-09-01');
    expect(parseDateLine('9/1/2025', now)).toBe('2025-09-01');
    expect(parseDateLine('2025-09-01', now)).toBe('2025-09-01');
    expect(parseDateLine('2/30', now)).toBeNull();
    expect(parseDateLine('13/1', now)).toBeNull();
    expect(parseDateLine('Denver', now)).toBeNull();
    expect(parseDateLine('Gyro 8', now)).toBeNull();
    expect(parseDateLine('', now)).toBeNull();
  });

  it('dates every rating in the block it sits in', () => {
    const text = "Zorba's\nDenver\nGyro 8\n  Fries 5\n9/1";
    const { ratings, errors } = parseText(text, categories, { now });
    expect(errors).toEqual([]);
    expect(ratings.map((r) => r.dateRated)).toEqual(['2026-09-01', '2026-09-01']);
  });

  it('leaves the date blank when no line says one', () => {
    const { ratings } = parseText("Zorba's\nDenver\nGyro 8", categories, { now });
    expect(ratings[0].dateRated).toBe('');
  });

  it('dates only its own block', () => {
    const text = "Zorba's\nGyro 8\n9/1\n\nPho Place\nPho 9";
    const { ratings } = parseText(text, categories, { now });
    expect(ratings.map((r) => r.dateRated)).toEqual(['2026-09-01', '']);
  });

  it('does not take the location slot', () => {
    const { ratings } = parseText("Zorba's\n9/1\nDenver\nGyro 8", categories, { now });
    expect(ratings[0]).toMatchObject({ location: 'Denver', dateRated: '2026-09-01' });
  });

  it('is still a plain rating line when a date has words after it', () => {
    const { errors } = parseText("Zorba's\nDenver\nGyro 8\n9/1 stuff", categories, { now });
    expect(errors).toHaveLength(1);
  });

  it('writes the date at the bottom of the block, dropping the year when it is this one', () => {
    const ratings = [
      { id: 'a', restaurantName: 'Z', specifier: 'Gyro', score: '8', dateRated: '2026-09-01' },
      { id: 'b', restaurantName: 'Pho', specifier: 'Pho', score: '9', dateRated: '2025-03-04' },
    ];
    expect(generateText(ratings, categories, { now })).toBe('Z\nGyro 8\n9/1\n\nPho\nPho 9\n3/4/2025');
  });

  it('leaves out a date that is just today', () => {
    const ratings = [{ id: 'a', restaurantName: 'Z', specifier: 'Gyro', score: '8', dateRated: '2026-09-07' }];
    expect(generateText(ratings, categories, { now })).toBe('Z\nGyro 8');
  });

  it('splits a block when two ratings of one visit carry different dates', () => {
    const ratings = [
      { id: 'a', restaurantName: 'Z', location: 'Denver', specifier: 'Gyro', score: '8', dateRated: '2026-09-01' },
      { id: 'b', restaurantName: 'Z', location: 'Denver', specifier: 'Fries', score: '5', dateRated: '2026-09-02' },
    ];
    expect(generateText(ratings, categories, { now }))
      .toBe('Z\nDenver\nGyro 8\n9/1\n\nZ\nDenver\nFries 5\n9/2');
  });

  it('round-trips a dated block', () => {
    const ratings = [
      { id: 'a', restaurantName: 'Z', location: 'Denver', specifier: 'Gyro', score: '8', ratingCategory: 'c-greek', additionalInfo: 'tender', dateRated: '2025-09-01' },
    ];
    const text = generateText(ratings, categories, { now });
    const { ratings: reparsed } = parseText(text, categories, { now });
    expect(reparsed[0]).toMatchObject({
      restaurantName: 'Z',
      location: 'Denver',
      specifier: 'Gyro',
      score: '8',
      ratingCategory: 'c-greek',
      additionalInfo: 'tender',
      dateRated: '2025-09-01',
    });
  });
});
