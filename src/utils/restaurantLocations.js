/**
 * Where you've eaten at each restaurant before, most recent first — for
 * filling in the location once you've named the restaurant, and for putting
 * that restaurant's own locations at the top of the location suggestions.
 */

function key(name) {
  return String(name ?? '').trim().toLowerCase();
}

/** Map of lowercased restaurant name → its distinct locations, newest visit first. */
export function buildRestaurantLocations(entries) {
  const newestFirst = [...entries]
    .filter((e) => key(e.restaurantName) && String(e.location ?? '').trim())
    .sort((a, b) => (b.dateRated ?? 0) - (a.dateRated ?? 0));

  const byRestaurant = new Map();
  for (const entry of newestFirst) {
    const restaurant = key(entry.restaurantName);
    const location = entry.location.trim();
    if (!byRestaurant.has(restaurant)) byRestaurant.set(restaurant, []);
    const list = byRestaurant.get(restaurant);
    if (!list.some((l) => l.toLowerCase() === location.toLowerCase())) list.push(location);
  }
  return byRestaurant;
}

export function locationsForRestaurant(byRestaurant, restaurantName) {
  return byRestaurant.get(key(restaurantName)) || [];
}

/** The restaurant's own locations first, then every other known location. */
export function orderLocationSuggestions(allLocations, byRestaurant, restaurantName) {
  const own = locationsForRestaurant(byRestaurant, restaurantName);
  if (own.length === 0) return allLocations;
  const ownSet = new Set(own.map((l) => l.toLowerCase()));
  return [...own, ...allLocations.filter((l) => !ownSet.has(l.toLowerCase()))];
}
