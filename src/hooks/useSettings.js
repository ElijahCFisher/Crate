import { useState, useEffect, useCallback, useRef } from 'react';
import * as settingsService from '../services/settingsService';

export function useSettings(folderId) {
  const [bulkAdds, setBulkAdds] = useState([]);
  const [following, setFollowing] = useState([]);           // [{ email, displayName, fileId }]
  const [requestedToFollow, setRequestedToFollow] = useState([]); // [{ email, displayName }]
  const [sharedWith, setSharedWith] = useState([]);         // [{ email, displayName }]
  const [fileId, setFileId] = useState(null);

  const fileIdRef = useRef(null);
  // Single ref tracking the authoritative settings state, used when writing
  // to ensure we never lose fields that were updated in a sibling callback.
  const stateRef = useRef({ bulkAdds: [], following: [], requestedToFollow: [], sharedWith: [] });
  // Per-field refs so callbacks can read current values without stale closures.
  const followingRef = useRef([]);
  const requestedRef = useRef([]);

  useEffect(() => { fileIdRef.current = fileId; }, [fileId]);
  useEffect(() => { followingRef.current = following; }, [following]);
  useEffect(() => { requestedRef.current = requestedToFollow; }, [requestedToFollow]);

  useEffect(() => {
    if (!folderId) {
      setFileId(null);
      fileIdRef.current = null;
      const empty = { bulkAdds: [], following: [], requestedToFollow: [], sharedWith: [] };
      stateRef.current = empty;
      setBulkAdds([]);
      setFollowing([]);
      setRequestedToFollow([]);
      setSharedWith([]);
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
        };
        stateRef.current = s;
        followingRef.current = s.following;
        requestedRef.current = s.requestedToFollow;
        setBulkAdds(s.bulkAdds);
        setFollowing(s.following);
        setRequestedToFollow(s.requestedToFollow);
        setSharedWith(s.sharedWith);
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

  return {
    bulkAdds, addBulkAdd,
    following, addToFollowing, removeFromFollowing, promoteToFollowing,
    requestedToFollow, addToRequestedToFollow, removeFromRequestedToFollow,
    sharedWith, addToSharedWith,
  };
}
