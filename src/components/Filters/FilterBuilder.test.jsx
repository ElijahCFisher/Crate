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
