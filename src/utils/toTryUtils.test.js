import { describe, it, expect } from 'vitest';
import {
  findSimilarItems,
  makeToTryItem,
  namesMatch,
  openItemsMatchingRating,
  parseToTryDoc,
  ratingPrefillFromItem,
  readHeaderLine,
  statusOf,
  toSavableItem,
} from './toTryUtils';

const categories = ['Food', 'Coffee', 'Pizza', 'Dessert', 'Breakfast', 'Ice cream'].map((name) => ({
  uuid: `c-${name}`, restaurantName: name, ratingCategory: name === 'Food' ? '' : 'c-Food',
}));
const foodEntries = [
  { restaurantName: 'Dutch Bros', location: 'Denver' },
  { restaurantName: 'Crema', location: 'Larimer, Denver' },
];
const data = { categories, foodEntries, toTryItems: [] };

const DOC = [
  'Denver: (M = go with Sam)',
  '',
  'Coffee:',
  'La Dolce Vita  - coffee shop 6:30-5',
  'M Guard Grill (chef\'s counter) - steak',
  'Dessert:',
  'Bakeries:',
  'Voodoo Donuts - grape',
  'Larimer:',
  'STK',
  'Frozen pizza:',
  'Red Baron - small deep dish',
  'Seoul Station - <https://maps.example/abc>',
  'Dutch Bros:',
  'Coffee (all blended):',
  'Og grand canyon',
  'Tucson:',
  'D Baggins - sundown, rum cake',
  'DD - Casa Rio (best quesadillas)',
  'D Sauce',
  'DD - Amy\'s Donuts',
  '7-11: Churro donut',
  'Denver Poke Co - \\#79 on Yelp',
  'Limited Time Gone:',
  'Shake Shack - brownie milkshake',
].join('\n');

function byName(items, name) {
  return items.find((i) => i.restaurantName === name || i.specifier === name);
}

describe('reading a to-try doc', () => {
  const { headers, codes, items } = parseToTryDoc(DOC, data, { codeTags: { D: 'DoorDash', DD: 'DoorDash' } });

  it('recognizes header lines, including a legend after the colon', () => {
    expect(readHeaderLine('Denver: (M = go with Sam)')).toEqual({ name: 'Denver', legend: 'M = go with Sam' });
    expect(readHeaderLine('Centennial - ')).toEqual({ name: 'Centennial', legend: '' });
    expect(readHeaderLine('Zaidy\'s deli - 7:30-4 (maybe)')).toBeNull();
    expect(readHeaderLine('7-11: Churro donut')).toBeNull();
  });

  it('finds prefix codes from the legend and from repeats', () => {
    expect(codes).toEqual([
      { code: 'D', meaning: '', count: 2 },
      { code: 'DD', meaning: '', count: 2 },
      { code: 'M', meaning: 'go with Sam', count: 1 },
    ]);
  });

  it('guesses what each header is', () => {
    const kinds = Object.fromEntries(headers.map((h) => [h.name, h.kind]));
    expect(kinds).toMatchObject({
      Denver: 'place',
      Coffee: 'genre',
      Dessert: 'genre',
      Bakeries: 'genre',
      Larimer: 'area',
      'Frozen pizza': 'genre',
      'Dutch Bros': 'brand',
      'Coffee (all blended)': 'sublist',
      Tucson: 'place',
      'Limited Time Gone': 'gone',
    });
  });

  it('splits name from notes and files it under its place and genre', () => {
    expect(byName(items, 'La Dolce Vita')).toMatchObject({
      entryType: 'totry', location: 'Denver', ratingCategory: 'c-Coffee', additionalInfo: 'coffee shop 6:30-5', status: '',
    });
  });

  it('turns a prefix code into a tag and a trailing parenthetical into a note', () => {
    expect(byName(items, 'Guard Grill')).toMatchObject({ tags: ['go with Sam'], additionalInfo: "chef's counter — steak" });
    expect(byName(items, 'Casa Rio')).toMatchObject({ tags: ['DoorDash'], additionalInfo: 'best quesadillas', location: 'Tucson' });
  });

  it('keeps an outer genre as the category when the inner one is not a category', () => {
    expect(byName(items, 'Voodoo Donuts')).toMatchObject({ ratingCategory: 'c-Dessert', tags: ['Bakeries'] });
  });

  it('puts an area inside its place, and matches a genre by its last word', () => {
    expect(byName(items, 'STK').location).toBe('Larimer, Denver');
    expect(byName(items, 'Red Baron')).toMatchObject({ ratingCategory: 'c-Pizza', tags: ['Frozen pizza'] });
  });

  it('keeps a link with the line it is on, unescaped', () => {
    expect(byName(items, 'Seoul Station').additionalInfo).toBe('https://maps.example/abc');
    expect(byName(items, 'Denver Poke Co').additionalInfo).toBe('#79 on Yelp');
  });

  it('lists a brand\'s lines as its foods, with no place', () => {
    expect(byName(items, 'Og grand canyon')).toMatchObject({
      restaurantName: 'Dutch Bros', specifier: 'Og grand canyon', location: '', ratingCategory: 'c-Coffee',
    });
  });

  it('reads "Name: food" when there is no dash', () => {
    expect(byName(items, '7-11')).toMatchObject({ additionalInfo: 'Churro donut' });
  });

  it('marks everything under a gone header as gone, placeless', () => {
    expect(byName(items, 'Shake Shack')).toMatchObject({ status: 'gone', location: '' });
  });

  it('lets a corrected header kind change what follows it', () => {
    expect(byName(items, 'STK').location).toBe('Larimer, Denver');
    const fixed = parseToTryDoc(DOC, data, { headerKinds: { larimer: 'ignore' } });
    // Ignored, Larimer is just a label: STK is back to plain Denver.
    expect(byName(fixed.items, 'STK').location).toBe('Denver');
    expect(fixed.headers.find((h) => h.key === 'larimer')).toMatchObject({ kind: 'ignore', guessed: 'area' });
  });

  it('flags repeats within the paste and against the saved list', () => {
    const doc = 'Denver:\nMikawaya - mochi\nMikwaya - mochi again\nBig Sky Burger';
    const saved = [makeToTryItem({ uuid: 's1', restaurantName: 'Big Sky Burger' })];
    const parsed = parseToTryDoc(doc, { ...data, toTryItems: saved });
    expect(parsed.items.map((i) => i.duplicateOf)).toEqual([null, 'line 2', 'existing']);
  });

  it('strips preview bookkeeping before saving', () => {
    const saved = toSavableItem(items[0]);
    expect(saved).not.toHaveProperty('lineNumber');
    expect(saved).not.toHaveProperty('duplicateOf');
    expect(saved.entryType).toBe('totry');
  });
});

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
