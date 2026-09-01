import { describe, expect, it } from 'vitest';
import {
  buildConvertPreview,
  CONVERT_PREVIEW_LIMIT,
} from './ConvertScalePanel';

const categories = [
  { uuid: 'root', restaurantName: 'Food', ratingCategory: '', score: '5' },
  { uuid: 'savory', restaurantName: 'Savory', ratingCategory: 'root', score: '5' },
  { uuid: 'pizza', restaurantName: 'Pizza', ratingCategory: 'savory', score: '5' },
  { uuid: 'dessert', restaurantName: 'Dessert', ratingCategory: 'root', score: '7' },
];

const pizzaEntries = Array.from({ length: 6 }, (_, idx) => ({
  uuid: `pizza-${idx + 1}`,
  restaurantName: 'Blue Pan',
  specifier: `Slice ${idx + 1}`,
  ratingCategory: 'pizza',
  categories: [],
  score: String(idx + 4),
}));

const categoryFilter = [
  { id: 1, field: 'ratingCategory', op: 'contains', value: 'Savory', connector: 'AND', caseSensitive: false, useRegex: false },
];

describe('buildConvertPreview', () => {
  it('shows the first five filter matches before a destination category is selected', () => {
    const preview = buildConvertPreview({
      foodEntries: pizzaEntries,
      filters: categoryFilter,
      filterLogic: '',
      categories,
      toUuid: '',
    });

    expect(preview.filteredEntries).toHaveLength(6);
    expect(preview.matches).toHaveLength(6);
    expect(preview.previewMatches.map(({ entry }) => entry.uuid))
      .toEqual(pizzaEntries.slice(0, CONVERT_PREVIEW_LIMIT).map((entry) => entry.uuid));
    expect(preview.changes).toEqual([]);
  });

  it('builds changes only after a destination category is selected', () => {
    const preview = buildConvertPreview({
      foodEntries: pizzaEntries,
      filters: categoryFilter,
      filterLogic: '',
      categories,
      toUuid: 'dessert',
    });

    expect(preview.changes).toHaveLength(6);
    expect(preview.changes[0]).toMatchObject({
      uuid: 'pizza-1',
      updates: { ratingCategory: 'dessert' },
    });
  });
});
