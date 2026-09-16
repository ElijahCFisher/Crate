/**
 * Where the device is, and what OpenStreetMap calls places near it.
 *
 * Coordinates come from the browser (it asks permission the first time) and go
 * to OpenStreetMap's Nominatim service — nowhere else. Nominatim's usage policy
 * allows at most one request a second and asks that answers be cached, so
 * requests are queued a little over a second apart and results kept in
 * localStorage. The cache sits under the `food_ratings_` prefix, so signing out
 * clears it along with everything else this device knows.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const CACHE_KEY = 'food_ratings_geo_cache_v1';
const CACHE_LIMIT = 300;
const MIN_GAP_MS = 1100;

// ── Device position ───────────────────────────────────────────────────────────

let lastPosition = null;     // { lat, lon, accuracy, at }
let positionRequest = null;

/**
 * The device's position, reused for a few minutes so opening the entry dialog
 * repeatedly doesn't keep asking. Rejects when there's no geolocation or
 * permission is refused — callers treat that as "no location to offer".
 */
export function getDevicePosition({ maxAgeMs = 5 * 60_000 } = {}) {
  if (lastPosition && Date.now() - lastPosition.at < maxAgeMs) return Promise.resolve(lastPosition);
  if (positionRequest) return positionRequest;
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error('Geolocation is not available'));
  }
  positionRequest = new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        };
        resolve(lastPosition);
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: maxAgeMs },
    );
  }).finally(() => { positionRequest = null; });
  return positionRequest;
}

// ── Nominatim, politely ───────────────────────────────────────────────────────

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

function saveCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_LIMIT) {
    keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0));
    for (const key of keys.slice(0, keys.length - CACHE_LIMIT)) delete cache[key];
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

let queue = Promise.resolve();
let lastRequestAt = 0;
const inflight = new Map();

function nominatim(path, params, cacheKey) {
  const cache = loadCache();
  if (cache[cacheKey]) return Promise.resolve(cache[cacheKey].value);
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const request = (queue = queue.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const url = `${NOMINATIM}${path}?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', ...params })}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error(`OpenStreetMap lookup failed (HTTP ${res.status})`);
    const value = await res.json();
    const fresh = loadCache();
    fresh[cacheKey] = { value, at: Date.now() };
    saveCache(fresh);
    return value;
  }));

  // One failure mustn't jam every lookup queued behind it.
  queue = request.catch(() => {});
  const tracked = request.finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, tracked);
  return tracked;
}

/** Nominatim's address for a point: { neighbourhood, suburb, city, … }, or null. */
export async function reverseGeocode(lat, lon) {
  const key = `rev:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const result = await nominatim('/reverse', { lat: String(lat), lon: String(lon), zoom: '16' }, key);
  return result?.address || null;
}

/**
 * Places called `name` within about 25 km of the point — what's nearest is
 * picked by the caller. Rounded to ~1 km for caching, since which branch of a
 * chain is closest doesn't change as you walk across the room.
 */
export async function searchPlacesNear(name, lat, lon, spanDeg = 0.25) {
  const q = String(name || '').trim();
  if (!q) return [];
  const key = `near:${q.toLowerCase()}@${lat.toFixed(2)},${lon.toFixed(2)}`;
  const viewbox = [lon - spanDeg, lat + spanDeg, lon + spanDeg, lat - spanDeg].map((v) => v.toFixed(5)).join(',');
  const results = await nominatim('/search', { q, viewbox, bounded: '1', limit: '10' }, key);
  return Array.isArray(results)
    ? results.map((r) => ({
      name: r.name,
      category: r.category,
      type: r.type,
      lat: Number(r.lat),
      lon: Number(r.lon),
      address: r.address || {},
    }))
    : [];
}
