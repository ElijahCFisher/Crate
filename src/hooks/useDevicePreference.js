import { useCallback, useEffect, useState } from 'react';

// Preferences that belong to this device rather than the account (layout,
// mostly), kept in localStorage outside the `food_ratings_` prefix that
// signing out clears. Every hook reading the same key stays in step.
const CHANGE_EVENT = 'crate-device-preference';

function read(key, fallback, allowed) {
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) return fallback;
    return allowed && !allowed.includes(stored) ? fallback : stored;
  } catch {
    return fallback;
  }
}

export function useDevicePreference(key, fallback, allowed) {
  const [value, setValue] = useState(() => read(key, fallback, allowed));

  useEffect(() => {
    function sync(e) {
      if (!e.detail || e.detail === key) setValue(read(key, fallback, allowed));
    }
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, [key, fallback, allowed]);

  const update = useCallback((next) => {
    if (allowed && !allowed.includes(next)) return;
    try { localStorage.setItem(key, next); } catch {}
    setValue(next);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
  }, [key, allowed]);

  return [value, update];
}

export const TAB_POSITIONS = ['side', 'top'];
export const TAB_POSITION_KEY = 'crate_tab_position';
