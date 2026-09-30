/**
 * Text mode: a whole visit typed as plain text, as an alternative to the form.
 *
 *   Zorba's
 *   Denver
 *   Gyro 8 greek really tender
 *   Combo platter 7
 *     Fries 5 too salty
 *   9/1
 *
 *   Next Restaurant
 *   ...
 *
 * Line 1 of a block is the restaurant, line 2 the location (unless it already
 * looks like a rating, in which case the block has no location), and the rest
 * are ratings: `[indent] food name  score  [category]  [notes]`. A blank line
 * ends the block. A score of `?` is one that hasn't been decided yet — every
 * rating line carries a score of some kind, which is what keeps it from being
 * read as the location.
 *
 * An indented line is a component of the last un-indented rating above it, and
 * its notes get prefixed with "From <that food>".
 *
 * A line that is nothing but a date — `9/1`, `9/1/25`, `9/1/2025`, `2025-09-01`
 * — dates what is *above* it. A bare `9/1` means this year. Each rating takes
 * the first of these that exists:
 *
 *   1. a date directly under that rating;
 *   2. a date under the whole group of ratings for that restaurant;
 *   3. a date under the restaurant name, before any of its ratings;
 *   4. the nearest date anywhere below it — so one date at the bottom covers
 *      every restaurant above it that hasn't said otherwise;
 *   5. nothing, which leaves the rating's own date alone (today, for a new one).
 *
 * Categories are only ever *inferred*, never created: whatever follows the
 * score is matched against existing category names longest-phrase-first, and
 * anything that doesn't match is just notes. Two categories can share a name
 * ("breakfast > egg" and "side > egg"), so a category can also be written as a
 * path, outermost first: `breakfast > egg`, `breakfast -> egg` or
 * `breakfast/egg`. A name that shares its wording with a name further in wins
 * by being further out — plain `chicken` is `main > chicken`, not
 * `main > sandwich > chicken`.
 *
 * Square brackets say where the category ends, for when guessing that from the
 * notes isn't good enough: `Gyro 8 [french toast] really tender` is the French
 * toast category and "really tender". Anything can go in them, a path
 * included — `[breakfast > french toast]` — and empty brackets mean no
 * category at all, so `Fries 7 [] chicken was dry` keeps "chicken was dry" as
 * notes rather than reading a category out of it.
 */

const SCORE_PATTERN = /^\d{1,2}(?:\.\d+)?$/;
const INDENT_PATTERN = /^(?:\t| {2,})/;
/**
 * Stands in for the score of a rating that hasn't been given one yet. Without
 * it such a line carries no number, and a line with no number in the location's
 * slot reads as the location — which quietly ate the rating, moved everyone
 * else's location and split the block in two.
 */
const NO_SCORE = '?';
/** `>`, `->` or `/` separate the steps of a category path. */
const PATH_SEPARATOR = /\s*(?:->|>|\/)\s*/;
/** A leading `a > b` phrase, used to explain a path that matched nothing. */
const EXPLICIT_PATH = /^(\S+(?:\s*(?:->|>)\s*\S+)+)/;
/** A category in square brackets, which says where it ends. */
const BRACKETED_CATEGORY = /^\[([^\]]*)\]\s*/;

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Index categories by normalized name — several can share one name. */
export function buildCategoryIndex(categories = []) {
  const byUuid = new Map(categories.map((c) => [c.uuid, c]));
  const byName = new Map();
  for (const category of categories) {
    const key = normalize(category.restaurantName);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(category);
  }
  return { byUuid, byName };
}

/** The categories above this one, closest parent first. */
function ancestorChain(category, byUuid) {
  const chain = [];
  const seen = new Set();
  let current = category.ratingCategory;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byUuid.get(current);
    if (!parent) break;
    chain.push(parent);
    current = parent.ratingCategory;
  }
  return chain;
}

function ancestorNames(category, byUuid) {
  return ancestorChain(category, byUuid).map((c) => normalize(c.restaurantName));
}

/** True when `names` (closest ancestor first) appear in order above `category`. */
function hasAncestorPath(category, names, byUuid) {
  const chain = ancestorNames(category, byUuid);
  let at = 0;
  for (const name of names) {
    at = chain.indexOf(name, at);
    if (at === -1) return false;
    at++;
  }
  return true;
}

