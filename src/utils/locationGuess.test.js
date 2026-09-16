import { describe, it, expect } from 'vitest';
import { areaAndCity, chooseAutoLocation, distanceKm, nameLocation, nearestPlace } from './locationGuess';
import { applyAutoLocations } from '../components/Entries/AddEditEntryModal';

const known = ['Hampden, Denver', 'Central Market, Denver', '16th, Denver', 'Brighton', 'Aurora'];

describe('naming a place in your own words', () => {
  it('takes the finest area and the town from an OpenStreetMap address', () => {
    expect(areaAndCity({ neighbourhood: 'Hampden', suburb: 'Southeast', city: 'Denver' }))
      .toEqual({ area: 'Hampden', city: 'Denver' });
    expect(areaAndCity({ town: 'Brighton' })).toEqual({ area: '', city: 'Brighton' });
  });

  it('uses the location you already wrote for that area and city', () => {
    expect(nameLocation({ neighbourhood: 'hampden', city: 'Denver' }, known)).toBe('Hampden, Denver');
  });

  it('uses a location of yours for a city with no area', () => {
    expect(nameLocation({ town: 'Brighton' }, known)).toBe('Brighton');
  });

  it('builds "Area, City" when you have never written it', () => {
    expect(nameLocation({ suburb: 'Five Points', city: 'Denver' }, known)).toBe('Five Points, Denver');
    expect(nameLocation({ city: 'Tucson' }, known)).toBe('Tucson');
    expect(nameLocation({}, known)).toBe('');
  });
});

describe('the nearest branch', () => {
  const here = { lat: 39.7392, lon: -104.9903 }; // Denver

  it('measures distance on the globe', () => {
    const boulder = distanceKm(here.lat, here.lon, 40.015, -105.2705);
    expect(boulder).toBeGreaterThan(35);
    expect(boulder).toBeLessThan(45);
  });

  it('picks the closest result', () => {
    const results = [
      { name: 'In-N-Out', lat: 39.9853, lon: -104.8205 }, // Brighton, ~30 km
      { name: 'In-N-Out', lat: 39.6133, lon: -104.8761 }, // Aurora, ~17 km
    ];
    expect(nearestPlace(results, here.lat, here.lon, 50)).toMatchObject({ lat: 39.6133 });
  });

  it('prefers somewhere that serves food over a closer namesake', () => {
    const results = [
      { name: 'In-N-Out Car Wash', category: 'amenity', type: 'car_wash', lat: 39.74, lon: -104.99 },
      { name: 'In-N-Out Burger', category: 'amenity', type: 'fast_food', lat: 39.6133, lon: -104.8761 },
    ];
    expect(nearestPlace(results, here.lat, here.lon)).toMatchObject({ name: 'In-N-Out Burger' });
    // With nothing food-shaped in the results, the closest of them still counts.
    expect(nearestPlace([results[0]], here.lat, here.lon)).toMatchObject({ name: 'In-N-Out Car Wash' });
  });

  it('finds nothing when every result is too far away', () => {
    expect(nearestPlace([{ lat: 32.2226, lon: -110.9747 }], here.lat, here.lon)).toBeNull();
    expect(nearestPlace([], here.lat, here.lon)).toBeNull();
  });

  it('prefers a nearby branch, then where you last rated it, then where you are', () => {
    expect(chooseAutoLocation({ branch: 'Aurora', history: 'Brighton', here: 'Hampden, Denver' })).toBe('Aurora');
    expect(chooseAutoLocation({ branch: '', history: 'Brighton', here: 'Hampden, Denver' })).toBe('Brighton');
    expect(chooseAutoLocation({ here: 'Hampden, Denver' })).toBe('Hampden, Denver');
    expect(chooseAutoLocation({})).toBe('');
  });
});

describe('filling guessed locations into a form', () => {
  function makeForm(overrides = {}, additionalRatings = []) {
    return {
      restaurantName: 'In-N-Out', specifier: 'Fries', location: '', dateRated: '2026-09-16', additionalInfo: '', picture: '',
      primaryRating: { ratingCategory: '', newCategoryName: null, score: '7' },
      additionalRatings,
      ...overrides,
    };
  }
  function rating(id, overrides = {}) {
    return {
      id, groupId: String(id), isIdentical: false, linkParentId: null, linkedFields: [],
      restaurantName: 'Izzio', specifier: 'Tart', location: '', dateRated: '2026-09-16',
      additionalInfo: '', picture: '', score: '9', ratingCategory: '', newCategoryName: null, ...overrides,
    };
  }
  const guesses = { 'In-N-Out': 'Aurora', Izzio: 'Central Market, Denver' };
  const suggestFor = (name) => guesses[name] || 'Hampden, Denver';

  it('fills every new rating that has no location', () => {
    const { form, lastAuto } = applyAutoLocations(makeForm({}, [rating(1)]), suggestFor, new Map());
    expect(form.location).toBe('Aurora');
    expect(form.additionalRatings[0].location).toBe('Central Market, Denver');
    expect(lastAuto.get('primary')).toBe('Aurora');
  });

  it('never replaces a location you typed', () => {
    const { form } = applyAutoLocations(makeForm({ location: '16th, Denver' }), suggestFor, new Map());
    expect(form.location).toBe('16th, Denver');
  });

  it('replaces its own earlier guess once a better one lands', () => {
    const first = applyAutoLocations(makeForm(), () => 'Hampden, Denver', new Map());
    expect(first.form.location).toBe('Hampden, Denver');
    const second = applyAutoLocations(first.form, suggestFor, first.lastAuto);
    expect(second.form.location).toBe('Aurora');
  });

  it('refills a guess the text box blanked, but not one you changed', () => {
    const first = applyAutoLocations(makeForm(), suggestFor, new Map());
    const blanked = applyAutoLocations({ ...first.form, location: '' }, suggestFor, first.lastAuto);
    expect(blanked.form.location).toBe('Aurora');
    const changed = applyAutoLocations({ ...first.form, location: 'Brighton' }, suggestFor, first.lastAuto);
    expect(changed.form.location).toBe('Brighton');
  });

  it('leaves saved entries alone: the entry being edited and ratings already stored', () => {
    const saved = rating(2, { originalUuid: 'u-2' });
    const { form } = applyAutoLocations(makeForm({}, [saved]), suggestFor, new Map(), { isEdit: true });
    expect(form.location).toBe('');
    expect(form.additionalRatings[0].location).toBe('');
  });

  it('returns the very same form when there is nothing to fill', () => {
    const full = makeForm({ location: 'Aurora' });
    expect(applyAutoLocations(full, suggestFor, new Map([['primary', 'Aurora']])).form).toBe(full);
    expect(applyAutoLocations(makeForm(), () => '', new Map()).form.location).toBe('');
  });
});
