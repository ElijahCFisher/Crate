import { describe, it, expect } from 'vitest';
import {
  findSimilarItems,
  makeToTryItem,
  namesMatch,
  openItemsMatchingRating,
  ratingPrefillFromItem,
  statusOf,
} from './toTryUtils';

describe('to-try matching', () => {
  it('forgives a typo only in names long enough for it to be one', () => {
    expect(namesMatch('Mikawaya', 'Mikwaya', { fuzzy: true })).toBe(true);
    expect(namesMatch('Tokio', 'Tokyo', { fuzzy: true })).toBe(false);
    expect(namesMatch("Zaidy's Deli", 'zaidy’s deli')).toBe(true);
  });

  it('finds the same place and food already on the list', () => {
    const items = [
      makeToTryItem({ uuid: 'a', restaurantName: 'Dutch Bros', specifier: 'Midnight' }),
      makeToTryItem({ uuid: 'b', restaurantName: 'Dutch Bros', specifier: 'Eclipse' }),
    ];
    expect(findSimilarItems(items, { restaurantName: 'dutch bros', specifier: 'midnight' }).map((i) => i.uuid)).toEqual(['a']);
    expect(findSimilarItems(items, { restaurantName: 'Dutch Bros', specifier: 'Midnight' }, 'a')).toEqual([]);
  });

  it('offers to tick off open items a new rating matches', () => {
    const items = [
      makeToTryItem({ uuid: 'place', restaurantName: 'Big Sky Burger' }),
      makeToTryItem({ uuid: 'dish', restaurantName: 'Zaidys', specifier: 'Challah french toast' }),
      makeToTryItem({ uuid: 'other-dish', restaurantName: 'Zaidys', specifier: 'Latkes' }),
      makeToTryItem({ uuid: 'done', restaurantName: 'Big Sky Burger', status: 'tried' }),
    ];
    expect(openItemsMatchingRating(items, { restaurantName: 'big sky burger', specifier: 'Cheeseburger' }).map((i) => i.uuid))
      .toEqual(['place']);
    expect(openItemsMatchingRating(items, { restaurantName: 'Zaidys', specifier: 'challah french toast' }).map((i) => i.uuid))
      .toEqual(['dish']);
  });

  it('reads a blank status as open and prefills a rating from an item', () => {
    expect(statusOf({ status: '' })).toBe('open');
    expect(statusOf({ status: 'gone' })).toBe('gone');
    const item = makeToTryItem({ restaurantName: 'Crema', specifier: 'Cortado', location: 'Denver', ratingCategory: 'c-Coffee', additionalInfo: 'hours 7-3' });
    expect(ratingPrefillFromItem(item)).toEqual({
      restaurantName: 'Crema', specifier: 'Cortado', location: 'Denver', ratingCategory: 'c-Coffee', score: null, additionalInfo: '',
    });
  });
});