/**
 * True when `names` (closest ancestor first) ARE the immediate parent chain,
 * with no category in between. "main/chicken" matching only loosely is what let
 * it mean both "main > chicken" and "main > sandwich > chicken" at once, so a
 * full path could not do the one thing paths exist for.
 */
function isParentChain(category, names, byUuid) {
  const chain = ancestorNames(category, byUuid);
  return names.every((name, i) => chain[i] === name);
}

/**
 * Categories with the fewest above them first, ties keeping the order they
 * came in. Where a name repeats down one branch — `main > chicken` and
 * `main > sandwich > chicken` — the outer one is the broader thing, and the
 * broader thing is what a bare word means.
 */
function shallowestFirst(categories, byUuid) {
  return categories
    .map((category, order) => ({ category, order, depth: ancestorChain(category, byUuid).length }))
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map(({ category }) => category);
}

/**
 * Every existing category a phrase could mean, best first. Never invents one.
 * An exact name wins; failing that the phrase is read as a path from the
 * outside in ("breakfast > egg", "breakfast/egg"), preferring a path that names
 * the real parent chain over one that merely has those names somewhere above;
 * failing that "chicken sandwich" looks for a "chicken" category somewhere
 * under a "sandwich" one. Within each of those, shallowest first.
 */
export function resolveCategoryMatches(phrase, index) {
  const key = normalize(phrase);
  if (!key) return [];

  const exact = index.byName.get(key);
  if (exact && exact.length > 0) return shallowestFirst(exact, index.byUuid).map((c) => c.uuid);

  const segments = key.split(PATH_SEPARATOR).map(normalize);
  if (segments.length > 1 && segments.every(Boolean)) {
    const leaf = segments[segments.length - 1];
    // The path reads outermost-first; the ancestor chain reads inside-out.
    const wanted = segments.slice(0, -1).reverse();
    const loose = (index.byName.get(leaf) || [])
      .filter((c) => hasAncestorPath(c, wanted, index.byUuid));
    // A path that names the real parent chain wins outright, so writing one is
    // how you pick between categories sharing a name. Only when nothing matches
    // that tightly does a gappy path ("main/chicken" for something nested
    // deeper) still resolve, which is the convenience worth keeping.
    const exactChain = loose.filter((c) => isParentChain(c, wanted, index.byUuid));
    return shallowestFirst(exactChain.length > 0 ? exactChain : loose, index.byUuid).map((c) => c.uuid);
  }

  const words = key.split(' ');
  for (let split = words.length - 1; split >= 1; split--) {
    const childName = words.slice(0, split).join(' ');
    const ancestorName = words.slice(split).join(' ');
    const matches = (index.byName.get(childName) || [])
      .filter((c) => ancestorNames(c, index.byUuid).includes(ancestorName));
    if (matches.length > 0) return shallowestFirst(matches, index.byUuid).map((c) => c.uuid);
  }
  return [];
}

/** Resolve a phrase to an existing category uuid, or null. */
export function resolveCategoryPhrase(phrase, index) {
  const matches = resolveCategoryMatches(phrase, index);
  return matches.length > 0 ? matches[0] : null;
}

/** A category's full path from the root, e.g. "breakfast > egg". */
export function categoryPath(uuid, index) {
  const category = index.byUuid.get(uuid);
  if (!category) return '';
  const names = ancestorChain(category, index.byUuid).map((c) => c.restaurantName || '');
  return [...names.reverse(), category.restaurantName || ''].filter(Boolean).join(' > ');
}

/**
 * The shortest way to write a category that still means only this one: its
 * bare name when that's unique, otherwise as much of its path as it takes.
 */
export function categoryPhrase(uuid, index) {
  const category = index.byUuid.get(uuid);
  if (!category) return '';
  const chain = ancestorChain(category, index.byUuid);
  let phrase = category.restaurantName || '';
  for (let depth = 0; depth < chain.length; depth++) {
    const matches = resolveCategoryMatches(phrase, index);
    if (matches.length === 1 && matches[0] === uuid) return phrase;
    phrase = `${chain[depth].restaurantName || ''} > ${phrase}`;
  }
  return phrase;
}

