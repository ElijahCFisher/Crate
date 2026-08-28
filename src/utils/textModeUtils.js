/**
 * Text mode: a whole visit typed as plain text, as an alternative to the form.
 *
 *   Zorba's
 *   Denver
 *   Gyro 8 greek really tender
 *   Combo platter 7
 *     Fries 5 too salty
 *
 *   Next Restaurant
 *   ...
 *
 * Line 1 of a block is the restaurant, line 2 the location (unless it already
 * looks like a rating, in which case the block has no location), and the rest
 * are ratings: `[indent] food name  score  [category]  [notes]`. A blank line
 * ends the block.
 *
 * An indented line is a component of the last un-indented rating above it, and
 * its notes get prefixed with "From <that food>".
 *
 * Categories are only ever *inferred*, never created: whatever follows the
 * score is matched against existing category names longest-phrase-first, and
 * anything that doesn't match is just notes.
 */

const SCORE_PATTERN = /^\d{1,2}(?:\.\d+)?$/;
const INDENT_PATTERN = /^(?:\t| {2,})/;

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
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

function ancestorNames(category, byUuid) {
  const names = [];
  const seen = new Set();
  let current = category.ratingCategory;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byUuid.get(current);
    if (!parent) break;
    names.push(normalize(parent.restaurantName));
    current = parent.ratingCategory;
  }
  return names;
}

/**
 * Resolve a phrase to an existing category uuid, or null. Never invents one.
 * An exact name wins; failing that "chicken sandwich" looks for a "chicken"
 * category somewhere under a "sandwich" one.
 */
export function resolveCategoryPhrase(phrase, index) {
  const key = normalize(phrase);
  if (!key) return null;

  const exact = index.byName.get(key);
  if (exact && exact.length > 0) return exact[0].uuid;

  const words = key.split(' ');
  for (let split = words.length - 1; split >= 1; split--) {
    const childName = words.slice(0, split).join(' ');
    const ancestorName = words.slice(split).join(' ');
    for (const candidate of index.byName.get(childName) || []) {
      if (ancestorNames(candidate, index.byUuid).includes(ancestorName)) return candidate.uuid;
    }
  }
  return null;
}

function findScoreIndex(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (SCORE_PATTERN.test(tokens[i]) && parseFloat(tokens[i]) <= 10) return i;
  }
  return -1;
}

/** Longest leading phrase that names a real category; the rest is notes. */
function splitCategoryAndNotes(tokens, index) {
  for (let count = tokens.length; count >= 1; count--) {
    const uuid = resolveCategoryPhrase(tokens.slice(0, count).join(' '), index);
    if (uuid) return { ratingCategory: uuid, notes: tokens.slice(count).join(' ') };
  }
  return { ratingCategory: '', notes: tokens.join(' ') };
}

export function parseRatingLine(line, { indented = false, index, parentFood = '' } = {}) {
  const tokens = String(line).trim().split(/\s+/).filter(Boolean);
  const scoreAt = findScoreIndex(tokens);
  if (scoreAt === -1) {
    return { error: 'No score found — every rating line needs a number from 0 to 10.' };
  }

  const specifier = tokens.slice(0, scoreAt).join(' ');
  const { ratingCategory, notes } = splitCategoryAndNotes(tokens.slice(scoreAt + 1), index);

  let additionalInfo = notes;
  if (indented && parentFood) {
    additionalInfo = notes ? `From ${parentFood} ${notes}` : `From ${parentFood}`;
  }

  return { specifier, score: tokens[scoreAt], ratingCategory, additionalInfo, indented };
}

/**
 * Parse the whole box. Returns flat ratings (each carrying the restaurant and
 * location of its block, plus the source line number for re-matching) and any
 * lines that couldn't be read.
 */
export function parseText(text, categories = []) {
  const index = buildCategoryIndex(categories);
  const ratings = [];
  const errors = [];
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
      block = { restaurantName: line, location: '', seenBody: false, ratingCount: 0 };
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
    if (!indented) parentFood = parsed.specifier;

    block.ratingCount++;
    ratings.push({
      ...parsed,
      restaurantName: block.restaurantName,
      location: block.location,
      lineNumber,
    });
  });

  return { ratings, errors, blocks };
}

/**
 * Render ratings back to text. Returns the lines with the rating id each one
 * came from, so an edit can be matched back to the rating it belongs to.
 * A rating whose notes say "From <the food above>" is rendered indented, which
 * is what makes the round trip stable.
 */
export function generateTextLines(ratings, categories = []) {
  const index = buildCategoryIndex(categories);
  const lines = [];
  let blockKey = null;
  let parentFood = '';

  for (const rating of ratings) {
    const key = `${rating.restaurantName || ''}\0${rating.location || ''}`;
    if (key !== blockKey) {
      if (blockKey !== null) lines.push({ text: '', id: null });
      lines.push({ text: rating.restaurantName || '', id: null });
      if (rating.location) lines.push({ text: rating.location, id: null });
      blockKey = key;
      parentFood = '';
    }

    let notes = rating.additionalInfo || '';
    let indent = '';
    if (parentFood && notes.startsWith(`From ${parentFood}`)) {
      indent = '  ';
      notes = notes.slice(`From ${parentFood}`.length).trim();
    }

    const categoryName = rating.ratingCategory
      ? index.byUuid.get(rating.ratingCategory)?.restaurantName || ''
      : '';

    const text = indent + [
      rating.specifier || '',
      rating.score != null ? String(rating.score) : '',
      categoryName,
      notes,
    ].filter((part) => part !== '').join(' ');

    if (text.trim() !== '') {
      lines.push({ text, id: rating.id });
      if (!indent) parentFood = rating.specifier || '';
    }
  }

  return lines;
}

export function generateText(ratings, categories = []) {
  return generateTextLines(ratings, categories).map((line) => line.text).join('\n');
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
