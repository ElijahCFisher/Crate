import { describe, expect, it } from 'vitest';
import {
  applyFilterGroup,
  applyFilters,
  buildDefaultFilterLogic,
  describeFilterGroup,
  getFilterLogicState,
  remapFilterLogic,
  splitFiltersIntoOrGroups,
} from './FilterBuilder';

const categories = [
  { uuid: 'cat-pizza', restaurantName: 'Pizza' },
];

const filters = [
  { id: 1, field: 'restaurantName', op: 'contains', value: 'Pizza Hut', connector: 'AND', caseSensitive: false, useRegex: false },
  { id: 2, field: 'ratingCategory', op: 'contains', value: 'Pizza', connector: 'AND', caseSensitive: false, useRegex: false },
  { id: 3, field: 'restaurantName', op: 'contains', value: 'Dominos', connector: 'OR', caseSensitive: false, useRegex: false },
  { id: 4, field: 'ratingCategory', op: 'contains', value: 'Pizza', connector: 'AND', caseSensitive: false, useRegex: false },
];

const entries = [
  { uuid: '1', restaurantName: 'Pizza Hut', specifier: 'Pepperoni', ratingCategory: 'cat-pizza', score: '8' },
  { uuid: '2', restaurantName: 'Dominos', specifier: 'Cheese', ratingCategory: 'cat-pizza', score: '6' },
  { uuid: '3', restaurantName: 'Pizza Hut', specifier: 'Pasta', ratingCategory: '', score: '9' },
  { uuid: '4', restaurantName: 'Other', specifier: 'Pizza', ratingCategory: 'cat-pizza', score: '10' },
];

describe('filter OR groups', () => {
  it('splits filters into OR clauses and applies each clause as AND filters', () => {
    const groups = splitFiltersIntoOrGroups(filters);

    expect(groups).toHaveLength(2);
    expect(applyFilterGroup(entries, groups[0], categories).map((entry) => entry.uuid)).toEqual(['1']);
    expect(applyFilterGroup(entries, groups[1], categories).map((entry) => entry.uuid)).toEqual(['2']);
  });

  it('applies filters as a union of OR clauses', () => {
    expect(applyFilters(entries, filters, categories).map((entry) => entry.uuid)).toEqual(['1', '2']);
  });

  it('describes OR clauses for display', () => {
    const groups = splitFiltersIntoOrGroups(filters);

    expect(describeFilterGroup(groups[0])).toBe('Restaurant/Brand contains "Pizza Hut" AND Category contains "Pizza"');
    expect(describeFilterGroup(groups[1])).toBe('Restaurant/Brand contains "Dominos" AND Category contains "Pizza"');
  });

  it('supports parenthesized manual logic', () => {
    const logic = '(Restaurant/Brand contains "Pizza Hut" OR Restaurant/Brand contains "Dominos") AND Category contains "Pizza"';

    expect(getFilterLogicState(filters, logic).valid).toBe(true);
    expect(applyFilters(entries, filters, categories, logic).map((entry) => entry.uuid)).toEqual(['1', '2']);
  });

  it('builds default logic from full filter text', () => {
    expect(buildDefaultFilterLogic(filters)).toBe(
      'Restaurant/Brand contains "Pizza Hut" AND Category contains "Pizza" OR Restaurant/Brand contains "Dominos" AND Category contains "Pizza"'
    );
  });

  it('remaps manual logic when a filter changes', () => {
    const nextFilters = filters.map((filter) =>
      filter.id === 3 ? { ...filter, value: 'Dominoes' } : filter
    );

    expect(
      remapFilterLogic('Restaurant/Brand contains "Pizza Hut" OR Restaurant/Brand contains "Dominos"', filters, nextFilters)
    ).toBe('Restaurant/Brand contains "Pizza Hut" OR Restaurant/Brand contains "Dominoes"');
  });
});

describe('category filters', () => {
  it('matches ancestor category names from the live category tree when the entry cache is empty', () => {
    const nestedCategories = [
      { uuid: 'root', restaurantName: 'Food', ratingCategory: '' },
      { uuid: 'savory', restaurantName: 'Savory', ratingCategory: 'root' },
      { uuid: 'pizza', restaurantName: 'Pizza', ratingCategory: 'savory' },
    ];
    const nestedEntries = [
      {
        uuid: 'nested-entry',
        restaurantName: 'Blue Pan',
        specifier: 'Slice',
        ratingCategory: 'pizza',
        categories: [],
        score: '8',
      },
    ];
    const categoryFilter = [
      { id: 1, field: 'ratingCategory', op: 'contains', value: 'Savory', connector: 'AND', caseSensitive: false, useRegex: false },
    ];

    expect(applyFilters(nestedEntries, categoryFilter, nestedCategories).map((entry) => entry.uuid))
      .toEqual(['nested-entry']);
  });

  it('matches equals against an individual category name, not the full ancestor string', () => {
    const nestedCategories = [
      { uuid: 'root', restaurantName: 'Food', ratingCategory: '' },
      { uuid: 'breakfast', restaurantName: 'Breakfast', ratingCategory: 'root' },
      { uuid: 'pancakes', restaurantName: 'Pancakes', ratingCategory: 'breakfast' },
    ];
    const nestedEntries = [
      {
        uuid: 'pancake-entry',
        restaurantName: 'Snooze',
        specifier: 'Stack',
        ratingCategory: 'pancakes',
        categories: [],
        score: '8',
      },
    ];
    const categoryFilter = [
      { id: 1, field: 'ratingCategory', op: 'equals', value: 'Breakfast', connector: 'AND', caseSensitive: false, useRegex: false },
    ];

    expect(applyFilters(nestedEntries, categoryFilter, nestedCategories).map((entry) => entry.uuid))
      .toEqual(['pancake-entry']);
  });
});

describe('rating filters', () => {
  const ratingFilter = (op, value) => ([
    { id: 1, field: 'score', op, value, connector: 'AND', caseSensitive: false, useRegex: false },
  ]);

  it('filters by equals', () => {
    expect(applyFilters(entries, ratingFilter('ratingEquals', '8'), categories).map((e) => e.uuid)).toEqual(['1']);
  });

  it('filters by not equals', () => {
    expect(applyFilters(entries, ratingFilter('ratingNotEquals', '8'), categories).map((e) => e.uuid)).toEqual(['2', '3', '4']);
  });

  it('filters by greater than', () => {
    expect(applyFilters(entries, ratingFilter('ratingGreater', '8'), categories).map((e) => e.uuid)).toEqual(['3', '4']);
  });

  it('filters by greater than or equal', () => {
    expect(applyFilters(entries, ratingFilter('ratingGreaterOrEqual', '8'), categories).map((e) => e.uuid)).toEqual(['1', '3', '4']);
  });

  it('filters by less than', () => {
    expect(applyFilters(entries, ratingFilter('ratingLess', '8'), categories).map((e) => e.uuid)).toEqual(['2']);
  });

  it('filters by less than or equal', () => {
    expect(applyFilters(entries, ratingFilter('ratingLessOrEqual', '8'), categories).map((e) => e.uuid)).toEqual(['1', '2']);
  });
});
