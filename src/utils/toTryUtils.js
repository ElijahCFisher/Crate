/**
 * To Try: places and foods you mean to get to, kept in the same data file as
 * ratings (Entry Type "totry") so they sync, log and work offline the same way.
 *
 * An item reuses the entry fields it shares with a rating —
 *   restaurantName  the place or brand ("Big Sky Burger", "Dutch Bros")
 *   specifier       a food or dish ("challah french toast"); either may be blank
 *   location        where it is ("Denver", "17th St, Denver"); blank for chains
 *   ratingCategory  its genre, as one of your categories
 *   additionalInfo  notes — hours, who recommended it, links
 *   dateRated       when it was added
 * — plus three of its own: status ('' = open, 'tried', 'gone'), tags (people,
 * DoorDash, a genre that isn't a category) and triedRatings (the ratings that
 * came from trying it).
 */
import { resolveCategoryMatches, buildCategoryIndex } from './textModeUtils';
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
  { value: 'ratingCategory', label: 'Genre' },
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

// ── Importing a hand-kept list ────────────────────────────────────────────────
//
// Built for a doc shaped like:
//
//   Denver: (M = try to go with Mom)
//   Coffee:
//   La Dolce Vita - coffee shop etc. 6:30-5
//   M Guard and Grace (Chef's counter) - Steakhouse
//   Dutch Bros:
//   Og grand canyon
//   Limited Time Gone:
//   McDonald's - Cinnamon roll
//
// A line ending in ":" (or "Name -" with nothing after) is a section header.
// What a header *means* can't be read off the text reliably, so each gets a
// guessed kind the preview lets you change:
//
//   place    a city or region — where everything under it is
//   area     a neighborhood inside the current place ("17th St" → "17th St, Denver")
//   genre    a kind of food — becomes the category, or a tag if no category fits
//   brand    a chain or store — the lines under it are its foods, with no place
//   sublist  a list inside a brand ("Coffee (all blended)" under Dutch Bros)
//   gone     everything under it can't be had anymore
//   section  a plain grouping that just ends the current genre/brand
//   ignore   a label that changes nothing
//
// A header can carry a prefix code too ("M 17th St:"), which tags everything
// under it.

export const HEADER_KINDS = ['place', 'area', 'genre', 'brand', 'sublist', 'gone', 'section', 'ignore'];

const GENRE_WORDS = [
  'coffee', 'tea', 'breakfast', 'brunch', 'lunch', 'dinner', 'dessert', 'desserts', 'bakery',
  'bakeries', 'pastry', 'pastries', 'pizza', 'burger', 'burgers', 'sandwich', 'sandwiches',
  'chicken', 'asian', 'mexican', 'italian', 'chinese', 'japanese', 'korean', 'thai', 'indian',
  'greek', 'mediterranean', 'bbq', 'barbecue', 'sushi', 'ramen', 'taco', 'tacos', 'donut',
  'donuts', 'ice cream', 'drinks', 'frozen', 'snacks', 'candy', 'cereal', 'seafood', 'steak',
  'deli', 'vegan', 'soup', 'noodles', 'smoothie', 'smoothies', 'boba', 'cookies', 'cake',
];

const STREETISH = /\b(st|street|ave|avenue|blvd|boulevard|rd|road|mall|market|square|district|downtown)\b|^\d/i;

function cleanHeaderName(text) {
  return text.replace(/\s*\(.*\)\s*$/, '').replace(/^\((.*)\)/, '$1').trim();
}

