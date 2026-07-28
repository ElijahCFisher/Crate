import { describe, expect, it, vi, beforeEach } from 'vitest';

// In-memory fakes for Drive + settings storage. Hoisted so vi.mock's
// factories (which run before this file's own top-level code) can see them.
const state = vi.hoisted(() => ({
  driveFiles: new Map(),   // fileId -> { content, version }
  settingsFiles: new Map(), // fileId -> settings object
}));

const defaultReadFile = async (fileId) => {
  const f = state.driveFiles.get(fileId) || { content: '', version: 0 };
  return { content: f.content, etag: String(f.version) };
};

vi.mock('./driveService', () => ({
  readFile: vi.fn(async (fileId) => {
    const f = state.driveFiles.get(fileId) || { content: '', version: 0 };
    return { content: f.content, etag: String(f.version) };
  }),
  writeFile: vi.fn(async (fileId, content, expectedVersion) => {
    const f = state.driveFiles.get(fileId) || { content: '', version: 0 };
    if (expectedVersion && String(f.version) !== String(expectedVersion)) {
      return { ok: false, status: 412 };
    }
    const next = { content, version: f.version + 1 };
    state.driveFiles.set(fileId, next);
    return { ok: true, etag: String(next.version) };
  }),
}));

vi.mock('./settingsService', () => ({
  readSettings: vi.fn(async (fileId) => {
    return state.settingsFiles.get(fileId) || {
      bulkAdds: [], following: [], requestedToFollow: [], sharedWith: [],
      showAdvancedByDefault: false, notes: '',
    };
  }),
  writeSettings: vi.fn(async (fileId, settings) => {
    state.settingsFiles.set(fileId, settings);
  }),
}));

const dataService = await import('./dataService');
const settingsService = await import('./settingsService');

const fileIds = { combinedFileId: 'combined-1', changelogFileId: 'changelog-1' };
const settingsFileId = 'settings-1';

beforeEach(() => {
  state.driveFiles.clear();
  state.settingsFiles.clear();
  vi.clearAllMocks();
});

describe('addBulkRating', () => {
  it('writes a single 2-entry group, cross-links identicals, and records a bulkAdds entry', async () => {
    const { builtGroups, bulkAdds } = await dataService.addBulkRating(fileIds, settingsFileId, [
      [{ restaurantName: 'Pizza Hut', score: '8' }, { restaurantName: 'Pizza Hut', specifier: 'Pasta', score: '7' }],
    ]);

    expect(builtGroups).toHaveLength(1);
    const [a, b] = builtGroups[0];
    expect(a.identicals).toEqual([b.uuid]);
    expect(b.identicals).toEqual([a.uuid]);

    expect(bulkAdds).toEqual([[a.uuid, b.uuid]]);

    // Actually persisted, not just returned.
    const combined = (await import('./csvService')).parseCombined(state.driveFiles.get('combined-1').content);
    expect(combined.get(a.uuid)?.restaurantName).toBe('Pizza Hut');
    expect(combined.get(b.uuid)?.specifier).toBe('Pasta');
    expect(state.settingsFiles.get(settingsFileId).bulkAdds).toEqual([[a.uuid, b.uuid]]);
  });

  it('does not record a bulkAdds entry (or touch settings at all) for a single 1-entry group', async () => {
    const { builtGroups, bulkAdds } = await dataService.addBulkRating(fileIds, settingsFileId, [
      [{ restaurantName: 'Solo Diner', score: '6' }],
    ]);

    expect(builtGroups[0]).toHaveLength(1);
    expect(builtGroups[0][0].identicals).toEqual([]);
    expect(bulkAdds).toBeNull();
    expect(settingsService.writeSettings).not.toHaveBeenCalled();
    expect(state.settingsFiles.has(settingsFileId)).toBe(false);
  });

  it('links entries within a group but never across separate groups', async () => {
    const { builtGroups } = await dataService.addBulkRating(fileIds, settingsFileId, [
      [{ restaurantName: 'A', score: '5' }, { restaurantName: 'A', specifier: '2', score: '6' }],
      [{ restaurantName: 'B', score: '7' }, { restaurantName: 'B', specifier: '2', score: '8' }],
    ]);
    const [group1, group2] = builtGroups;

    expect(group1[0].identicals).toEqual([group1[1].uuid]);
    expect(group1[1].identicals).toEqual([group1[0].uuid]);
    expect(group2[0].identicals).toEqual([group2[1].uuid]);
    expect(group2[1].identicals).toEqual([group2[0].uuid]);

    // No cross-group leakage.
    expect(group1[0].identicals).not.toContain(group2[0].uuid);
    expect(group2[0].identicals).not.toContain(group1[0].uuid);
  });

  it('records ALL uuids across ALL groups as one flat bulkAdds entry (matches AppLayout.handleSaveGroups behavior)', async () => {
    const { builtGroups, bulkAdds } = await dataService.addBulkRating(fileIds, settingsFileId, [
      [{ restaurantName: 'A', score: '5' }, { restaurantName: 'A', specifier: '2', score: '6' }],
      [{ restaurantName: 'B', score: '7' }, { restaurantName: 'B', specifier: '2', score: '8' }],
    ]);
    const allUuids = builtGroups.flat().map((e) => e.uuid);
    expect(bulkAdds).toEqual([allUuids]);
  });

  it('prepends to existing bulkAdds and preserves other settings fields', async () => {
    state.settingsFiles.set(settingsFileId, {
      bulkAdds: [['old-uuid-1', 'old-uuid-2']],
      following: [{ email: 'friend@example.com', displayName: 'Friend' }],
      requestedToFollow: [],
      sharedWith: [],
      showAdvancedByDefault: true,
      notes: 'some notes',
    });

    const { bulkAdds } = await dataService.addBulkRating(fileIds, settingsFileId, [
      [{ restaurantName: 'A', score: '5' }, { restaurantName: 'A', specifier: '2', score: '6' }],
    ]);

    expect(bulkAdds[0]).toHaveLength(2); // the new group first
    expect(bulkAdds[1]).toEqual(['old-uuid-1', 'old-uuid-2']); // old entry preserved, not clobbered

    const persisted = state.settingsFiles.get(settingsFileId);
    expect(persisted.following).toEqual([{ email: 'friend@example.com', displayName: 'Friend' }]);
    expect(persisted.notes).toBe('some notes');
    expect(persisted.showAdvancedByDefault).toBe(true);
  });

  it('keeps a caller-provided uuid instead of generating a new one', async () => {
    const { builtGroups } = await dataService.addBulkRating(fileIds, settingsFileId, [
      [{ uuid: 'fixed-uuid-1', restaurantName: 'A', score: '5' }, { restaurantName: 'A', specifier: '2', score: '6' }],
    ]);
    expect(builtGroups[0][0].uuid).toBe('fixed-uuid-1');
    expect(builtGroups[0][1].identicals).toContain('fixed-uuid-1');
  });

  it('retries the entries write on a version conflict (412) and still succeeds', async () => {
    // Simulate a concurrent writer bumping the combined file's version right
    // after this call's first read of it, forcing exactly one retry.
    // mockImplementationOnce intercepts only that single call and then falls
    // back to the default readFile automatically — no manual restore needed.
    const driveService = await import('./driveService');
    let intercepted = false;
    driveService.readFile.mockImplementationOnce(async (fileId) => {
      intercepted = true;
      const result = await defaultReadFile(fileId);
      state.driveFiles.set(fileId, { content: result.content, version: Number(result.etag) + 1 });
      return result; // stale etag on purpose — the write that follows must 412
    });

    const { bulkAdds } = await dataService.addBulkRating(fileIds, settingsFileId, [
      [{ restaurantName: 'A', score: '5' }, { restaurantName: 'A', specifier: '2', score: '6' }],
    ]);

    expect(intercepted).toBe(true);
    expect(bulkAdds).not.toBeNull();
  }, 10000);
});

