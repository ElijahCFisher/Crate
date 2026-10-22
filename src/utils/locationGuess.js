/**
 * Turning "where the device is" into a location the way you'd write it.
 *
 * OpenStreetMap supplies the geography; your own past locations supply the
 * wording. Given a neighbourhood and city from OSM, the name is whichever of
 * your locations already says that ("Hampden, Denver"), and only when none
 * does is it built from OSM's parts. Pure functions — the lookups live in
 * geoService and the timing in the entry dialog.
 */

function norm(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The finest named area and the town it's in, from a Nominatim address. */
export function areaAndCity(address = {}) {
  const area = address.neighbourhood || address.quarter || address.suburb || address.city_district || '';
  const city = address.city || address.town || address.village || address.hamlet || address.municipality || '';
  return { area, city };
}

/**
 * Name a Nominatim address in your own words. Prefers, in order: a location of
 * yours naming both its area and city; one naming the area; one naming just
 * the city when OSM has no area; then OSM's own "Area, City".
 */
export function nameLocation(address, knownLocations = []) {
  const { area, city } = areaAndCity(address);
  if (!area && !city) return '';
  const a = norm(area);
  const c = norm(city);

  const known = [...new Set(knownLocations.map((l) => String(l || '').trim()).filter(Boolean))]
    .map((text) => ({ text, parts: text.split(',').map(norm) }));

  if (a && c) {
    const both = known.find((k) => k.parts.includes(a) && k.parts.includes(c));
    if (both) return both.text;
  }
  if (a) {
    const areaOnly = known.find((k) => k.parts[0] === a);
    if (areaOnly) return areaOnly.text;
  }
  if (!a && c) {
    const cityOnly = known.find((k) => k.parts.length === 1 && k.parts[0] === c);
    if (cityOnly) return cityOnly.text;
  }
  return [area, city].filter(Boolean).join(', ');
}

/**
 * Coordinates as they're stored: "39.73921, -104.99025". Five decimals is
 * about a metre, which is finer than any table you'd sit at.
 */
export function formatCoords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

const EATERY_AMENITIES = new Set(['restaurant', 'fast_food', 'cafe', 'ice_cream', 'bar', 'pub', 'food_court', 'biergarten']);
const EATERY_SHOPS = new Set(['bakery', 'confectionery', 'deli', 'coffee', 'tea', 'pastry', 'chocolate', 'butcher', 'cheese', 'supermarket', 'convenience']);

/** A search result that's somewhere to eat or buy food, per OpenStreetMap's tags. */
export function isEatery(place) {
  if (place?.category === 'amenity') return EATERY_AMENITIES.has(place.type);
  if (place?.category === 'shop') return EATERY_SHOPS.has(place.type);
  return false;
}

/**
 * The closest of some search results, if any is within `maxKm`. When any of
 * them serve food only those count — a name search for "In-N-Out" also turns
 * up the In-N-Out Car Wash.
 */
export function nearestPlace(results, lat, lon, maxKm = 25) {
  const eateries = (results || []).filter(isEatery);
  let best = null;
  for (const place of eateries.length > 0 ? eateries : results || []) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    const km = distanceKm(lat, lon, place.lat, place.lon);
    if (km <= maxKm && (!best || km < best.km)) best = { ...place, km };
  }
  return best;
}

function locationParts(text) {
  return String(text ?? '').split(',').map((part) => norm(part)).filter(Boolean);
}

/**
 * Two of your location names for the same place — "Denver" and
 * "Hampden, Denver", or "Speedway" and "Speedway, Tucson". Any part in common
 * counts, since your names are "area, city" and either half may be left off.
 */
export function locationsAgree(a, b) {
  const parts = locationParts(b);
  return locationParts(a).some((part) => parts.includes(part));
}

/**
 * Which guess wins for a rating with no location of its own:
 *   1. the nearest branch of the restaurant you named, found around you;
 *   2. where you are;
 *   3. where you last rated that restaurant — but only when it's the same
 *      place you're in and says it more precisely ("Hampden, Denver" while
 *      OpenStreetMap only knew "Denver").
 *
 * Where you last had a brand is no evidence of where you are now: the last
 * Lay's was in Spain, and most brands' newest location is nowhere near home.
 * So it never stands in for not knowing where you are — with no position
 * there's no guess at all.
 *
 * Each is { location, coordinates } — the name to show and the point to
 * record — or null. A guess may carry coordinates and no name, which records
 * where you were and leaves the field alone; `here` doesn't, since coordinates
 * stand in as its name when OpenStreetMap can't supply one.
 */
export function chooseAutoLocation({ branch = null, history = null, here = null } = {}) {
  if (branch?.location) return { location: branch.location, coordinates: branch.coordinates || '' };
  if (!here?.location && !here?.coordinates) return null;
  if (here.location && history?.location
    && locationsAgree(history.location, here.location)
    && locationParts(history.location).length > locationParts(here.location).length) {
    return { location: history.location, coordinates: here.coordinates || '' };
  }
  return { location: here.location || '', coordinates: here.coordinates || '' };
}
