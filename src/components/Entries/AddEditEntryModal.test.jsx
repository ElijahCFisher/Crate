import { describe, it, expect } from 'vitest';
import {
  applyLinkedChange, buildLinkPlan, applyTextToForm, formToRatings,
} from './AddEditEntryModal';
import { generateTextLines } from '../../utils/textModeUtils';
import { LINKABLE_FIELDS } from '../../utils/linkUtils';

/**
 * Form shape: the primary rating lives on the root (plus primaryRating for
 * score/category); every other rating is an entry in additionalRatings with a
 * linkParentId pointing at whichever rating it was created from.
 */
function makeForm(additionalRatings) {
  return {
    restaurantName: 'Guess',
    specifier: '',
    location: '',
    dateRated: '2026-01-01',
    additionalInfo: '',
    picture: '',
    primaryRating: { ratingCategory: '', newCategoryName: null, score: '' },
    additionalRatings,
  };
}

function follower(id, linkParentId, overrides = {}) {
  return {
    id,
    groupId: String(id),
    isIdentical: false,
    linkParentId,
    linkedFields: [...LINKABLE_FIELDS],
    restaurantName: 'Guess',
    specifier: '',
    location: '',
    dateRated: '2026-01-01',
    additionalInfo: '',
    picture: '',
    score: '',
    ratingCategory: '',
    newCategoryName: null,
    ...overrides,
  };
}

describe('applyLinkedChange', () => {
  it('pushes a change on the first rating to its followers', () => {
    const form = makeForm([follower(1, 'primary'), follower(2, 'primary')]);
    const next = applyLinkedChange(form, 'primary', 'restaurantName', { restaurantName: 'Zorba' });
    expect(next.restaurantName).toBe('Zorba');
    expect(next.additionalRatings.map((r) => r.restaurantName)).toEqual(['Zorba', 'Zorba']);
  });

  it('follows the chain — a follower of a follower still updates', () => {
    const form = makeForm([follower(1, 'primary'), follower(2, 1)]);
    const next = applyLinkedChange(form, 'primary', 'location', { location: 'Denver' });
    expect(next.additionalRatings.map((r) => r.location)).toEqual(['Denver', 'Denver']);
  });

  it('editing a follower disconnects only that field, only for that rating', () => {
    const form = makeForm([follower(1, 'primary'), follower(2, 'primary')]);
    const next = applyLinkedChange(form, 1, 'restaurantName', { restaurantName: 'Mine' });

    expect(next.additionalRatings[0].linkedFields).not.toContain('restaurantName');
    expect(next.additionalRatings[0].linkedFields).toContain('location');
    expect(next.additionalRatings[1].linkedFields).toContain('restaurantName');
  });

  it('stops pushing to a follower that disconnected that field', () => {
    const form = makeForm([follower(1, 'primary'), follower(2, 'primary')]);
    const edited = applyLinkedChange(form, 1, 'restaurantName', { restaurantName: 'Mine' });
    const next = applyLinkedChange(edited, 'primary', 'restaurantName', { restaurantName: 'Zorba' });

    expect(next.additionalRatings[0].restaurantName).toBe('Mine');
    expect(next.additionalRatings[1].restaurantName).toBe('Zorba');
  });

  it('a disconnected follower keeps feeding its own followers', () => {
    const form = makeForm([follower(1, 'primary'), follower(2, 1)]);
    const next = applyLinkedChange(form, 1, 'restaurantName', { restaurantName: 'Mine' });
    expect(next.additionalRatings[1].restaurantName).toBe('Mine');
  });

  it('routes score and category onto the primary rating object', () => {
    const form = makeForm([follower(1, 'primary')]);
    const next = applyLinkedChange(form, 'primary', 'score', { score: '9' });
    expect(next.primaryRating.score).toBe('9');
    expect(next.additionalRatings[0].score).toBe('9');
  });

  it('carries paired values (date string + ms) together', () => {
    const form = makeForm([follower(1, 'primary')]);
    const next = applyLinkedChange(form, 'primary', 'dateRated', {
      dateRated: '2026-02-02',
      dateRatedMs: 1770000000000,
    });
    expect(next.additionalRatings[0].dateRated).toBe('2026-02-02');
    expect(next.additionalRatings[0].dateRatedMs).toBe(1770000000000);
  });

  it('leaves unlinked ratings alone', () => {
    const form = makeForm([follower(1, null, { linkedFields: [], restaurantName: 'Other' })]);
    const next = applyLinkedChange(form, 'primary', 'restaurantName', { restaurantName: 'Zorba' });
    expect(next.additionalRatings[0].restaurantName).toBe('Other');
  });
});