/**
 * Read a line that is nothing but a date. `9/1` is this year; `9/1/25`,
 * `9/1/2025` and `2025-09-01` say which. Returns YYYY-MM-DD, or null when the
 * line isn't a date at all (or names a day that doesn't exist).
 */
export function parseDateLine(line, now = new Date()) {
  const text = String(line ?? '').trim();
  let year;
  let month;
  let day;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const slashed = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(text);
    if (!slashed) return null;
    month = Number(slashed[1]);
    day = Number(slashed[2]);
    if (slashed[3] === undefined) year = now.getFullYear();
    else year = Number(slashed[3]) < 100 ? 2000 + Number(slashed[3]) : Number(slashed[3]);
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Render YYYY-MM-DD as a date line: `9/1` this year, `9/1/2025` otherwise. */
export function formatDateLine(dateRated, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateRated ?? '').trim());
  if (!match) return '';
  const year = Number(match[1]);
  const short = `${Number(match[2])}/${Number(match[3])}`;
  return year === now.getFullYear() ? short : `${short}/${year}`;
}

function findScoreIndex(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === NO_SCORE) return i;
    if (SCORE_PATTERN.test(tokens[i]) && parseFloat(tokens[i]) <= 10) return i;
  }
  return -1;
}

/** One phrase, several categories: take the outermost and say so. */
function ambiguous(matches, phrase, notes, index) {
  const options = matches.map((uuid) => categoryPath(uuid, index)).join(', ');
  return {
    ratingCategory: matches[0],
    notes,
    warning: `"${phrase}" matches ${matches.length} categories (${options}) —`
      + ` used ${categoryPath(matches[0], index)}, the one with fewest above it.`
      + ` Write a path, like "${categoryPath(matches[1], index)}", to pick another.`,
  };
}

/**
 * The category after the score, and the notes after that.
 *
 * Square brackets say outright where the category ends; empty ones say there
 * isn't one. Otherwise it's the longest leading phrase that names a real
 * category, the rest being notes. A phrase that names several categories, or
 * one written on purpose — in brackets or as a path — that names none, comes
 * back with a warning rather than silently doing something.
 */
function splitCategoryAndNotes(tokens, index) {
  const rest = tokens.join(' ');

  const bracketed = BRACKETED_CATEGORY.exec(rest);
  if (bracketed) {
    const phrase = bracketed[1].trim();
    const notes = rest.slice(bracketed[0].length).trim();
    if (!phrase) return { ratingCategory: '', notes, warning: null };
    const matches = resolveCategoryMatches(phrase, index);
    if (matches.length === 1) return { ratingCategory: matches[0], notes, warning: null };
    if (matches.length > 1) return ambiguous(matches, phrase, notes, index);
    return {
      ratingCategory: '',
      notes: [phrase, notes].filter(Boolean).join(' '),
      warning: `No category matches "${phrase}" — kept it as notes.`,
    };
  }

  for (let count = tokens.length; count >= 1; count--) {
    const phrase = tokens.slice(0, count).join(' ');
    const matches = resolveCategoryMatches(phrase, index);
    if (matches.length === 0) continue;
    const notes = tokens.slice(count).join(' ');
    if (matches.length === 1) return { ratingCategory: matches[0], notes, warning: null };
    return ambiguous(matches, phrase, notes, index);
  }

  const written = EXPLICIT_PATH.exec(rest);
  return {
    ratingCategory: '',
    notes: rest,
    warning: written ? `No category matches "${written[1]}" — kept it as notes.` : null,
  };
}

export function parseRatingLine(line, { indented = false, index, parentFood = '' } = {}) {
  const tokens = String(line).trim().split(/\s+/).filter(Boolean);
  const scoreAt = findScoreIndex(tokens);
  if (scoreAt === -1) {
    return { error: `No score found — every rating line needs a number from 0 to 10, or ${NO_SCORE} for one you haven't scored yet.` };
  }

  const score = tokens[scoreAt] === NO_SCORE ? '' : tokens[scoreAt];
  const specifier = tokens.slice(0, scoreAt).join(' ');
  const { ratingCategory, notes, warning } = splitCategoryAndNotes(tokens.slice(scoreAt + 1), index);

  let additionalInfo = notes;
  if (indented && parentFood) {
    additionalInfo = notes ? `From ${parentFood} ${notes}` : `From ${parentFood}`;
  }

  return { specifier, score, ratingCategory, additionalInfo, indented, warning };
}

