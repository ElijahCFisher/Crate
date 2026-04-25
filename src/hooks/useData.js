import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as driveService from '../services/driveService';
import * as csvService from '../services/csvService';
import * as dataService from '../services/dataService';
import { detectImportFormat, importFromLegacyCsv } from '../utils/importUtils';
import {
  computeCategories,
  createAdditionChange,
  createModificationChange,
  createDeletionChange,
} from '../utils/changelogUtils';
import { DRIVE_FOLDER_NAME, DRIVE_FILE_NAME } from '../config';

// ── Offline persistence helpers ───────────────────────────────────────────────
const CACHE_KEY  = 'food_ratings_data_cache_v1';
const QUEUE_KEY  = 'food_ratings_op_queue_v1';
// Write-ahead log: ops persisted before their Drive write so a page reload can replay them.
const WAL_KEY    = 'food_ratings_wal_v1';

function saveCache(data) {
  // Try saving the full dataset (combined + changelog).
  try {
    localStorage.setItem(CACHE_KEY, csvService.generate(data));
    return;
  } catch {}
  // Full save exceeded the quota (~5 MB limit). Try combined-only — the
  // changelog isn't needed for the startup display and roughly halves the size.
  // init() will restore the full changelog from Drive on next load.
  try {
    localStorage.setItem(CACHE_KEY, csvService.generate({ combined: data.combined, changelog: [] }));
    return;
  } catch {}
  // Still too large — clear the stale cache so the next reload doesn't show
  // out-of-date data while Drive loads.
  try { localStorage.removeItem(CACHE_KEY); } catch {}
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
function loadWal() {
  try { return JSON.parse(localStorage.getItem(WAL_KEY) || '[]'); } catch { return []; }
}
function saveWal(ops) {
  try { localStorage.setItem(WAL_KEY, JSON.stringify(ops)); } catch {}
}
function isNetworkError(err) {
  return err instanceof TypeError && err.message.toLowerCase().includes('fetch');
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useData(isAuthenticated) {
  const [combined, setCombined]     = useState(new Map());
  const [changelog, setChangelog]   = useState([]);
  const [fileId, setFileId]         = useState(null);
  const [folderId, setFolderId]     = useState(null);
  const [loading, setLoading]       = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [syncError, setSyncError]   = useState(null);
  const [pendingCount, setPendingCount] = useState(() => loadQueue().length);
  const [isOffline, setIsOffline]   = useState(!navigator.onLine);

  const fileIdRef    = useRef(fileId);
  const combinedRef  = useRef(combined);
  const changelogRef = useRef(changelog);
  // isOfflineRef mirrors isOffline so stale useCallback closures always read
  // the current value (avoids trying a Drive call when we know we're offline).
  const isOfflineRef = useRef(!navigator.onLine);
  // Stores the latest init function so the online-event handler can call it
  // if the page was loaded while offline (fileId was never set).
  const initRef        = useRef(null);
  // Monotonically-increasing counter used to discard results from a stale
  // init() invocation. React StrictMode (and any other cause of concurrent
  // init calls) can run the effect twice; only the last invocation should
  // win so that a faster-but-stale CDN response never overwrites a
  // slower-but-fresh one.
  const initCounterRef = useRef(0);
  // Serializes all background Drive writes so concurrent saves (e.g. multiple
  // entry groups submitted at once) never race and overwrite each other.
  const driveWriteQueueRef = useRef(Promise.resolve());
  useEffect(() => { fileIdRef.current    = fileId;    }, [fileId]);
  useEffect(() => { combinedRef.current  = combined;  }, [combined]);
  useEffect(() => { changelogRef.current = changelog; }, [changelog]);
  useEffect(() => { isOfflineRef.current = isOffline; }, [isOffline]);

  // ── Apply Drive result to local state ───────────────────────────────────────

  function applyResult(data) {
    setCombined(new Map(data.combined));
    setChangelog([...data.changelog]);
    saveCache(data);
  }

  // ── Initialize ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) {
      // Show cached data so the table is populated before the user signs in.
      const cached = loadCache();
      setCombined(cached ? new Map(cached.combined) : new Map());
      setChangelog(cached ? [...cached.changelog] : []);
      setFileId(null);
      fileIdRef.current = null;
      return;
    }

    async function init() {
      initRef.current = init; // keep ref fresh for the online-event handler

      // Stamp this invocation so we can discard results if a newer init()
      // starts before this one finishes (React StrictMode runs effects twice;
      // a stale CDN response from the first call must not overwrite the fresh
      // response from the second call).
      const myCount = ++initCounterRef.current;

      setLoading(true); setSyncError(null);
      try {
        const resolvedFolderId = await driveService.findOrCreateFolder(DRIVE_FOLDER_NAME);
        setFolderId(resolvedFolderId);
        const id = await driveService.findOrCreateFile(resolvedFolderId, DRIVE_FILE_NAME);
        setFileId(id); fileIdRef.current = id;
        const { content, etag } = await driveService.readFile(id);

        // Another init() started while we were awaiting — its result is newer,
        // so silently abandon this one.
        if (myCount !== initCounterRef.current) return;

        const data = csvService.parse(content);

        // ── First-time sync: Drive is empty but cache has data ────────────────
        // This happens on first sign-in, if the Drive file was deleted, or if
        // the user had data cached before signing in (e.g. offline usage, or
        // the app was installed fresh and they see old cached data).
        // Rather than wiping the local display, upload the cache to Drive.
        if (data.combined.size === 0 && data.changelog.length === 0) {
          const cached = loadCache();
          if (cached && cached.combined.size > 0) {
            // Write the full cache verbatim — this preserves all historical
            // changelog entries (changeMethod, original timestamps) exactly as
            // they were. This handles: first sign-in, CSV deleted from Drive,
            // or Drive file lost.
            const writeResult = await driveService.writeFile(
              id,
              csvService.generate(cached),
              etag,
            );
            if (myCount !== initCounterRef.current) return;
            if (!writeResult.ok) {
              throw new Error(`Failed to seed Drive from cache (HTTP ${writeResult.status}).`);
            }
            applyResult(cached);
            setIsOffline(false);
            // The cache written to Drive already incorporates every queued op
            // (each offline op saves the cache before enqueuing). Clear the
            // queue so the ops aren't replayed and don't create duplicates.
            saveQueue([]);
            setPendingCount(0);
            return;
          }
        }

        // Merge pending ops (WAL + queue) into Drive data before applying to
        // local state. Without this, entries added before init() sets fileId
        // are queued but never written to Drive yet — applyResult(data) would
        // wipe them from the UI until flushQueue restores them seconds later.
        const wal = loadWal();
        const walOps = wal.map(({ _walId, ...op }) => op);
        for (const op of [...walOps, ...loadQueue()]) {
          if (op.type === 'add' || op.type === 'addEntries' || op.type === 'addWithLinks') {
            for (const e of (op.entries || [])) {
              if (!data.combined.has(e.uuid)) data.combined.set(e.uuid, e);
            }
          } else if (op.type === 'addCategory') {
            const cd = op.categoryData;
            if (cd?.uuid && !data.combined.has(cd.uuid)) {
              data.combined.set(cd.uuid, {
                uuid: cd.uuid, entryType: 'category', identicals: [], categories: [],
                restaurantName: cd.name || '', ratingCategory: cd.ratingCategory || '',
                score: cd.score ?? null, dateRated: cd.dateRated ?? null,
                additionalInfo: cd.additionalInfo || '', picture: '', specifier: '', location: '',
              });
            }
          } else if (op.type === 'modify') {
            const e = data.combined.get(op.uuid);
            if (e) data.combined.set(op.uuid, { ...e, ...op.updates });
          } else if (op.type === 'delete') {
            data.combined.delete(op.uuid);
          }
        }
        applyResult(data);
        setIsOffline(false);
        // Replay any Drive writes that were in-flight when the page last reloaded.
        if (wal.length > 0) {
          saveWal([]);
          saveQueue([...walOps, ...loadQueue()]);
        }
        if (loadQueue().length) flushQueue(id);
      } catch (err) {
        if (myCount !== initCounterRef.current) return;
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
        if (myCount === initCounterRef.current) setLoading(false);
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
      if (id) {
        // fileId already set — went offline mid-session, just flush the queue.
        flushQueue(id);
      } else if (initRef.current) {
        // Page was loaded while offline; init() never got a fileId.
        // Re-run init now — it will load Drive data and flush the queue.
        initRef.current();
      }
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
        else if (op.type === 'addEntries')  result = await dataService.addEntries(id, op.entries);
        else if (op.type === 'addCategory') result = await dataService.addCategory(id, op.categoryData);
        else if (op.type === 'addWithLinks') result = await dataService.addEntriesWithLinks(id, op.entries, op.existingUuids);
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
  //
  // `newCombined` — the post-update combined Map computed synchronously by the
  // caller (inside the setCombined updater). Passing it here ensures the cache
  // is saved with the correct state even before React has committed the render
  // and the combinedRef useEffect has run.

  function withSyncBackground(fn, queueOp, newCombined, newChangelog) {
    // Use the explicitly supplied values (post-op) when available so the cache
    // is saved with the correct state before React commits the render.
    const mapToCache = newCombined  || combinedRef.current;
    const logToCache = newChangelog || changelogRef.current;
    saveCache({ combined: mapToCache, changelog: logToCache });

    if (!navigator.onLine || isOfflineRef.current) {
      if (queueOp) {
        enqueue(queueOp);
        setPendingCount((n) => n + 1);
      }
      return;
    }

    const id = fileIdRef.current;
    if (!id) {
      // No Drive file yet — user isn't signed in, or init() hasn't completed.
      // Enqueue the op so it syncs automatically once we have a file ID
      // (i.e. after sign-in finishes and init() runs flushQueue).
      if (queueOp) {
        enqueue(queueOp);
        setPendingCount((n) => n + 1);
      }
      return;
    }

    // Write-ahead log: persist before Drive write so a page reload can replay it.
    const walId = queueOp ? `${Date.now()}_${Math.random()}` : null;
    if (walId) {
      const wal = loadWal();
      wal.push({ ...queueOp, _walId: walId });
      saveWal(wal);
    }

    setSyncing(true);
    setSyncError(null);

    // Chain onto the queue so concurrent writes are serialized — avoids the
    // TOCTOU race where two concurrent writes both pass the version check then
    // the last writer silently overwrites the first.
    driveWriteQueueRef.current = driveWriteQueueRef.current
      .then(() => fn(id))
      .then(() => {
        // Drive write succeeded — remove from WAL.
        if (walId) saveWal(loadWal().filter((o) => o._walId !== walId));
      })
      .catch((err) => {
        if (isNetworkError(err)) {
          setIsOffline(true);
          // Move from WAL to persistent offline queue.
          if (walId) saveWal(loadWal().filter((o) => o._walId !== walId));
          if (queueOp) {
            enqueue(queueOp);
            setPendingCount((n) => n + 1);
          }
          saveCache({ combined: combinedRef.current, changelog: changelogRef.current });
          setSyncError('Network error — change saved locally and will sync when back online.');
        } else {
          if (walId) saveWal(loadWal().filter((o) => o._walId !== walId));
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

    // Mirror what dataService does: create change objects so the local changelog
    // is complete (correct notes, timestamps) even before the Drive sync runs.
    const changes = entries.map((e) => createAdditionChange(e));

    // Compute newChangelog explicitly from the ref BEFORE calling setState.
    // React only eagerly evaluates the *first* setState updater in a batch;
    // subsequent updaters run deferred, so capturing values inside them is
    // unreliable. Using the ref guarantees newChangelog is always defined.
    const newChangelog = [...changelogRef.current, ...changes];
    changelogRef.current = newChangelog;

    // Apply locally immediately; capture post-op combined for cache consistency
    let newCombined;
    setCombined((prev) => {
      const next = new Map(prev);
      entries.forEach((e) => next.set(e.uuid, e));
      newCombined = next;
      return next;
    });
    setChangelog((prev) => [...prev, ...changes]);

    // Background Drive sync
    withSyncBackground(
      (id) => dataService.addEntry(id, entries),
      { type: 'add', entries },
      newCombined,
      newChangelog,
    );

    return entries;
  }, []);

  /**
   * Add multiple entry groups in a single Drive write. Each group's entries are
   * cross-linked as identicals; entries across groups are not linked.
   * Returns the built groups (Array<Entry[]>) so callers can collect UUIDs.
   */
  const addEntryGroups = useCallback((groups) => {
    const currentCombined = combinedRef.current;

    const builtGroups = groups.map((groupData) => {
      const entries = groupData.map((d) => ({
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
      return entries;
    });

    const allEntries = builtGroups.flat();
    const changes = allEntries.map((e) => createAdditionChange(e));
    const newChangelog = [...changelogRef.current, ...changes];
    changelogRef.current = newChangelog;

    let newCombined;
    setCombined((prev) => {
      const next = new Map(prev);
      allEntries.forEach((e) => next.set(e.uuid, e));
      newCombined = next;
      return next;
    });
    setChangelog((prev) => [...prev, ...changes]);

    withSyncBackground(
      (id) => dataService.addEntries(id, allEntries),
      { type: 'addEntries', entries: allEntries },
      newCombined,
      newChangelog,
    );

    return builtGroups;
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
    const change = createAdditionChange(entry);
    const newChangelog = [...changelogRef.current, change];
    changelogRef.current = newChangelog;

    let newCombined;
    setCombined((prev) => {
      const next = new Map([...prev, [entry.uuid, entry]]);
      newCombined = next;
      return next;
    });
    setChangelog((prev) => [...prev, change]);

    // Background Drive sync
    withSyncBackground(
      (id) => dataService.addCategory(id, { ...categoryData, uuid: entry.uuid }),
      { type: 'addCategory', categoryData: { ...categoryData, uuid: entry.uuid } },
      newCombined,
      newChangelog,
    );

    return entry; // synchronous return so CreateCategoryDialog gets UUID immediately
  }, []);

  /**
   * Modify an entry. Applies locally immediately and syncs in the background.
   */
  const modifyEntry = useCallback((uuid, updates) => {
    const now = Date.now();
    const changes = Object.entries(updates).map(([field, value]) =>
      createModificationChange(uuid, field, Array.isArray(value) ? value.join('|') : String(value ?? ''))
    );
    changes.forEach((c, i) => { c.dateOfChange = now + i; });
    const newChangelog = [...changelogRef.current, ...changes];
    changelogRef.current = newChangelog;

    let newCombined;
    setCombined((prev) => {
      const next = new Map(prev);
      const e = next.get(uuid);
      if (e) next.set(uuid, { ...e, ...updates });
      newCombined = next;
      return next;
    });
    setChangelog((prev) => [...prev, ...changes]);

    // Background Drive sync
    withSyncBackground(
      (id) => dataService.modifyEntry(id, uuid, updates),
      { type: 'modify', uuid, updates },
      newCombined,
      newChangelog,
    );
  }, []);

  /**
   * Delete an entry. Applies locally immediately and syncs in the background.
   */
  const deleteEntry = useCallback((uuid) => {
    const change = createDeletionChange(uuid);
    const newChangelog = [...changelogRef.current, change];
    changelogRef.current = newChangelog;

    let newCombined;
    setCombined((prev) => {
      const n = new Map(prev);
      n.delete(uuid);
      newCombined = n;
      return n;
    });
    setChangelog((prev) => [...prev, change]);

    // Background Drive sync
    withSyncBackground(
      (id) => dataService.deleteEntry(id, uuid),
      { type: 'delete', uuid },
      newCombined,
      newChangelog,
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

  /**
   * Add entries and atomically cross-link them with existing entries (identicals).
   * Everything — addition changes + identicals modification changes — goes through
   * a single Drive write so a mid-sync reload can't leave the entries unlinked or missing.
   */
  const addEntriesWithLinks = useCallback((entryDataArray, existingUuids = []) => {
    const currentCombined = combinedRef.current;
    const raw = Array.isArray(entryDataArray) ? entryDataArray : [entryDataArray];
    const now = Date.now();

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

    const newUuids = entries.map((e) => e.uuid);
    if (entries.length > 1) {
      entries.forEach((e, i) => { e.identicals = newUuids.filter((_, j) => j !== i); });
    }
    if (existingUuids.length > 0) {
      entries.forEach((e) => { e.identicals = [...e.identicals, ...existingUuids]; });
    }

    const addChanges = entries.map((e) => createAdditionChange(e));
    let changeIdx = addChanges.length;

    // Pre-compute modification changes for existing entries using current local state.
    const existingModChanges = existingUuids.flatMap((existingUuid) => {
      const existing = currentCombined.get(existingUuid);
      if (!existing) return [];
      const updated = [...new Set([...(existing.identicals || []), ...newUuids])];
      const change = createModificationChange(existingUuid, 'identicals', updated.join('|'));
      change.dateOfChange = now + changeIdx++;
      return [{ existingUuid, updated, change }];
    });

    const newChangelog = [
      ...changelogRef.current,
      ...addChanges,
      ...existingModChanges.map((m) => m.change),
    ];
    changelogRef.current = newChangelog;

    let newCombined;
    setCombined((prev) => {
      const next = new Map(prev);
      entries.forEach((e) => next.set(e.uuid, e));
      existingModChanges.forEach(({ existingUuid, updated }) => {
        const ex = next.get(existingUuid);
        if (ex) next.set(existingUuid, { ...ex, identicals: updated });
      });
      newCombined = next;
      return next;
    });
    setChangelog((prev) => [...prev, ...addChanges, ...existingModChanges.map((m) => m.change)]);

    withSyncBackground(
      (id) => dataService.addEntriesWithLinks(id, entries, existingUuids),
      { type: 'addWithLinks', entries, existingUuids },
      newCombined,
      newChangelog,
    );

    return entries;
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const categories  = Array.from(combined.values()).filter((e) => e.entryType === 'category');
  const foodEntries = Array.from(combined.values()).filter((e) => e.entryType === 'food');

  return {
    combined, changelog, categories, foodEntries,
    fileId, folderId, loading, syncing, syncError, setSyncError,
    isOffline, pendingCount,
    addEntry, addEntryGroups, addEntriesWithLinks, addCategory, modifyEntry, deleteEntry,
    importCsv, exportCsv,
  };
}
