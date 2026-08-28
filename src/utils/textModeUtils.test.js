import { describe, it, expect } from 'vitest';
import {
  buildCategoryIndex,
  resolveCategoryPhrase,
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