function unescapeDocText(line) {
  return line
    .replace(/\\([#&*_\-[\]()])/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .trim();
}

/** { name, legend } for a header line, or null when the line is an item. */
export function readHeaderLine(line) {
  const colon = /^([^:]{1,60}?):\s*(\(([^)]*)\))?\s*$/.exec(line);
  if (colon) return { name: colon[1].trim(), legend: colon[3] || '' };
  const dash = /^([^:]{1,60}?)\s+[-–—]\s*$/.exec(line);
  if (dash) return { name: dash[1].trim(), legend: '' };
  return null;
}

function parseLegend(legend) {
  const codes = new Map();
  for (const m of legend.matchAll(/\b([A-Z]{1,3})\s*=\s*([^,;)]+)/g)) codes.set(m[1], m[2].trim());
  return codes;
}

const PREFIX = /^([A-Z]{1,3})(?:\s+[-–—]\s+|\s+)(?=\S)/;

function singulars(word) {
  return [...new Set([word, word.replace(/ies$/i, 'y'), word.replace(/es$/i, ''), word.replace(/s$/i, '')])];
}

/**
 * The category a genre header names: the whole name first ("Bakeries" →
 * Bakery), then its last or first word ("Frozen pizza" → Pizza, "Breakfast and
 * lunch" → Breakfast). `exact` says whether the header was the category itself,
 * or just pointed at one — in which case its own wording is worth a tag.
 */
function resolveGenreMatch(name, categoryIndex) {
  const base = name.replace(/[()]/g, '').trim();
  for (const variant of singulars(base)) {
    const matches = resolveCategoryMatches(variant, categoryIndex);
    if (matches.length > 0) return { uuid: matches[0], exact: true };
  }
  const words = base.split(/[\s/]+/).filter((w) => w.length > 2);
  for (const word of [words[words.length - 1], words[0]].filter(Boolean)) {
    for (const variant of singulars(word)) {
      const matches = resolveCategoryMatches(variant, categoryIndex);
      if (matches.length > 0) return { uuid: matches[0], exact: false };
    }
  }
  return { uuid: '', exact: false };
}

function resolveGenre(name, categoryIndex) {
  return resolveGenreMatch(name, categoryIndex).uuid;
}

function guessHeaderKind(header, state, ctx) {
  const name = cleanHeaderName(header.name);
  const key = normalizeName(name);
  if (/\b(gone|discontinued|no longer|limited time)\b/i.test(name)) return 'gone';
  if (header.legend) return 'place';
  if (ctx.restaurants.has(key)) return 'brand';
  const genreish = !!resolveGenre(name, ctx.categoryIndex)
    || GENRE_WORDS.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(name));
  if (genreish) return state.brand ? 'sublist' : 'genre';
  if (state.place && ctx.locations.some((loc) => {
    const parts = loc.split(',').map(normalizeName);
    return parts.length > 1 && parts[0] === key && parts.includes(normalizeName(state.place));
  })) return 'area';
  if (ctx.locationParts.has(key)) return 'place';
  if (state.place && (STREETISH.test(name) || state.lastKind === 'area')) return 'area';
  // Unknown names default to places: a place mistaken for a sub-list would drag
  // the brand across every line after it, which is the worse mistake to fix.
  return 'place';
}

function contextFrom({ categories = [], foodEntries = [], toTryItems = [] }) {
  const locations = [...new Set([...foodEntries, ...toTryItems].map((e) => String(e.location || '').trim()).filter(Boolean))];
  const locationParts = new Set();
  for (const loc of locations) {
    locationParts.add(normalizeName(loc));
    for (const part of loc.split(',')) locationParts.add(normalizeName(part));
  }
  return {
    categoryIndex: buildCategoryIndex(categories),
    restaurants: new Set(foodEntries.map((e) => normalizeName(e.restaurantName)).filter(Boolean)),
    locations,
    locationParts,
    toTryItems,
  };
}

/**
 * Read a pasted list into to-try items.
 *
 * `overrides.headerKinds` maps a header's normalized name to a kind;
 * `overrides.codeTags` maps a prefix code ("D") to the tag it stands for.
 * Returns { headers, codes, items } — headers and codes with their guesses so
 * the preview can offer them for correction, and items ready to add (each with
 * `lineNumber` and `duplicateOf` for the preview).
 */
