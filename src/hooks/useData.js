import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as driveService from '../services/driveService';
import * as csvService from '../services/csvService';
import * as dataService from '../services/dataService';
import { detectImportFormat, importFromLegacyCsv } from '../utils/importUtils';
import { computeCategories } from '../utils/changelogUtils';
import { DRIVE_FOLDER_NAME, DRIVE_FILE_NAME } from '../config';

// ── Offline persistence helpers ───────────────────────────────────────────────
const CACHE_KEY  = 'food_ratings_data_cache_v1';
const QUEUE_KEY  = 'food_ratings_op_queue_v1';

function saveCache(data) {
  try { localStorage.setItem(CACHE_KEY, csvService.generate(data)); } catch {}
}
function loadCache() {
  try { const t = localStorage.getItem(CACHE_KEY); return t ? csvService.parse(t) : null; } catch { return null; }
}
function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
}
function enqueue(op) { const q = loadQueue(); q.push(op); saveQueue(q); }
function isNetworkError(err) {
  return err instanceof TypeError && err.message.toLowerCase().includes('fetch');
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useData(isAuthenticated) {
  const [combined, setCombined]     = useState(new Map());
  const [changelog, setChangelog]   = useState([]);
  const [fileId, setFileId]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [syncError, setSyncError]   = useState(null);
  const [pendingCount, setPendingCount] = useState(() => loadQueue().length);
  const [isOffline, setIsOffline]   = useState(!navigator.onLine);

  const fileIdRef    = useRef(fileId);
  const combinedRef  = useRef(combined);
  const changelogRef = useRef(changelog);
  useEffect(() => { fileIdRef.current   = fileId;    }, [fileId]);
  useEffect(() => { combinedRef.current  = combined;  }, [combined]);
  useEffect(() => { changelogRef.current = changelog; }, [changelog]);

  // ── Apply Drive result to local state ───────────────────────────────────────

  function applyResult(data) {
    setCombined(new Map(data.combined));
    setChangelog([...data.changelog]);
    saveCache(data);
  }

  // ── Initialize ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) {
      setCombined(new Map()); setChangelog([]); setFileId(null);
      return;
    }

    async function init() {
      setLoading(true); setSyncError(null);
      try {
        const folderId = await driveService.findOrCreateFolder(DRIVE_FOLDER_NAME);
        const id       = await driveService.findOrCreateFile(folderId, DRIVE_FILE_NAME);
        setFileId(id); fileIdRef.current = id;
        const { content } = await driveService.readFile(id);
        const data = csvService.parse(content);
        applyResult(data);
        setIsOffline(false);
        // Flush any queued ops from a previous offline session
        if (loadQueue().length) flushQueue(id);
      } catch (err) {
        const cached = loadCache();
        if (cached) {
          setCombined(new Map(cached.combined));
          setChangelog([...cached.changelog]);
          setIsOffline(true);
          setSyncError('Working offline — showing cached data. Changes will sync when back online.');
        } else {
          setSyncError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [isAuthenticated]);

  // ── Online / Offline events ─────────────────────────────────────────────────

  useEffect(() => {
    function handleOnline() {
      setIsOffline(false);
      setSyncError(null);
      const id = fileIdRef.current;
      if (id) flushQueue(id);
    }
    function handleOffline() { setIsOffline(true); }
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Queue flush ─────────────────────────────────────────────────────────────

  async function flushQueue(id) {
    const queue = loadQueue();
    if (!queue.length) return;
    setSyncing(true);
    let remaining = [...queue];
    for (const op of queue) {
      try {
        let result;
        if      (op.type === 'add')         result = await dataService.addEntry(id, op.entries);
        else if (op.type === 'addCategory') result = await dataService.addCategory(id, op.categoryData);
        else if (op.type === 'modify')      result = await dataService.modifyEntry(id, op.uuid, op.updates);
        else if (op.type === 'delete')      result = await dataService.deleteEntry(id, op.uuid);
        if (result?.data) applyResult(result.data);
        else if (result?.combined) applyResult(result);
        remaining = remaining.filter((o) => o !== op);
        saveQueue(remaining);
      } catch (err) {
        if (!isNetworkError(err)) {
          // Non-network error: skip and remove op
          remaining = remaining.filter((o) => o !== op);
          saveQueue(remaining);
        } else {
          break; // still offline, stop flushing
        }
      }
    }
    setPendingCount(remaining.length);
    setSyncing(false);
  }

  // ── withSync (blocking) ─────────────────────────────────────────────────────
  // For operations that must await Drive completion (e.g. import).
  // Callers should `await withSync(...)`.

  async function withSync(fn, queueOp, localApply) {
    const id = fileIdRef.current;
    if (!id && !isOffline) throw new Error('No file loaded');

    if (!navigator.onLine || isOffline) {
      if (localApply) localApply();
      if (queueOp) {
        enqueue(queueOp);
        setPendingCount((n) => n + 1);
        saveCache({ combined: combinedRef.current, changelog: changelogRef.current });
      }
      return null;
    }

    setSyncing(true); setSyncError(null);
    try {
      const result = await fn(id);
      const fileData = result?.combined ? result : result?.data;
      if (fileData) applyResult(fileData);
      return result;
    } catch (err) {
      if (isNetworkError(err)) {
        setIsOffline(true);
        if (localApply) localApply();
        if (queueOp) {
          enqueue(queueOp);
          setPendingCount((n) => n + 1);
          saveCache({ combined: combinedRef.current, changelog: changelogRef.current });
        }
        setSyncError('Network error — change saved locally and will sync when back online.');
        return null;
      }
      setSyncError(err.message);
      throw err;
    } finally {
      setSyncing(false);
    }
  }

  // ── withSyncBackground ──────────────────────────────────────────────────────
  // Fire-and-forget Drive sync. The caller has ALREADY applied the change
  // to local state before calling this. Returns immediately; Drive sync
  // result (or error) is reflected via `syncing` / `syncError` in the header.

  function withSyncBackground(fn, queueOp) {
    saveCache({ combined: combinedRef.current, changelog: changelogRef.current });

    if (!navigator.onLine || isOffline) {
      if (queueOp) {
        enqueue(queueOp);
        setPendingCount((n) => n + 1);
      }
      return;
    }

    const id = fileIdRef.current;
    if (!id) {
      setSyncError('No file loaded — change only saved locally.');
      return;
    }

    setSyncing(true);
    setSyncError(null);

    fn(id)
      .then(() => {
        // Don't apply Drive result — local state is already correct.
        // Drive sync just persists. Applying would overwrite locally-added
        // entries (e.g. a new category) that haven't synced to Drive yet.
      })
      .catch((err) => {
        if (isNetworkError(err)) {
          setIsOffline(true);
          if (queueOp) {
            enqueue(queueOp);
            setPendingCount((n) => n + 1);
          }
          saveCache({ combined: combinedRef.current, changelog: changelogRef.current });
          setSyncError('Network error — change saved locally and will sync when back online.');
        } else {
          setSyncError(err.message);
        }
      })
      .finally(() => setSyncing(false));
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  /**
   * Add one or more food entries (multi-rating creates multiple linked by identicals).
   * Applies locally immediately and syncs in the background.
   */
  const addEntry = useCallback((entryDataArray) => {
    const raw = Array.isArray(entryDataArray) ? entryDataArray : [entryDataArray];
    const currentCombined = combinedRef.current;

    const entries = raw.map((d) => ({
      uuid: uuidv4(),
      entryType: 'food',
      identicals: [],
      categories: [],
      ratingCategory: '',
      restaurantName: '',
      specifier: '',
      location: '',
      score: null,
      dateRated: Date.now(),
      additionalInfo: '',
      picture: '',
      ...d,
      categories: computeCategories(d.ratingCategory || '', currentCombined),
    }));
    if (entries.length > 1) {
      const uuids = entries.map((e) => e.uuid);
      entries.forEach((e, i) => { e.identicals = uuids.filter((_, j) => j !== i); });
    }

    // Apply locally immediately
    setCombined((prev) => {
      const next = new Map(prev);
      entries.forEach((e) => next.set(e.uuid, e));
      return next;
    });

    // Background Drive sync
    withSyncBackground(
      (id) => dataService.addEntry(id, entries),
      { type: 'add', entries }
    );
  }, []);

  /**
   * Add a category entry. Returns the entry synchronously so callers can
   * use the UUID right away (e.g. to select it in a dropdown).
   */
  const addCategory = useCallback((categoryData) => {
    const currentCombined = combinedRef.current;
    const entry = {
      uuid: uuidv4(),
      entryType: 'category',
      identicals: [],
      restaurantName: categoryData.name || '',
      ratingCategory: categoryData.ratingCategory || '',
      score: categoryData.score ?? null,
      dateRated: categoryData.dateRated ?? null,
      additionalInfo: categoryData.additionalInfo || '',
      picture: '',
      specifier: '',
      location: '',
      categories: computeCategories(categoryData.ratingCategory || '', currentCombined),
    };

    // Apply locally immediately
    setCombined((prev) => new Map([...prev, [entry.uuid, entry]]));

    // Background Drive sync
    withSyncBackground(
      (id) => dataService.addCategory(id, { ...categoryData, uuid: entry.uuid }),
      { type: 'addCategory', categoryData: { ...categoryData, uuid: entry.uuid } }
    );

    return entry; // synchronous return so CreateCategoryDialog gets UUID immediately
  }, []);

  /**
   * Modify an entry. Applies locally immediately and syncs in the background.
   */
  const modifyEntry = useCallback((uuid, updates) => {
    // Apply locally immediately
    setCombined((prev) => {
      const next = new Map(prev);
      const e = next.get(uuid);
      if (e) next.set(uuid, { ...e, ...updates });
      return next;
    });

    // Background Drive sync
    withSyncBackground(
      (id) => dataService.modifyEntry(id, uuid, updates),
      { type: 'modify', uuid, updates }
    );
  }, []);

  /**
   * Delete an entry. Applies locally immediately and syncs in the background.
   */
  const deleteEntry = useCallback((uuid) => {
    // Apply locally immediately
    setCombined((prev) => { const n = new Map(prev); n.delete(uuid); return n; });

    // Background Drive sync
    withSyncBackground(
      (id) => dataService.deleteEntry(id, uuid),
      { type: 'delete', uuid }
    );
  }, []);

  // ── Import ──────────────────────────────────────────────────────────────────

  const importCsv = useCallback(async (csvText) => {
    const fmt = detectImportFormat(csvText);
    await withSync((id) => {
      if (fmt === 'app') {
        const { combined: imp } = csvService.parse(csvText);
        const cats    = Array.from(imp.values()).filter((e) => e.entryType === 'category');
        const entries = Array.from(imp.values()).filter((e) => e.entryType === 'food');
        return dataService.importEntries(id, entries, cats);
      } else {
        const { entries, newCategories } = importFromLegacyCsv(csvText, combinedRef.current);
        return dataService.importEntries(id, entries, newCategories);
      }
    }, null, null);
  }, []);

  // ── Export ──────────────────────────────────────────────────────────────────

  const exportCsv = useCallback(
    () => csvService.generate({ combined: combinedRef.current, changelog: changelogRef.current }),
    []
  );

  // ── Derived ─────────────────────────────────────────────────────────────────

  const categories  = Array.from(combined.values()).filter((e) => e.entryType === 'category');
  const foodEntries = Array.from(combined.values()).filter((e) => e.entryType === 'food');

  return {
    combined, changelog, categories, foodEntries,
    fileId, loading, syncing, syncError, setSyncError,
    isOffline, pendingCount,
    addEntry, addCategory, modifyEntry, deleteEntry,
    importCsv, exportCsv,
  };
}
