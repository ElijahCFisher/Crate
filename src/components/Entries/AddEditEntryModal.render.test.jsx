/**
 * Mounting tests for the entry dialog. The suite around it is all pure logic,
 * which can't catch a component that references something it never imported —
 * the build won't either, since this is plain JS. These render the real dialog
 * and read what's on screen.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import AddEditEntryModal from './AddEditEntryModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The dialog asks where the device is when it opens; these tests are about
// what's on screen, so there's nowhere to be.
vi.mock('../../services/geoService', () => ({
  getDevicePosition: () => Promise.reject(new Error('no geolocation in tests')),
  reverseGeocode: () => Promise.resolve(null),
  searchPlacesNear: () => Promise.resolve([]),
}));

const categories = [{ uuid: 'c-food', entryType: 'category', restaurantName: 'Food', ratingCategory: '' }];

const savedEntry = {
  uuid: 'e1',
  entryType: 'food',
  restaurantName: 'Crema',
  specifier: 'Latte',
  location: 'Larimer, Denver',
  coordinates: '39.76000, -104.98000',
  score: '8',
  dateRated: Date.UTC(2026, 8, 1),
  additionalInfo: '',
  picture: '',
  identicals: [],
  categories: ['c-food'],
  ratingCategory: 'c-food',
  linkedFields: {},
};

async function render(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AddEditEntryModal, {
      open: true,
      entry: null,
      categories,
      foodEntries: [savedEntry],
      onSave: () => {},
      onAddCategory: () => {},
      onClose: () => {},
      showAdvancedByDefault: true,
      ...props,
    }));
  });
  return {
    text: () => document.body.textContent,
    find: (selector) => document.body.querySelector(selector),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('the entry dialog on screen', () => {
  let cleanup = () => {};
  afterEach(() => { cleanup(); cleanup = () => {}; });

  it('opens with the location field and its location button', async () => {
    const view = await render({});
    cleanup = view.cleanup;
    expect(view.find('[aria-label="Use my current location"]')).toBeTruthy();
    expect(view.text()).toContain('Location');
  });

  it("shows a saved entry's coordinates under the location", async () => {
    const view = await render({ entry: savedEntry });
    cleanup = view.cleanup;
    expect(view.text()).toContain('39.76000, -104.98000');
    expect(view.find('[aria-label="Forget coordinates"]')).toBeTruthy();
  });

  it('forgets the coordinates when asked, leaving the location', async () => {
    const view = await render({ entry: savedEntry });
    cleanup = view.cleanup;
    await act(async () => {
      view.find('[aria-label="Forget coordinates"]').click();
    });
    expect(view.text()).not.toContain('39.76000, -104.98000');
    expect(view.find('input[value="Larimer, Denver"]')).toBeTruthy();
  });
});
