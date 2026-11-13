/**
 * Mounts the entry dialog with a location lookup that always knows where you
 * are, to check that ratings written in the Text tab never get it filled in —
 * one restaurant or several — while the form still does.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const here = { location: 'Hampden, Denver', coordinates: '39.65432, -104.91234' };
vi.mock('../../hooks/useAutoLocation', async (importOriginal) => {
  const actual = await importOriginal();
  const suggestFor = () => here;
  const request = () => {};
  const locate = async () => here;
  return {
    ...actual,
    useAutoLocation: () => ({ here, ready: true, locate, request, suggestFor, version: 0 }),
  };
});
vi.mock('../../services/geoService', () => ({
  getDevicePosition: () => Promise.reject(new Error('no geolocation in tests')),
  reverseGeocode: () => Promise.resolve(null),
  searchPlacesNear: () => Promise.resolve([]),
}));

const { default: AddEditEntryModal } = await import('./AddEditEntryModal');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const categories = [{ uuid: 'c-food', entryType: 'category', restaurantName: 'Food', ratingCategory: '' }];

/** Past the dialog's 700 ms pause before it guesses. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 800)));

let cleanup = () => {};
afterEach(() => { cleanup(); cleanup = () => {}; });

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AddEditEntryModal, {
      open: true, entry: null, categories, foodEntries: [],
      onSave: () => {}, onAddCategory: () => {}, onClose: () => {},
      showAdvancedByDefault: true,
    }));
  });
  cleanup = () => { act(() => root.unmount()); container.remove(); };
}

const tab = (name) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name);
const locationInputs = () => [...document.querySelectorAll('input[placeholder="e.g. Denver"]')];
const textBox = () => document.querySelector('textarea:not([aria-hidden])');

async function writeInTextTab(text) {
  await act(async () => { tab('Text').click(); });
  const box = textBox();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await act(async () => { tab('Form').click(); });
  await settle();
}

describe('locations and the Text tab', () => {
  it('the form on its own does fill in where you are', async () => {
    await render();
    await settle();
    expect(locationInputs()[0].value).toBe('Hampden, Denver');
  });

  it("doesn't put that guess into the text box", async () => {
    await render();
    const restaurant = document.querySelector('input[role="combobox"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setValue.call(restaurant, 'Zorbas');
      restaurant.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    expect(locationInputs()[0].value).toBe('Hampden, Denver');
    await act(async () => { tab('Text').click(); });
    expect(textBox().value).toContain('Zorbas');
    expect(textBox().value).not.toContain('Hampden');
  });

  it('leaves a pasted restaurant with no location line without one', async () => {
    await render();
    await settle();
    await writeInTextTab(['Zorbas', 'Gyro 8'].join('\n'));
    expect(locationInputs().map((i) => i.value)).toEqual(['']);
  });

  it('leaves several pasted restaurants without one', async () => {
    await render();
    await writeInTextTab(['Zorbas', 'Gyro 8', '', 'Izzio', 'Tart 9', '', 'In-N-Out', 'Fries 7'].join('\n'));
    const values = locationInputs().map((i) => i.value);
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values.every((v) => v === '')).toBe(true);
  });

  it('keeps the location lines that were written', async () => {
    await render();
    await writeInTextTab(['Zorbas', 'Denver', 'Gyro 8', '', 'Izzio', 'Tart 9'].join('\n'));
    expect(locationInputs().map((i) => i.value)).toEqual(['Denver', '']);
  });
});