describe('buildLinkPlan', () => {
  it('emits one entry per linked field, keyed for the save', () => {
    const form = makeForm([follower(1, 'primary', { linkedFields: ['restaurantName', 'location'] })]);
    const keys = new Map([['primary', 'uuid:leader'], [1, 'new:0:0']]);
    const plan = buildLinkPlan(form, keys);

    expect(plan.links).toEqual([
      { parent: 'uuid:leader', child: 'new:0:0', field: 'restaurantName' },
      { parent: 'uuid:leader', child: 'new:0:0', field: 'location' },
    ]);
    expect(plan.keys).toEqual(['uuid:leader', 'new:0:0']);
  });

  it('emits no links for a fully disconnected follower but still scopes the write', () => {
    const form = makeForm([follower(1, 'primary', { linkedFields: [] })]);
    const keys = new Map([['primary', 'uuid:leader'], [1, 'uuid:follower']]);
    const plan = buildLinkPlan(form, keys);

    expect(plan.links).toEqual([]);
    expect(plan.keys).toEqual(['uuid:leader', 'uuid:follower']);
  });

  it('skips ratings whose parent has no key', () => {
    const form = makeForm([follower(1, 99)]);
    const plan = buildLinkPlan(form, new Map([['primary', 'uuid:leader'], [1, 'uuid:x']]));
    expect(plan.links).toEqual([]);
  });
});

describe('applyTextToForm', () => {
  const categories = [{ uuid: 'c-greek', restaurantName: 'greek', ratingCategory: '' }];

  function baselineFor(form) {
    return generateTextLines(formToRatings(form), categories);
  }

  /** A form whose primary rating is already filled in. */
  function filledForm(additionalRatings = []) {
    const form = makeForm(additionalRatings);
    return {
      ...form,
      location: 'Denver',
      specifier: 'Gyro',
      primaryRating: { ...form.primaryRating, score: '8' },
    };
  }

  it('edits the existing rating rather than creating a new one', () => {
    const form = makeForm([]);
    const lines = baselineFor(form);
    const edited = lines.map((l) => l.text).join('\n').replace('Guess', 'Zorba');

    const { form: next } = applyTextToForm(form, edited, categories, lines);
    expect(next.restaurantName).toBe('Zorba');
    expect(next.additionalRatings).toHaveLength(0);
  });

  it('turns an added line into a new rating', () => {
    const form = filledForm();
    const lines = baselineFor(form);
    const withExtra = `${lines.map((l) => l.text).join('\n')}\nFries 5 salty`;

    const { form: next } = applyTextToForm(form, withExtra, categories, lines);
    expect(next.additionalRatings).toHaveLength(1);
    expect(next.additionalRatings[0]).toMatchObject({
      specifier: 'Fries',
      score: '5',
      additionalInfo: 'salty',
      linkParentId: null,
    });
  });

  it('leaves a rating alone when its line is deleted', () => {
    const form = makeForm([follower(1, null, { linkedFields: [], specifier: 'Fries', score: '5' })]);
    const lines = baselineFor(form);
    const withoutFries = lines
      .map((l) => l.text)
      .filter((t) => !t.includes('Fries'))
      .join('\n');

    const { form: next } = applyTextToForm(form, withoutFries, categories, lines);
    expect(next.additionalRatings).toHaveLength(1);
    expect(next.additionalRatings[0].specifier).toBe('Fries');
  });

  it('carries a linked field to followers, same as typing in the form', () => {
    const form = makeForm([follower(1, 'primary')]);
    const lines = baselineFor(form);
    const edited = lines.map((l) => l.text).join('\n').replace('Guess', 'Zorba');

    const { form: next } = applyTextToForm(form, edited, categories, lines);
    expect(next.restaurantName).toBe('Zorba');
    expect(next.additionalRatings[0].restaurantName).toBe('Zorba');
  });

  it('fills a blank primary rating instead of stranding it', () => {
    const form = makeForm([]);
    const lines = baselineFor(form);

    const { form: next } = applyTextToForm(form, 'Zorba\nDenver\nGyro 8 greek', categories, lines);
    expect(next).toMatchObject({ restaurantName: 'Zorba', location: 'Denver', specifier: 'Gyro' });
    expect(next.primaryRating.score).toBe('8');
    expect(next.additionalRatings).toHaveLength(0);
  });

  it('keeps a restaurant typed before any ratings', () => {
    const form = makeForm([]);
    const lines = baselineFor(form);

    const { form: next } = applyTextToForm(form, 'Zorba\nDenver', categories, lines);
    expect(next).toMatchObject({ restaurantName: 'Zorba', location: 'Denver' });
  });

  it('reports unparseable lines without dropping the good ones', () => {
    const form = filledForm();
    const lines = baselineFor(form);
    const text = `${lines.map((l) => l.text).join('\n')}\nFries no score here`;

    const { errors } = applyTextToForm(form, text, categories, lines);
    expect(errors).toHaveLength(1);
  });
});
