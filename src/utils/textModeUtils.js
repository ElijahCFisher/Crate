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
 * — sets the date for every rating in its block, wherever it sits in the block.
 * A bare `9/1` means this year.
 *
 * Categories are only ever *inferred*, never created: whatever follows the
 * score is matched against existing category names longest-phrase-first, and
 * anything that doesn't match is just notes. Two categories can share a name
 * ("breakfast > egg" and "side > egg"), so a category can also be written as a
 * path, outermost first: `breakfast > egg`, `breakfast -> egg` or
 * `breakfast/egg`.
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
 * Every existing category a phrase could mean, best first. Never invents one.
 * An exact name wins; failing that the phrase is read as a path from the
 * outside in ("breakfast > egg", "breakfast/egg"); failing that "chicken
 * sandwich" looks for a "chicken" category somewhere under a "sandwich" one.
 */
export function resolveCategoryMatches(phrase, index) {
  const key = normalize(phrase);
  if (!key) return [];

  const exact = index.byName.get(key);
  if (exact && exact.length > 0) return exact.map((c) => c.uuid);

  const segments = key.split(PATH_SEPARATOR).map(normalize);
  if (segments.length > 1 && segments.every(Boolean)) {
    const leaf = segments[segments.length - 1];
    // The path reads outermost-first; the ancestor chain reads inside-out.
    const wanted = segments.slice(0, -1).reverse();
    return (index.byName.get(leaf) || [])
      .filter((c) => hasAncestorPath(c, wanted, index.byUuid))
      .map((c) => c.uuid);
  }

  const words = key.split(' ');
  for (let split = words.length - 1; split >= 1; split--) {
    const childName = words.slice(0, split).join(' ');
    const ancestorName = words.slice(split).join(' ');
    const matches = (index.byName.get(childName) || [])
      .filter((c) => ancestorNames(c, index.byUuid).includes(ancestorName));
    if (matches.length > 0) return matches.map((c) => c.uuid);
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

/**
 * Longest leading phrase that names a real category; the rest is notes. A
 * phrase that names several categories, or a path written on purpose that
 * names none, comes back with a warning rather than silently doing something.
 */
function splitCategoryAndNotes(tokens, index) {
  for (let count = tokens.length; count >= 1; count--) {
    const phrase = tokens.slice(0, count).join(' ');
    const matches = resolveCategoryMatches(phrase, index);
    if (matches.length === 0) continue;
    const notes = tokens.slice(count).join(' ');
    if (matches.length === 1) return { ratingCategory: matches[0], notes, warning: null };
    const options = matches.map((uuid) => categoryPath(uuid, index)).join(', ');
    return {
      ratingCategory: matches[0],
      notes,
      warning: `"${phrase}" matches ${matches.length} categories (${options}) — used the first.`
        + ` Write the path, like "${categoryPath(matches[0], index)}", to pick one.`,
    };
  }

  const rest = tokens.join(' ');
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

/**
 * Parse the whole box. Returns flat ratings (each carrying the restaurant,
 * location and date of its block, plus the source line number for re-matching),
 * any lines that couldn't be read, and warnings about categories that had to
 * be guessed at.
 */
export function parseText(text, categories = [], { now = new Date() } = {}) {
  const index = buildCategoryIndex(categories);
  const ratings = [];
  const errors = [];
  const warnings = [];
  const blocks = [];

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

    if (!block) {
      block = {
        restaurantName: line === NO_SCORE ? '' : line,
        location: '',
        dateRated: '',
        seenBody: false,
        ratingCount: 0,
        ratings: [],
      };
      blocks.push(block);
      return;
    }

    // A line that is only a date belongs to the whole block, wherever in the
    // block it sits, and doesn't use up the slot the location would go in.
    const date = parseDateLine(line, now);
    if (date) {
      block.dateRated = date;
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
    ratings.push(rating);
  });

  // The date line usually sits at the bottom of its block, so it's handed out
  // once the whole block has been read.
  for (const b of blocks) {
    for (const rating of b.ratings) rating.dateRated = b.dateRated;
  }

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
  let block = null;
  let parentFood = '';

  /**
   * A block is written out once it's complete, so its date can go at the
   * bottom. A block with nothing in it writes nothing — that's the blank
   * rating a new entry starts with, which shouldn't put a line in the box.
   */
  function flush() {
    if (!block) return;
    const { restaurantName, location, date, lines } = block;
    block = null;
    if (lines.length === 0 && !restaurantName && !location) return;
    if (out.length > 0) out.push({ text: '', id: null });
    // A block with no restaurant still needs a header line to stand on: an
    // empty one would read as the blank line that ends a block.
    out.push({ text: restaurantName || NO_SCORE, id: null });
    if (location) out.push({ text: location, id: null });
    out.push(...lines);
    if (date && date !== today) out.push({ text: formatDateLine(date, now), id: null });
  }

  for (const rating of ratings) {
    const date = rating.dateRated || '';
    const key = `${rating.restaurantName || ''}\0${rating.location || ''}\0${date}`;
    if (!block || key !== block.key) {
      flush();
      block = {
        key,
        restaurantName: rating.restaurantName || '',
        location: rating.location || '',
        date,
        lines: [],
      };
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

    block.lines.push({ text, id: rating.id });
    if (!indent) parentFood = rating.specifier || '';
  }
  flush();

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
