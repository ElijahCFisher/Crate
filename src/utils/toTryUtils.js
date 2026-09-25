/**
 * To Try: places and foods you mean to get to, kept in the same data file as
 * ratings (Entry Type "totry") so they sync, log and work offline the same way.
 *
 * An item reuses the entry fields it shares with a rating —
 *   restaurantName  the place or brand ("Big Sky Burger", "Dutch Bros")
 *   specifier       a food or dish ("challah french toast"); either may be blank
 *   location        where it is ("Denver", "17th St, Denver"); blank for chains
 *   ratingCategory  one of your categories
 *   additionalInfo  notes — hours, who recommended it, links
 *   dateRated       when it was added
 * — plus three of its own: status ('' = open, 'tried', 'gone'), tags (people,
 * DoorDash, anything that isn't a category) and triedRatings (the ratings that
 * came from trying it).
 */
import {
  LABEL_LOCATION, LABEL_NOTES,
} from '../constants/fieldLabels.js';

export const TOTRY_TYPE = 'totry';
export const TOTRY_STATUSES = ['open', 'tried', 'gone'];

export function statusOf(item) {
  return TOTRY_STATUSES.includes(item?.status) ? item.status : 'open';
}

/** The filter bar's fields on the To Try tab. */
export const TOTRY_FIELDS = [
  { value: 'any', label: 'Any field' },
  { value: 'restaurantName', label: 'Place/Brand' },
  { value: 'specifier', label: 'Food' },
  { value: 'location', label: LABEL_LOCATION },
  { value: 'ratingCategory', label: 'Category' },
  { value: 'tags', label: 'Tags' },
  { value: 'additionalInfo', label: LABEL_NOTES },
  { value: 'dateRated', label: 'Date Added' },
  { value: 'uuid', label: 'UUID' },
];

export function makeToTryItem(data = {}) {
  return {
    entryType: TOTRY_TYPE,
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
    linkedFields: {},
    status: '',
    tags: [],
    triedRatings: [],
    ...data,
  };
}

/** What Add Entry should start from when you rate an item. */
export function ratingPrefillFromItem(item) {
  return {
    restaurantName: item.restaurantName || '',
    specifier: item.specifier || '',
    location: item.location || '',
    ratingCategory: item.ratingCategory || '',
    score: null,
    additionalInfo: '',
  };
}

// ── Matching ──────────────────────────────────────────────────────────────────

export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Same name, or a near-miss spelling of a name long enough for that to mean something. */
export function namesMatch(a, b, { fuzzy = false } = {}) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x === y) return true;
  // Short names are too close to each other to forgive typos in ("Tokio" and
  // "Tokyo" are different places); longer ones get one slip, then two.
  const shorter = Math.min(x.length, y.length);
  if (!fuzzy || shorter < 6) return false;
  return editDistance(x, y) <= (shorter < 10 ? 1 : 2);
}

/**
 * Items already on the list that look like the same thing — same place and
 * food, allowing a typo or two ("Mikawaya" / "Mikwaya").
 */
export function findSimilarItems(items, candidate, excludeUuid = null) {
  const hasPlace = normalizeName(candidate.restaurantName);
  const hasFood = normalizeName(candidate.specifier);
  if (!hasPlace && !hasFood) return [];
  return items.filter((item) => {
    if (item.uuid === excludeUuid) return false;
    return namesMatch(item.restaurantName, candidate.restaurantName, { fuzzy: true })
      && namesMatch(item.specifier, candidate.specifier, { fuzzy: true });
  });
}

/**
 * Open items a new rating probably ticks off: same place, and either the item
 * names no particular food or it names this one.
 */
export function openItemsMatchingRating(items, rating) {
  if (!normalizeName(rating.restaurantName)) return [];
  return items.filter((item) => statusOf(item) === 'open'
    && normalizeName(item.restaurantName)
    && namesMatch(item.restaurantName, rating.restaurantName)
    && (!normalizeName(item.specifier) || namesMatch(item.specifier, rating.specifier)));
}
