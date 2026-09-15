import { describe, it, expect } from 'vitest';
import {
  CATEGORY_FIELDS,
  applyFilters,
  countFilterSuggestions,
  narrowFilterSuggestions,
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

describe('filter value suggestions', () => {
  const pool = [
    { uuid: 'a', restaurantName: 'In-N-Out', specifier: 'Fries', location: 'Brighton' },
    { uuid: 'b', restaurantName: 'In-N-Out', specifier: 'Cheeseburger', location: 'Brighton' },
    { uuid: 'c', restaurantName: 'In-N-Out', specifier: 'Fries', location: '16th, Denver' },
    { uuid: 'd', restaurantName: 'Wendys', specifier: 'Frosty', location: 'Denver' },
  ];

  it('suggests values left over after the other filters, most common first', () => {
    const food = filter('specifier', 'contains', '');
    const place = filter('restaurantName', 'contains', 'In-N-Out');
    const counted = countFilterSuggestions(pool, [place, food], [], food.id);
    expect(counted.map((s) => [s.value, s.count])).toEqual([['Fries', 2], ['Cheeseburger', 1]]);
  });

  it('offers each part of a location list as well as the whole', () => {
    const place = filter('location', 'equals', '');
    const values = countFilterSuggestions(pool, [place], [], place.id).map((s) => s.value);
    expect(values).toEqual(expect.arrayContaining(['Denver', '16th', '16th, Denver', 'Brighton']));
    expect(values.filter((v) => v === 'Denver')).toHaveLength(1);
  });

  it('suggests nothing for fields where a list would not help', () => {
    const rating = filter('score', 'ratingEquals', '');
    expect(countFilterSuggestions(pool, [rating], [], rating.id)).toEqual([]);
  });

  it('narrows as you type, leaving out what you already typed in full', () => {
    const counted = [{ value: 'Fries', count: 2 }, { value: 'Frosty', count: 1 }, { value: 'Cheeseburger', count: 1 }];
    expect(narrowFilterSuggestions(counted, 'fr').map((s) => s.value)).toEqual(['Fries', 'Frosty']);
    expect(narrowFilterSuggestions(counted, 'fries').map((s) => s.value)).toEqual([]);
  });
});

describe('filtering categories', () => {
  const cats = [
    { uuid: 'food', restaurantName: 'Food', ratingCategory: '', score: null },
    { uuid: 'breakfast', restaurantName: 'Breakfast', ratingCategory: 'food', score: '7' },
    { uuid: 'b-egg', restaurantName: 'Egg', ratingCategory: 'breakfast', score: '8' },
    { uuid: 'side', restaurantName: 'Side', ratingCategory: 'food', score: '5' },
    { uuid: 's-egg', restaurantName: 'Egg', ratingCategory: 'side', score: '4' },
  ];
  const options = { fields: CATEGORY_FIELDS };

  it('Parent contains finds everything anywhere underneath; Parent = only direct children', () => {
    expect(ids(applyFilters(cats, [filter('ratingCategory', 'contains', 'Breakfast')], cats, '', options))).toEqual(['b-egg']);
    expect(ids(applyFilters(cats, [filter('ratingCategory', 'contains', 'Food')], cats, '', options)))
      .toEqual(['breakfast', 'b-egg', 'side', 's-egg']);
    expect(ids(applyFilters(cats, [filter('ratingCategory', 'equals', 'Food')], cats, '', options)))
      .toEqual(['breakfast', 'side']);
  });

  it('writes and reads logic in the category labels', () => {
    const rows = [
      filter('restaurantName', 'equals', 'Egg'),
      filter('ratingCategory', 'equals', 'Side', { connector: 'OR' }),
      filter('score', 'ratingGreater', '6'),
    ];
    const text = serializeFilters(rows, '', CATEGORY_FIELDS);
    expect(text).toBe('Name = "Egg" OR Parent = "Side" AND Score > "6"');

    const logic = '(Name = "Egg" OR Parent = "Side") AND Score > "6"';
    const pasted = parseFilterText(logic, CATEGORY_FIELDS);
    expect(pasted.error).toBeUndefined();
    expect(ids(applyFilters(cats, pasted.filters, cats, pasted.logic, options))).toEqual(['b-egg']);
  });

  it('does not read entry labels as category ones', () => {
    expect(parseFilterText('Restaurant/Brand contains "Egg"', CATEGORY_FIELDS).error).toMatch(/field/);
  });
});
