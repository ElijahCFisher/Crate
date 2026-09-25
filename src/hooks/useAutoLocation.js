import { useCallback, useEffect, useRef, useState } from 'react';
import { getDevicePosition, reverseGeocode, searchPlacesNear } from '../services/geoService';
import { chooseAutoLocation, formatCoords, nameLocation, nearestPlace } from '../utils/locationGuess';
import { locationsForRestaurant } from '../utils/restaurantLocations';

export const AUTO_LOCATION_KEY = 'crate_auto_location';
export const AUTO_LOCATION_VALUES = ['on', 'off'];

/**
 * Location guesses for the entry dialog while it's open. Each guess is
 * { location, coordinates } — the name to show and the point to record.
 *
 * `auto` decides whether the dialog fills anything in by itself. That's what a
 * phone is for; at a computer you're rarely where the food was, so nothing is
 * looked up and nothing is guessed until `locate()` is called from the dialog's
 * location button.
 *
 * `request(names)` looks up the nearest branch of each named restaurant; call
 * it once names have stopped changing. `suggestFor(name)` is synchronous and
 * returns the best guess known right now — so it can be used at save time —
 * and `version` bumps whenever a lookup lands, so callers can re-apply.
 */
export function useAutoLocation({ open, enabled, auto = true, knownLocations, restaurantLocations }) {
  const [here, setHere] = useState(null);
  const [position, setPosition] = useState(null);
  const [version, setVersion] = useState(0);
  const branchesRef = useRef(new Map()); // lowercased name → guess, null when none nearby
  const requestedRef = useRef(new Set());
  const knownRef = useRef(knownLocations);
  knownRef.current = knownLocations;

  /**
   * Where the device is: its coordinates, named through OpenStreetMap. The
   * name is what you'd write, and the coordinates are recorded as well, so a
   * failed or nameless lookup still leaves the point itself.
   */
  const locate = useCallback(async () => {
    if (!enabled) return null;
    try {
      const pos = await getDevicePosition();
      setPosition(pos);
      const coordinates = formatCoords(pos.lat, pos.lon);
      let name = '';
      try {
        const address = await reverseGeocode(pos.lat, pos.lon);
        name = nameLocation(address, knownRef.current);
      } catch (err) {
        console.info('[location] could not name where you are:', err?.message || err);
      }
      const guess = { location: name || coordinates, coordinates };
      setHere(guess);
      return guess;
    } catch (err) {
      // Permission refused, no GPS, or OSM unreachable: just no guess.
      if (err?.code !== 1) console.info('[location] no device location guess:', err?.message || err);
      return null;
    }
  }, [enabled]);

  useEffect(() => {
    if (!open || !enabled || !auto) return;
    locate();
  }, [open, enabled, auto, locate]);

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
          branchesRef.current.set(key, nearest ? {
            location: nameLocation(nearest.address, knownRef.current),
            coordinates: formatCoords(nearest.lat, nearest.lon),
          } : null);
        })
        .catch(() => branchesRef.current.set(key, null))
        .finally(() => setVersion((v) => v + 1));
    }
  }, [enabled, position]);

  const suggestFor = useCallback((restaurantName) => {
    if (!enabled || !auto) return null;
    const key = String(restaurantName || '').trim().toLowerCase();
    const lastVisit = key ? locationsForRestaurant(restaurantLocations, restaurantName)[0] || '' : '';
    return chooseAutoLocation({
      branch: key ? branchesRef.current.get(key) || null : null,
      history: lastVisit ? { location: lastVisit, coordinates: '' } : null,
      here,
    });
  }, [enabled, auto, here, restaurantLocations, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return { here, ready: !!position, locate, request, suggestFor, version };
}
