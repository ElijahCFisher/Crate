import { describe, it, expect } from 'vitest';
import {
  buildRestaurantLocations,
  locationsForRestaurant,
  orderLocationSuggestions,
} from './restaurantLocations';

const entries = [
  { restaurantName: 'In-N-Out', location: 'Brighton', dateRated: 300 },
  { restaurantName: 'In-N-Out', location: 'Aurora', dateRated: 100 },
  { restaurantName: 'in-n-out ', location: 'brighton', dateRated: 50 },
  { restaurantName: 'In-N-Out', location: 'Denver', dateRated: 200 },
  { restaurantName: 'Crema', location: '16th, Denver', dateRated: 10 },
  { restaurantName: 'Oreo', location: '', dateRated: 400 },
];

describe('restaurant locations', () => {
  const byRestaurant = buildRestaurantLocations(entries);

  it('lists a restaurant\'s locations newest visit first, ignoring case and repeats', () => {
    expect(locationsForRestaurant(byRestaurant, 'IN-N-OUT')).toEqual(['Brighton', 'Denver', 'Aurora']);
  });

  it('knows nothing for a restaurant with no location on record', () => {
    expect(locationsForRestaurant(byRestaurant, 'Oreo')).toEqual([]);
    expect(locationsForRestaurant(byRestaurant, 'Nowhere')).toEqual([]);
  });

  it('puts the restaurant\'s own locations at the top of the suggestions', () => {
    const all = ['16th, Denver', 'Aurora', 'Boulder', 'Brighton', 'Denver'];
    expect(orderLocationSuggestions(all, byRestaurant, 'In-N-Out'))
      .toEqual(['Brighton', 'Denver', 'Aurora', '16th, Denver', 'Boulder']);
    expect(orderLocationSuggestions(all, byRestaurant, '')).toBe(all);
  });
});