/** The date line closing a block, if its last line is one. */
function blockTrailingDate(block) {
  const last = block?.events[block.events.length - 1];
  return last?.type === 'date' ? last.date : '';
}

/** A date under the restaurant name, before any of its ratings. */
function blockLeadingDate(block) {
  const first = block?.events[0];
  return first?.type === 'date' ? first.date : '';
}

/**
 * Hand each rating its date, most specific placement first — see the rules at
 * the top of this file. A rating with no date below it anywhere is left blank,
 * which means "keep the date it already has".
 */
function resolveRatingDates(events) {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type !== 'rating') continue;

    let date = events[i + 1]?.type === 'date' ? events[i + 1].date : '';
    if (!date) date = blockTrailingDate(event.block);
    if (!date) date = blockLeadingDate(event.block);
    if (!date) {
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].type === 'date') { date = events[j].date; break; }
      }
    }
    event.rating.dateRated = date;
  }
}

/**
 * Parse the whole box. Returns flat ratings (each carrying the restaurant,
 * location and date that apply to it, plus the source line number for
 * re-matching), any lines that couldn't be read, and warnings about categories
 * that had to be guessed at.
 */
export function parseText(text, categories = [], { now = new Date() } = {}) {
  const index = buildCategoryIndex(categories);
  const ratings = [];
  const errors = [];
  const warnings = [];
  const blocks = [];
  // Ratings and date lines in the order they appear, so each rating can be
  // given the date that applies to it once the whole text has been read.
  const events = [];

  let block = null;
  let parentFood = '';

  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const lineNumber = i + 1;
    if (raw.trim() === '') {
      block = null;
      parentFood = '';
      return;
    }

    const indented = INDENT_PATTERN.test(raw);
    const line = raw.trim();

    // A line that is only a date is never a restaurant name or a location —
    // it dates what's above it, even standing alone after a blank line.
    const date = parseDateLine(line, now);
    if (date) {
      const event = { type: 'date', date, block, lineNumber };
      events.push(event);
      block?.events.push(event);
      return;
    }

    if (!block) {
      block = {
        restaurantName: line === NO_SCORE ? '' : line,
        location: '',
        dateRated: '',
        seenBody: false,
        ratingCount: 0,
        ratings: [],
        events: [],
      };
      blocks.push(block);
      return;
    }

    // Second line is the location unless it already reads as a rating.
    if (!block.seenBody && !indented) {
      block.seenBody = true;
      if (findScoreIndex(line.split(/\s+/)) === -1) {
        block.location = line;
        return;
      }
    }
    block.seenBody = true;

    const parsed = parseRatingLine(line, { indented, index, parentFood });
    if (parsed.error) {
      errors.push({ lineNumber, text: raw, message: parsed.error });
      return;
    }
    if (parsed.warning) warnings.push({ lineNumber, text: raw, message: parsed.warning });
    if (!indented) parentFood = parsed.specifier;

    block.ratingCount++;
    const rating = {
      ...parsed,
      restaurantName: block.restaurantName,
      location: block.location,
      dateRated: '',
      lineNumber,
    };
    block.ratings.push(rating);
    block.events.push({ type: 'rating', rating, block, lineNumber });
    events.push(block.events[block.events.length - 1]);
    ratings.push(rating);
  });

  resolveRatingDates(events);
  // A block with no ratings yet still has a date if one was written under it —
  // that's a restaurant typed ahead of what you ate there.
  for (const b of blocks) b.dateRated = blockTrailingDate(b) || blockLeadingDate(b);

  return { ratings, errors, warnings, blocks };
}

/**
 * Render ratings back to text. Returns the lines with the rating id each one
 * came from, so an edit can be matched back to the rating it belongs to.
 * A rating whose notes say "From <the food above>" is rendered indented, which
 * is what makes the round trip stable. A block's date goes on its own line at
 * the bottom, unless it's today's — the date you'd get anyway.
 */
