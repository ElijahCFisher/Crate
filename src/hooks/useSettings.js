import { useState, useEffect, useCallback, useRef } from 'react';
import * as settingsService from '../services/settingsService';

export function useSettings(folderId) {
  const [bulkAdds, setBulkAdds] = useState([]);
  const [following, setFollowing] = useState([]);           // [{ email, displayName, fileId }]
  const [requestedToFollow, setRequestedToFollow] = useState([]); // [{ email, displayName }]
  const [sharedWith, setSharedWith] = useState([]);         // [{ email, displayName }]
  const [showAdvancedByDefault, setShowAdvancedByDefault] = useState(false);
  const [notes, setNotes] = useState('');
  const [fileId, setFileId] = useState(null);

  const fileIdRef = useRef(null);
  // Single ref tracking the authoritative settings state, used when writing
  // to ensure we never lose fields that were updated in a sibling callback.
  const stateRef = useRef({ bulkAdds: [], following: [], requestedToFollow: [], sharedWith: [], showAdvancedByDefault: false, notes: '' });
  // Per-field refs so callbacks can read current values without stale closures.
  const followingRef = useRef([]);
  const requestedRef = useRef([]);
  const notesDebounceRef = useRef(null);

  useEffect(() => { fileIdRef.current = fileId; }, [fileId]);
  useEffect(() => { followingRef.current = following; }, [following]);
  useEffect(() => { requestedRef.current = requestedToFollow; }, [requestedToFollow]);

  useEffect(() => {
    if (!folderId) {
      setFileId(null);
      fileIdRef.current = null;
      const empty = { bulkAdds: [], following: [], requestedToFollow: [], sharedWith: [], showAdvancedByDefault: false, notes: '' };
      stateRef.current = empty;
      setBulkAdds([]);
      setFollowing([]);
      setRequestedToFollow([]);
      setSharedWith([]);
      setShowAdvancedByDefault(false);
      setNotes('');
      return;
    }
    let cancelled = false;
    async function init() {
      try {
        const id = await settingsService.getOrCreateSettingsFile(folderId);
        if (cancelled) return;
        setFileId(id);
        fileIdRef.current = id;
        const settings = await settingsService.readSettings(id);
        if (cancelled) return;
        const s = {
          bulkAdds: settings.bulkAdds || [],
          following: settings.following || [],
          requestedToFollow: settings.requestedToFollow || [],
          sharedWith: settings.sharedWith || [],
          showAdvancedByDefault: settings.showAdvancedByDefault ?? false,
          notes: settings.notes || '',
        };
        stateRef.current = s;
        followingRef.current = s.following;
        requestedRef.current = s.requestedToFollow;
        setBulkAdds(s.bulkAdds);
        setFollowing(s.following);
        setRequestedToFollow(s.requestedToFollow);
        setSharedWith(s.sharedWith);
        setShowAdvancedByDefault(s.showAdvancedByDefault);
        setNotes(s.notes);
      } catch (err) {
        console.error('Settings load failed:', err);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [folderId]);

  function persist(updates) {
    stateRef.current = { ...stateRef.current, ...updates };
    const id = fileIdRef.current;
    if (id) settingsService.writeSettings(id, stateRef.current).catch(console.error);
  }

  const addBulkAdd = useCallback((uuids) => {
    if (!uuids || uuids.length === 0) return;
    setBulkAdds((prev) => {
      const next = [uuids, ...prev];
      persist({ bulkAdds: next });
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Sync local bulkAdds state WITHOUT persisting — for when something else
   * (dataService.addBulkRating, called directly) already wrote the settings
   * file, and this is just reflecting that result in the UI.
   */
  const setBulkAddsLocal = useCallback((next) => {
    setBulkAdds(next);
    stateRef.current = { ...stateRef.current, bulkAdds: next };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateBulkAdd = useCallback((anchorUuid, newUuids) => {
    if (!newUuids || newUuids.length === 0) return;
    setBulkAdds((prev) => {
      const idx = prev.findIndex((group) => group.includes(anchorUuid));
      if (idx === -1) return prev;
      const next = prev.map((group, i) =>
        i === idx ? [...group, ...newUuids.filter((u) => !group.includes(u))] : group
      );
      persist({ bulkAdds: next });
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addToFollowing = useCallback((friend) => {
    // friend: { email, displayName, fileId }
    setFollowing((prev) => {
      if (prev.some((f) => f.email === friend.email)) return prev;
      const next = [...prev, friend];
      followingRef.current = next;
      persist({ following: next });
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const removeFromFollowing = useCallback((email) => {
    setFollowing((prev) => {
      const next = prev.filter((f) => f.email !== email);
      followingRef.current = next;
      persist({ following: next });
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addToRequestedToFollow = useCallback((person) => {
    // person: { email, displayName }
    setRequestedToFollow((prev) => {
      if (prev.some((p) => p.email === person.email)) return prev;
      const next = [...prev, person];
      requestedRef.current = next;
      persist({ requestedToFollow: next });
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const removeFromRequestedToFollow = useCallback((email) => {
    setRequestedToFollow((prev) => {
      const next = prev.filter((p) => p.email !== email);
      requestedRef.current = next;
      persist({ requestedToFollow: next });
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Move a person from requestedToFollow → following once they've shared their file.
  const promoteToFollowing = useCallback((email, friendFileId) => {
    const person = requestedRef.current.find((p) => p.email === email);
    const nextRequested = requestedRef.current.filter((p) => p.email !== email);
    const nextFollowing = followingRef.current.some((f) => f.email === email)
      ? followingRef.current
      : [...followingRef.current, { ...(person || { email, displayName: email }), fileId: friendFileId }];

    requestedRef.current = nextRequested;
    followingRef.current = nextFollowing;
    setRequestedToFollow(nextRequested);
    setFollowing(nextFollowing);
    persist({ requestedToFollow: nextRequested, following: nextFollowing });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addToSharedWith = useCallback((person) => {
    // person: { email, displayName }
    setSharedWith((prev) => {
      if (prev.some((p) => p.email === person.email)) return prev;
      const next = [...prev, person];
      persist({ sharedWith: next });
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateShowAdvancedByDefault = useCallback((value) => {
    setShowAdvancedByDefault(value);
    persist({ showAdvancedByDefault: value });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateNotes = useCallback((value) => {
    setNotes(value);
    stateRef.current = { ...stateRef.current, notes: value };
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => {
      const id = fileIdRef.current;
      if (id) settingsService.writeSettings(id, stateRef.current).catch(console.error);
    }, 1000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    fileId,
    bulkAdds, addBulkAdd, updateBulkAdd, setBulkAddsLocal,
    following, addToFollowing, removeFromFollowing, promoteToFollowing,
    requestedToFollow, addToRequestedToFollow, removeFromRequestedToFollow,
    sharedWith, addToSharedWith,
    showAdvancedByDefault, updateShowAdvancedByDefault,
    notes, updateNotes,
  };
}
