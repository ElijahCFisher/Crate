import { useState, useEffect, useCallback, useRef } from 'react';
import * as settingsService from '../services/settingsService';

export function useSettings(folderId) {
  const [bulkAdds, setBulkAdds] = useState([]);
  const [fileId, setFileId] = useState(null);
  const fileIdRef = useRef(null);

  useEffect(() => { fileIdRef.current = fileId; }, [fileId]);

  useEffect(() => {
    if (!folderId) {
      setFileId(null);
      fileIdRef.current = null;
      setBulkAdds([]);
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
        setBulkAdds(settings.bulkAdds || []);
      } catch (err) {
        console.error('Settings load failed:', err);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [folderId]);

  const addBulkAdd = useCallback((uuids) => {
    if (!uuids || uuids.length === 0) return;
    setBulkAdds((prev) => {
      const next = [uuids, ...prev];
      const id = fileIdRef.current;
      if (id) settingsService.writeSettings(id, { bulkAdds: next }).catch(console.error);
      return next;
    });
  }, []);

  return { bulkAdds, addBulkAdd };
}
