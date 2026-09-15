import { describe, it, expect, beforeEach } from 'vitest';
import { clearLocalDataStorage, countUnsyncedChanges } from './useData';

describe('signing out clears local data', () => {
  beforeEach(() => localStorage.clear());

  it('removes the cache, queue, write-ahead log and saved table filters', () => {
    localStorage.setItem('food_ratings_data_cache_v1', 'cached csv');
    localStorage.setItem('food_ratings_op_queue_v1', '[]');
    localStorage.setItem('food_ratings_wal_v1', '[]');
    localStorage.setItem('food_ratings_table_prefs_v1', '{}');

    clearLocalDataStorage();

    expect(localStorage.length).toBe(0);
  });

  it('leaves settings that belong to the device rather than the account', () => {
    localStorage.setItem('food_rating_auth_scope', 'drive.file');
    localStorage.setItem('crate_theme_mode', 'dark');
    localStorage.setItem('food_ratings_data_cache_v1', 'cached csv');

    clearLocalDataStorage();

    expect(localStorage.getItem('food_rating_auth_scope')).toBe('drive.file');
    expect(localStorage.getItem('crate_theme_mode')).toBe('dark');
    expect(localStorage.getItem('food_ratings_data_cache_v1')).toBeNull();
  });

  it('counts changes that have not reached Drive', () => {
    expect(countUnsyncedChanges()).toBe(0);
    localStorage.setItem('food_ratings_op_queue_v1', JSON.stringify([{ type: 'add' }, { type: 'modify' }]));
    expect(countUnsyncedChanges()).toBe(2);
  });
});