export function parseToTryDoc(text, data = {}, overrides = {}) {
  const ctx = contextFrom(data);
  const headerKinds = overrides.headerKinds || {};
  const codeTags = overrides.codeTags || {};
  const lines = String(text ?? '').split(/\r?\n/);

  // Prefix codes: anything the doc defines in a legend, plus any short capital
  // prefix that turns up at least twice — once could just be a name ("A Taste of…").
  const legendCodes = new Map();
  const prefixCounts = new Map();
  for (const raw of lines) {
    const line = unescapeDocText(raw);
    const header = readHeaderLine(line);
    if (header) {
      for (const [code, meaning] of parseLegend(header.legend)) legendCodes.set(code, meaning);
      continue;
    }
    const m = PREFIX.exec(line);
    if (m) prefixCounts.set(m[1], (prefixCounts.get(m[1]) || 0) + 1);
  }
  const codeSet = new Set([...legendCodes.keys(), ...[...prefixCounts].filter(([, n]) => n >= 2).map(([c]) => c)]);
  const codes = [...codeSet].sort().map((code) => ({
    code,
    meaning: legendCodes.get(code) || '',
    count: prefixCounts.get(code) || 0,
  }));
  const tagForCode = (code) => (codeTags[code] ?? legendCodes.get(code) ?? '').trim() || code;

  // Each scope carries the tags from a prefix code on its own header, and
  // loses them with the scope.
  const state = {
    place: '', area: '', genre: '', parentGenre: '', brand: '', sublist: '', gone: false,
    placeTags: [], areaTags: [], genreTags: [], brandTags: [],
    lastKind: '', itemsSinceHeader: 0,
  };
  const headers = new Map(); // normalized name → { key, name, kind, guessed, count }
  const items = [];
  let currentHeader = null;

  lines.forEach((raw, idx) => {
    const line = unescapeDocText(raw);
    if (!line) return;

    const header = readHeaderLine(line);
    if (header) {
      let headerName = header.name;
      const headerTags = [];
      const code = PREFIX.exec(headerName);
      if (code && codeSet.has(code[1])) {
        headerTags.push(tagForCode(code[1]));
        headerName = headerName.slice(code[0].length).trim();
      }
      const shown = { ...header, name: headerName };
      // Keyed on the full header, so "Coffee:" and "Coffee (all blended):" can
      // be told apart, while the same header repeated ("Pizza:" in two cities)
      // shares one setting.
      const key = normalizeName(headerName);
      const guessed = guessHeaderKind(shown, state, ctx);
      const kind = HEADER_KINDS.includes(headerKinds[key]) ? headerKinds[key] : guessed;
      if (!headers.has(key)) headers.set(key, { key, name: headerName, kind, guessed, count: 0 });
      currentHeader = headers.get(key);
      const name = cleanHeaderName(headerName) || headerName;

      if (kind === 'place') {
        Object.assign(state, {
          place: name, area: '', genre: '', parentGenre: '', brand: '', sublist: '', gone: false,
          placeTags: headerTags, areaTags: [], genreTags: [], brandTags: [],
        });
      } else if (kind === 'area') {
        Object.assign(state, {
          area: name, genre: '', parentGenre: '', brand: '', sublist: '', areaTags: headerTags, genreTags: [], brandTags: [],
        });
      } else if (kind === 'genre') {
        // A genre straight after another with nothing between is nested inside
        // it (Dessert > Bakeries): the outer one is the fallback category.
        const nested = state.lastKind === 'genre' && state.itemsSinceHeader === 0;
        Object.assign(state, {
          parentGenre: nested ? state.genre : '', genre: name, brand: '', sublist: '', genreTags: headerTags, brandTags: [],
        });
      } else if (kind === 'brand') {
        // A brand's list is its menu, not somewhere in particular.
        Object.assign(state, {
          brand: name, sublist: '', place: '', area: '', genre: '', parentGenre: '', brandTags: headerTags,
          placeTags: [], areaTags: [], genreTags: [],
        });
      } else if (kind === 'sublist') {
        state.sublist = name;
      } else if (kind === 'gone') {
        // "Limited Time Gone" is a status for the rest of the list, not a
        // section of whatever place came before it.
        Object.assign(state, {
          gone: true, place: '', area: '', genre: '', parentGenre: '', brand: '', sublist: '',
          placeTags: [], areaTags: [], genreTags: [], brandTags: [],
        });
      } else if (kind === 'section') {
        Object.assign(state, {
          area: '', genre: '', parentGenre: '', brand: '', sublist: '', gone: false, areaTags: [], genreTags: [], brandTags: [],
        });
      }
      state.lastKind = kind;
      state.itemsSinceHeader = 0;
      return;
    }
    state.itemsSinceHeader++;

    let body = line;
    // A whole line in parentheses is an aside about the entry, not part of its name.
    if (/^\(.*\)$/.test(body)) body = body.slice(1, -1).trim();

    // A bare link belongs to the item just above it, if there is one.
    if (/^https?:\/\/\S+$/.test(body) && items.length > 0 && items[items.length - 1].sectionKey === currentHeader?.key) {
      const last = items[items.length - 1];
      last.additionalInfo = [last.additionalInfo, body].filter(Boolean).join(' ');
      return;
    }

    const tags = [];
    const prefix = PREFIX.exec(body);
    if (prefix && codeSet.has(prefix[1])) {
      tags.push(tagForCode(prefix[1]));
      body = body.slice(prefix[0].length).trim();
    }

    let name = body;
    let notes = '';
    const isLink = /^https?:\/\//.test(body);
    // "Name - notes", or "Name: notes" when there's no dash ("7-11: Churro donut").
    const split = /\s+[-–—]\s*/.exec(body) || /:\s+/.exec(body);
    if (split && split.index > 0 && !isLink) {
      name = body.slice(0, split.index).trim();
      notes = body.slice(split.index + split[0].length).replace(/\s*[-–—]\s*$/, '').trim();
    }
    // A trailing parenthetical on the name is a note about it ("Casa Del Rio
    // (best quesadillas…)"), not part of what the place is called.
    const aside = /^(.+?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)$/.exec(name);
    if (aside && !state.brand) {
      name = aside[1].trim();
      notes = [aside[2].trim(), notes].filter(Boolean).join(' — ');
    }
    if (isLink) { name = ''; notes = body; }

    // Most specific genre that names a category wins; any genre that isn't
    // exactly a category keeps its own wording as a tag.
    const genres = [state.sublist, state.genre, state.parentGenre].filter(Boolean);
    let ratingCategory = '';
    for (const genre of genres) {
      const match = resolveGenreMatch(genre, ctx.categoryIndex);
      if (!ratingCategory && match.uuid) ratingCategory = match.uuid;
      if (!match.exact) tags.push(cleanHeaderName(genre).replace(/[()]/g, ''));
    }
    tags.push(...state.placeTags, ...state.areaTags, ...state.genreTags, ...state.brandTags);

    const item = makeToTryItem({
      restaurantName: state.brand || name,
      specifier: state.brand ? body.replace(/\s*[-–—]\s*$/, '') : '',
      location: [state.area, state.place].filter(Boolean).join(', '),
      ratingCategory,
      additionalInfo: state.brand ? '' : notes,
      status: state.gone ? 'gone' : '',
      tags: [...new Set(tags.filter(Boolean))],
    });
    item.lineNumber = idx + 1;
    item.sectionKey = currentHeader?.key || '';
    items.push(item);
    if (currentHeader) currentHeader.count++;
  });

  // Duplicates: against what's already saved, and repeats within the paste.
  items.forEach((item, i) => {
    const existing = findSimilarItems(ctx.toTryItems, item)[0];
    const earlier = findSimilarItems(items.slice(0, i), item)[0];
    item.duplicateOf = existing ? 'existing' : earlier ? `line ${earlier.lineNumber}` : null;
  });

  return { headers: [...headers.values()], codes, items };
}

/** Strip the preview-only bookkeeping before saving. */
export function toSavableItem(item) {
  const { lineNumber, sectionKey, duplicateOf, ...rest } = item;
  return rest;
}
