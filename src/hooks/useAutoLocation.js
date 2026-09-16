import { useCallback, useEffect, useRef, useState } from 'react';
import { getDevicePosition, reverseGeocode, searchPlacesNear } from '../services/geoService';
import { chooseAutoLocation, nameLocation, nearestPlace } from '../utils/locationGuess';
import { locationsForRestaurant } from '../utils/restaurantLocations';

export const AUTO_LOCATION_KEY = 'crate_auto_location';
export const AUTO_LOCATION_VALUES = ['on', 'off'];

/**
 * Location guesses for the entry dialog while it's open.
 *
 * On open it asks for the device's position and names it ("where you are").
 * `request(names)` looks up the nearest branch of each named restaurant; call
 * it once names have stopped changing. `suggestFor(name)` is synchronous and
 * returns the best guess known right now — so it can be used at save time —
 * and `version` bumps whenever a lookup lands, so callers can re-apply.
 */
export function useAutoLocation({ open, enabled, knownLocations, restaurantLocations }) {
  const [here, setHere] = useState('');
  const [position, setPosition] = useState(null);
  const [version, setVersion] = useState(0);
  const branchesRef = useRef(new Map()); // lowercased name → location string, '' when none nearby
  const requestedRef = useRef(new Set());
  const knownRef = useRef(knownLocations);
  knownRef.current = knownLocations;

  useEffect(() => {
    if (!open || !enabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const pos = await getDevicePosition();
        if (cancelled) return;
        setPosition(pos);
        const address = await reverseGeocode(pos.lat, pos.lon);
        if (cancelled) return;
        setHere(nameLocation(address, knownRef.current));
      } catch (err) {
        // Permission refused, no GPS, or OSM unreachable: just no guess.
        if (err?.code !== 1) console.info('[location] no device location guess:', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [open, enabled]);

  const request = useCallback((names) => {
    if (!enabled || !position) return;
    for (const raw of names) {
      const name = String(raw || '').trim();
      const key = name.toLowerCase();
      if (!name || requestedRef.current.has(key)) continue;
      requestedRef.current.add(key);
      searchPlacesNear(name, position.lat, position.lon)
        .then((results) => {
          const nearest = nearestPlace(results, position.lat, position.lon);
          branchesRef.current.set(key, nearest ? nameLocation(nearest.address, knownRef.current) : '');
        })
        .catch(() => branchesRef.current.set(key, ''))
        .finally(() => setVersion((v) => v + 1));
    }
  }, [enabled, position]);

  const suggestFor = useCallback((restaurantName) => {
    if (!enabled) return '';
    const key = String(restaurantName || '').trim().toLowerCase();
    return chooseAutoLocation({
      branch: key ? branchesRef.current.get(key) || '' : '',
      history: key ? locationsForRestaurant(restaurantLocations, restaurantName)[0] || '' : '',
      here,
    });
  }, [enabled, here, restaurantLocations, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return { here, ready: !!position, request, suggestFor, version };
}
