import { describe, it, expect } from 'vitest';
import {
  applyFilters,
  expandSearchTerm,
  parseFilterText,
  parseSearchVocabulary,
  serializeFilters,
} from './filterLogic';

function filter(field, op, value, extra = {}) {
  return { id: Math.random(), field, op, value, caseSensitive: false, useRegex: false, connector: 'AND', ...extra };
}

const entries = [
  { uuid: '1', restaurantName: 'Crema', specifier: 'Cortado', location: '16th, Denver' },
  { uuid: '2', restaurantName: 'Sushi Den', specifier: 'Roll', location: 'Denver' },
  { uuid: '3', restaurantName: 'Rudy', specifier: 'Burger', location: 'Colorado Springs' },
  { uuid: '4', restaurantName: 'Pecs Cafe', specifier: 'Soup', location: 'Pecs' },
  { uuid: '5', restaurantName: 'Denverton Diner', specifier: 'Eggs', location: 'Denverton' },
];
const ids = (list) => list.map((e) => e.uuid);

describe('Location =', () => {
  it('matches any comma-separated part, not only the whole', () => {
    expect(ids(applyFilters(entries, [filter('location', 'equals', 'Denver')], []))).toEqual(['1', '2']);
  });

  it('still wants a whole part — Denver is not Denverton', () => {
    expect(ids(applyFilters(entries, [filter('location', 'equals', 'Denver')], []))).not.toContain('5');
  });

  it('still matches the whole string', () => {
    expect(ids(applyFilters(entries, [filter('location', 'equals', '16th, Denver')], []))).toEqual(['1']);
  });
});

describe('search vocabulary', () => {
  const vocabulary = parseSearchVocabulary([
    'CS = Colorado Springs',
    'Denver > CO > US',
    'Colorado Springs > CO',
  ].join('\n'));

  it('expands an alias both ways', () => {
    expect(expandSearchTerm(vocabulary, 'cs', 'location')).toEqual(['colorado springs']);
    expect(expandSearchTerm(vocabulary, 'Colorado Springs', 'restaurantName')).toEqual(['cs']);
  });

  it('expands a place to everything inside it, for place fields only', () => {
    expect(expandSearchTerm(vocabulary, 'US', 'location').sort())
      .toEqual(['co', 'colorado springs', 'cs', 'denver']);
    expect(expandSearchTerm(vocabulary, 'CO', 'specifier')).toEqual([]);
  });

  it('knows nothing about words it was not told', () => {
    expect(expandSearchTerm(vocabulary, 'Boulder', 'location')).toEqual([]);
    expect(expandSearchTerm(null, 'CS', 'location')).toEqual([]);
  });

  it('finds entries by alias', () => {
    const withShortName = [...entries, { uuid: '6', restaurantName: 'Bird', specifier: 'Taco', location: 'CS' }];
    const found = applyFilters(withShortName, [filter('location', 'contains', 'Colorado Springs')], [], '', { vocabulary });
    expect(ids(found)).toEqual(['3', '6']);
  });

  it('matches an alias as a whole word, so CS does not find Pecs', () => {
    const cafes = parseSearchVocabulary('CS = Coffee Shop');
    const found = applyFilters(entries, [filter('any', 'contains', 'Coffee Shop')], [], '', { vocabulary: cafes });
    expect(ids(found)).toEqual([]);
  });

  it('finds everything inside a place, including a part of a location list', () => {
    const found = applyFilters(entries, [filter('location', 'equals', 'CO')], [], '', { vocabulary });
    expect(ids(found)).toEqual(['1', '2', '3']);
  });

  it('negates the widened search for not contains', () => {
    const found = applyFilters(entries, [filter('location', 'notContains', 'CO')], [], '', { vocabulary });
    expect(ids(found)).toEqual(['4', '5']);
  });

  it('never widens a regex', () => {
    const found = applyFilters(entries, [filter('location', 'contains', '^CS$', { useRegex: true })], [], '', { vocabulary });
    expect(found).toEqual([]);
  });
});

describe('copying and pasting filters', () => {
  it('round-trips a flat chain with connectors', () => {
    const original = [
      filter('restaurantName', 'contains', 'Pizza Hut'),
      filter('location', 'equals', 'Denver', { connector: 'OR' }),
      filter('score', 'ratingGreaterOrEqual', '8'),
    ];
    const text = serializeFilters(original);
    expect(text).toBe('Restaurant/Brand contains "Pizza Hut" OR Location = "Denver" AND Rating ≥ "8"');

    const pasted = parseFilterText(text);
    expect(pasted.logic).toBe('');
    expect(pasted.filters.map(({ field, op, value, connector }) => ({ field, op, value, connector }))).toEqual([
      { field: 'restaurantName', op: 'contains', value: 'Pizza Hut', connector: 'AND' },
      { field: 'location', op: 'equals', value: 'Denver', connector: 'OR' },
      { field: 'score', op: 'ratingGreaterOrEqual', value: '8', connector: 'AND' },
    ]);
  });

  it('keeps parentheses as custom logic', () => {
    const text = '(Restaurant/Brand contains "Pizza Hut" OR Restaurant/Brand contains "Dominos") AND Category contains "Pizza"';
    const pasted = parseFilterText(text);
    expect(pasted.error).toBeUndefined();
    expect(pasted.filters).toHaveLength(3);
    expect(pasted.logic).toBe(text);
  });

  it('carries case-sensitive and regex through the [tags]', () => {
    const original = [filter('specifier', 'contains', '^Gyro', { useRegex: true, caseSensitive: true })];
    const text = serializeFilters(original);
    expect(text).toBe('Food Name contains "^Gyro" [case regex]');
    expect(parseFilterText(text).filters[0]).toMatchObject({ useRegex: true, caseSensitive: true, value: '^Gyro' });
  });

  it('reads filters that take no value, and values with quotes in them', () => {
    const pasted = parseFilterText('Notes is empty AND Food Name = "the "big" one"');
    expect(pasted.filters.map((f) => [f.op, f.value])).toEqual([['isEmpty', ''], ['equals', 'the "big" one']]);
  });

  it('explains what it could not read', () => {
    expect(parseFilterText('').error).toBeTruthy();
    expect(parseFilterText('Flavor contains "x"').error).toMatch(/field/);
    expect(parseFilterText('Location = Denver').error).toMatch(/quoted/);
    expect(parseFilterText('Location = "Denver" AND').error).toMatch(/ends/);
  });
});