export function generateTextLines(ratings, categories = [], { now = new Date() } = {}) {
  const index = buildCategoryIndex(categories);
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const out = [];
  const blocks = [];
  const written = []; // rendered rating lines in order, with the date each needs
  let block = null;
  let parentFood = '';

  for (const rating of ratings) {
    const key = `${rating.restaurantName || ''}\0${rating.location || ''}`;
    if (!block || key !== block.key) {
      block = {
        key,
        restaurantName: rating.restaurantName || '',
        location: rating.location || '',
        lines: [],
      };
      blocks.push(block);
      parentFood = '';
    }

    let notes = rating.additionalInfo || '';
    let indent = '';
    if (parentFood && notes.startsWith(`From ${parentFood}`)) {
      indent = '  ';
      notes = notes.slice(`From ${parentFood}`.length).trim();
    }

    const categoryName = rating.ratingCategory ? categoryPhrase(rating.ratingCategory, index) : '';
    const score = rating.score != null ? String(rating.score) : '';

    // A rating with nothing in it at all — the blank one a new entry starts
    // with — has no line to write. One that's been started but not scored gets
    // the placeholder, so it still reads as a rating rather than as a location.
    const parts = [rating.specifier || '', score, categoryName, notes];
    if (parts.every((part) => part === '')) continue;

    const text = indent + [
      rating.specifier || '',
      score === '' ? NO_SCORE : score,
      categoryName,
      notes,
    ].filter((part) => part !== '').join(' ');

    const line = { text, id: rating.id };
    block.lines.push(line);
    written.push({ line, block, date: rating.dateRated || '' });
    if (!indent) parentFood = rating.specifier || '';
  }

  // Ratings that share a date need only one date line, after the last of them —
  // which is what reading them back expects, and how the list gets written by
  // hand: one date under a run of restaurants eaten at the same day. The very
  // last run says nothing when it's today, the date a new rating gets anyway.
  written.forEach(({ line, block: owner, date }, i) => {
    const isLast = i === written.length - 1;
    if (!date || date === (isLast ? null : written[i + 1].date)) return;
    if (isLast && date === today) return;
    owner.lines.splice(owner.lines.indexOf(line) + 1, 0, { text: formatDateLine(date, now), id: null });
  });

  for (const { restaurantName, location, lines } of blocks) {
    // A block with nothing in it writes nothing — that's the blank rating a new
    // entry starts with, which shouldn't put a line in the box.
    if (lines.length === 0 && !restaurantName && !location) continue;
    if (out.length > 0) out.push({ text: '', id: null });
    // A block with no restaurant still needs a header line to stand on: an
    // empty one would read as the blank line that ends a block.
    out.push({ text: restaurantName || NO_SCORE, id: null });
    if (location) out.push({ text: location, id: null });
    out.push(...lines);
  }

  return out;
}

export function generateText(ratings, categories = [], options) {
  return generateTextLines(ratings, categories, options).map((line) => line.text).join('\n');
}

/** Longest-common-subsequence anchors: current line index → baseline index. */
function lcsAnchors(baseline, current) {
  const n = baseline.length;
  const m = current.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = baseline[i] === current[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const matched = new Array(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (baseline[i] === current[j]) {
      matched[j] = i;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matched;
}

/**
 * Match edited lines back to the lines they started as. Untouched lines anchor
 * via LCS; lines changed in place fill the gaps between anchors positionally,
 * so editing a score keeps pointing at the same rating instead of looking like
 * a brand new one. Genuinely new lines come back as -1.
 */
export function alignLines(baseline, current) {
  const matched = lcsAnchors(baseline, current);

  const anchors = [];
  for (let j = 0; j < current.length; j++) if (matched[j] >= 0) anchors.push(j);
  anchors.push(current.length);

  let baseStart = 0;
  let currentStart = 0;
  for (const anchor of anchors) {
    const baseEnd = anchor < current.length ? matched[anchor] : baseline.length;
    for (let k = 0; currentStart + k < anchor; k++) {
      const baseIndex = baseStart + k;
      if (baseIndex < baseEnd) matched[currentStart + k] = baseIndex;
    }
    if (anchor < current.length) {
      baseStart = matched[anchor] + 1;
      currentStart = anchor + 1;
    }
  }
  return matched;
}
