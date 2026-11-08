/**
 * Mounts the entries table to check selecting rows for a bulk edit: the boxes
 * stay ticked across pages and the header box takes every result. What the
 * edit writes (including rebalancing) is covered in utils/bulkEdit.test.js.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EntryTable from './EntryTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../DriveImage', () => ({ default: () => null }));

const categories = [
  { uuid: 'root', entryType: 'category', restaurantName: 'Food', ratingCategory: '', score: '5', categories: [] },
  { uuid: 'harsh', entryType: 'category', restaurantName: 'Harsh', ratingCategory: 'root', score: '8', categories: ['root'] },
  { uuid: 'kind', entryType: 'category', restaurantName: 'Kind', ratingCategory: 'root', score: '3', categories: ['root'] },
];

const entries = Array.from({ length: 25 }, (_, i) => ({
  uuid: `e${i}`,
  entryType: 'food',
  restaurantName: `Place ${i}`,
  specifier: 'Thing',
  location: '',
  score: '7',
  dateRated: Date.UTC(2026, 0, 1) + i * 86400000,
  additionalInfo: '',
  picture: '',
  identicals: [],
  categories: ['harsh', 'root'],
  ratingCategory: 'harsh',
  linkedFields: {},
}));

let container;
let root;

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function mount(props) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <EntryTable
        foodEntries={entries}
        categories={categories}
        loading={false}
        onAdd={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        {...props}
      />,
    );
  });
}

const rowBoxes = () => [...container.querySelectorAll('tbody input[type=checkbox]')];
const headerBox = () => container.querySelector('thead input[type=checkbox]');
const click = (el) => act(() => { el.click(); });
const buttonByText = (text, scope = document) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

describe('selecting entries for a bulk edit', () => {
  it('keeps rows ticked across pages', () => {
    mount({ onBulkEdit: () => {} });
    expect(rowBoxes()).toHaveLength(20);
    click(rowBoxes()[0]);
    click(rowBoxes()[1]);
    expect(container.textContent).toContain('2 selected');

    click(container.querySelector('button[aria-label="Go to next page"]'));
    expect(rowBoxes().every((b) => !b.checked)).toBe(true);
    click(rowBoxes()[0]);
    expect(container.textContent).toContain('3 selected');

    click(container.querySelector('button[aria-label="Go to previous page"]'));
    expect(rowBoxes().slice(0, 2).every((b) => b.checked)).toBe(true);
  });

  it('header box selects every result, not just this page', () => {
    mount({ onBulkEdit: () => {} });
    click(headerBox());
    expect(container.textContent).toContain('25 selected');
    click(headerBox());
    expect(container.textContent).not.toContain('selected');
  });

  it('opens the bulk edit dialog for what is selected', () => {
    const onBulkEdit = vi.fn();
    mount({ onBulkEdit });
    click(rowBoxes()[0]);
    click(rowBoxes()[1]);
    click(buttonByText('Edit selected', container));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('Edit 2 entries');
    expect(buttonByText('Apply', dialog).disabled).toBe(true);
  });

  it('shows no checkboxes without a bulk handler', () => {
    mount({});
    expect(rowBoxes()).toHaveLength(0);
    expect(headerBox()).toBeNull();
  });
});