describe('existing functions still work (regression check for the addBulkRating refactor)', () => {
  it('addEntry adds a single entry', async () => {
    const { entries } = await dataService.addEntry(fileIds, { restaurantName: 'Solo', score: '9' });
    expect(entries).toHaveLength(1);
    const combined = (await import('./csvService')).parseCombined(state.driveFiles.get('combined-1').content);
    expect(combined.get(entries[0].uuid)?.restaurantName).toBe('Solo');
  });

  it('addEntry cross-links identicals when given an array', async () => {
    const { entries } = await dataService.addEntry(fileIds, [
      { restaurantName: 'X', score: '5' },
      { restaurantName: 'X', specifier: 'Y', score: '6' },
    ]);
    expect(entries[0].identicals).toEqual([entries[1].uuid]);
  });

  it('modifyEntry updates a field on an existing entry', async () => {
    const { entries } = await dataService.addEntry(fileIds, { restaurantName: 'Before', score: '5' });
    await dataService.modifyEntry(fileIds, entries[0].uuid, { restaurantName: 'After' });
    const combined = (await import('./csvService')).parseCombined(state.driveFiles.get('combined-1').content);
    expect(combined.get(entries[0].uuid)?.restaurantName).toBe('After');
  });

  it('deleteEntry removes an entry', async () => {
    const { entries } = await dataService.addEntry(fileIds, { restaurantName: 'Gone', score: '5' });
    await dataService.deleteEntry(fileIds, entries[0].uuid);
    const combined = (await import('./csvService')).parseCombined(state.driveFiles.get('combined-1').content);
    expect(combined.has(entries[0].uuid)).toBe(false);
  });

  it('addEntries writes a flat list without touching settings', async () => {
    await dataService.addEntries(fileIds, [
      { uuid: 'flat-1', restaurantName: 'Imported A', score: '5', dateRated: Date.now() },
      { uuid: 'flat-2', restaurantName: 'Imported B', score: '6', dateRated: Date.now() },
    ]);
    const combined = (await import('./csvService')).parseCombined(state.driveFiles.get('combined-1').content);
    expect(combined.get('flat-1')?.identicals).toEqual([]);
    expect(settingsService.writeSettings).not.toHaveBeenCalled();
  });
});
