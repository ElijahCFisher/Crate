import { describe, it, expect } from 'vitest';
import {
  makeLinkKeyResolver,
  resolveLinkPlan,
  collectLinkedFollowers,
} from './linkUtils';

function makeCombined(entries) {
  return new Map(entries.map((e) => [e.uuid, { linkedFields: {}, ...e }]));
}

describe('makeLinkKeyResolver', () => {
  it('resolves uuid keys directly', () => {
    expect(makeLinkKeyResolver()('uuid:abc')).toBe('abc');
  });

  it('resolves positional keys against the created groups', () => {
    const created = [[{ uuid: 'a' }, { uuid: 'b' }], [{ uuid: 'c' }]];
    const resolve = makeLinkKeyResolver(created);
    expect(resolve('new:0:0')).toBe('a');
    expect(resolve('new:0:1')).toBe('b');
    expect(resolve('new:1:0')).toBe('c');
  });

  it('returns null for positions that were never created', () => {
    const resolve = makeLinkKeyResolver([[{ uuid: 'a' }]]);
    expect(resolve('new:3:0')).toBeNull();
    expect(resolve('garbage')).toBeNull();
    expect(resolve(undefined)).toBeNull();
  });
});

describe('resolveLinkPlan', () => {
  it('writes a leader map for a newly linked follower', () => {
    const combined = makeCombined([{ uuid: 'leader' }, { uuid: 'follower' }]);
    const plan = {
      links: [{ parent: 'uuid:leader', child: 'uuid:follower', field: 'restaurantName' }],
      keys: ['uuid:leader', 'uuid:follower'],
    };
    expect(resolveLinkPlan(plan, makeLinkKeyResolver(), combined)).toEqual([
      { uuid: 'leader', linkedFields: { restaurantName: ['follower'] } },
    ]);
  });

  it('drops a link the form no longer asserts', () => {
    const combined = makeCombined([
      { uuid: 'leader', linkedFields: { restaurantName: ['follower'], location: ['follower'] } },
      { uuid: 'follower' },
    ]);
    const plan = {
      links: [{ parent: 'uuid:leader', child: 'uuid:follower', field: 'location' }],
      keys: ['uuid:leader', 'uuid:follower'],
    };
    expect(resolveLinkPlan(plan, makeLinkKeyResolver(), combined)).toEqual([
      { uuid: 'leader', linkedFields: { location: ['follower'] } },
    ]);
  });

  it('keeps followers that were not on screen', () => {
    const combined = makeCombined([
      { uuid: 'leader', linkedFields: { restaurantName: ['onScreen', 'offScreen'] } },
      { uuid: 'onScreen' },
      { uuid: 'offScreen' },
    ]);
    const plan = { links: [], keys: ['uuid:leader', 'uuid:onScreen'] };
    expect(resolveLinkPlan(plan, makeLinkKeyResolver(), combined)).toEqual([
      { uuid: 'leader', linkedFields: { restaurantName: ['offScreen'] } },
    ]);
  });

  it('returns nothing when the stored map already matches', () => {
    const combined = makeCombined([
      { uuid: 'leader', linkedFields: { restaurantName: ['follower'] } },
      { uuid: 'follower' },
    ]);
    const plan = {
      links: [{ parent: 'uuid:leader', child: 'uuid:follower', field: 'restaurantName' }],
      keys: ['uuid:leader', 'uuid:follower'],
    };
    expect(resolveLinkPlan(plan, makeLinkKeyResolver(), combined)).toEqual([]);
  });

  it('resolves links between entries this save just created', () => {
    const created = [[{ uuid: 'new-a' }, { uuid: 'new-b' }]];
    const plan = {
      links: [{ parent: 'new:0:0', child: 'new:0:1', field: 'location' }],
      keys: ['new:0:0', 'new:0:1'],
    };
    expect(resolveLinkPlan(plan, makeLinkKeyResolver(created), new Map())).toEqual([
      { uuid: 'new-a', linkedFields: { location: ['new-b'] } },
    ]);
  });

  it('ignores fields that are not linkable and self-links', () => {
    const combined = makeCombined([{ uuid: 'leader' }, { uuid: 'follower' }]);
    const plan = {
      links: [
        { parent: 'uuid:leader', child: 'uuid:follower', field: 'identicals' },
        { parent: 'uuid:leader', child: 'uuid:leader', field: 'location' },
      ],
      keys: ['uuid:leader', 'uuid:follower'],
    };
    expect(resolveLinkPlan(plan, makeLinkKeyResolver(), combined)).toEqual([]);
  });

  it('ignores a malformed plan', () => {
    expect(resolveLinkPlan(null, makeLinkKeyResolver(), new Map())).toEqual([]);
    expect(resolveLinkPlan({ links: [] }, makeLinkKeyResolver(), new Map())).toEqual([]);
  });
});

describe('collectLinkedFollowers', () => {
  it('follows the chain past the direct followers', () => {
    const combined = makeCombined([
      { uuid: 'a', linkedFields: { restaurantName: ['b'] } },
      { uuid: 'b', linkedFields: { restaurantName: ['c'] } },
      { uuid: 'c' },
    ]);
    expect(collectLinkedFollowers(combined, 'a', 'restaurantName')).toEqual(['b', 'c']);
  });

  it('stops where the chain is unlinked for that field', () => {
    const combined = makeCombined([
      { uuid: 'a', linkedFields: { restaurantName: ['b'] } },
      { uuid: 'b', linkedFields: { location: ['c'] } },
      { uuid: 'c' },
    ]);
    expect(collectLinkedFollowers(combined, 'a', 'restaurantName')).toEqual(['b']);
  });

  it('survives a cycle', () => {
    const combined = makeCombined([
      { uuid: 'a', linkedFields: { location: ['b'] } },
      { uuid: 'b', linkedFields: { location: ['a', 'c'] } },
      { uuid: 'c' },
    ]);
    expect(collectLinkedFollowers(combined, 'a', 'location')).toEqual(['b', 'c']);
  });

  it('skips followers that no longer exist', () => {
    const combined = makeCombined([{ uuid: 'a', linkedFields: { location: ['deleted'] } }]);
    expect(collectLinkedFollowers(combined, 'a', 'location')).toEqual([]);
  });
});
