// Valid score values: whole numbers 0-8, 8.5, then every 0.1 from 9-10.
export const VALID_SCORES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 8.5,
  9, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10,
];

/** Round a score to the nearest valid score value (ties go to the higher value). */
export function roundToValidScore(score) {
  const clamped = Math.max(0, Math.min(10, score));
  let bestVal = VALID_SCORES[0];
  let bestDist = Math.abs(clamped - VALID_SCORES[0]);
  for (const v of VALID_SCORES) {
    const dist = Math.abs(clamped - v);
    if (dist < bestDist || (dist === bestDist && v > bestVal)) {
      bestDist = dist;
      bestVal = v;
    }
  }
  return bestVal;
}

/**
 * Count all food entries with non-null scores anywhere in categoryUuid's subtree.
 * Uses the `categories` ancestor-cache on each entry for O(n) traversal.
 */
export function countRatingsInSubtree(categoryUuid, combined) {
  let count = 0;
  for (const entry of combined.values()) {
    if (
      entry.entryType === 'food' &&
      entry.score != null &&
      Number.isFinite(parseFloat(entry.score)) &&
      Array.isArray(entry.categories) &&
      entry.categories.includes(categoryUuid)
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Compute the full rebalance plan for a category without mutating anything.
 *
 * Algorithm (three phases applied to direct children):
 *   Phase 1 – if recursive, rebalance each child subcategory first and compute
 *              its new score in this category's scale via convertRating(childAvg, 5, childOriginalScore).
 *   Phase 2 – compute the weighted average across all direct children (subcategory
 *              scores × their subtree rating count, plus each direct entry's score × 1).
 *   Phase 3 – convert every direct child's score using convertRating(score, calculatedAverage, 5)
 *              so the post-rebalance average becomes 5.
 *   Phase 4 – update this category's own score via convertRating(calculatedAverage, 5, ownOriginalScore).
 *
 * Returns { calculatedAverage, updates } where `updates` is a Map<uuid, newScore>
 * covering this category, its direct children, and (if recursive) all descendants.
 * Returns null if the category doesn't exist. Returns { calculatedAverage: null, updates }
 * if there are no rated items to rebalance.
 */
export function computeRebalance(categoryUuid, combined, recursive) {
  const category = combined.get(categoryUuid);
  if (!category || category.entryType !== 'category') return null;

  const originalScore = parseFloat(category.score);

  const directChildren = Array.from(combined.values()).filter(
    (e) => e.ratingCategory === categoryUuid,
  );
  const childSubcategories = directChildren.filter((e) => e.entryType === 'category');
  const directEntries = directChildren.filter((e) => e.entryType === 'food');

  // allUpdates accumulates every uuid→score change from this node and descendants.
  const allUpdates = new Map();
  // childPhase1Scores holds a subcategory's new score (in this category's scale)
  // after its own recursive rebalance — used for Phase 2 and Phase 3.
  const childPhase1Scores = new Map();

  // ── Phase 1: recurse into child subcategories ─────────────────────────────
  if (recursive) {
    for (const sub of childSubcategories) {
      const subOriginalScore = parseFloat(sub.score);
      if (!Number.isFinite(subOriginalScore)) continue;

      const childResult = computeRebalance(sub.uuid, combined, true);
      if (!childResult || childResult.calculatedAverage == null) continue;

      // Map the child's new average back into this category's scale.
      const phase1Score = roundToValidScore(
        convertRating(childResult.calculatedAverage, 5, subOriginalScore),
      );
      childPhase1Scores.set(sub.uuid, phase1Score);

      // Carry descendant updates upward (Phase 3 of this level will overwrite
      // sub.uuid with its final score, which is correct — two-conversion design).
      for (const [uuid, score] of childResult.updates) {
        allUpdates.set(uuid, score);
      }
    }
  }

  // ── Phase 2: weighted average ─────────────────────────────────────────────
  let totalWeightedSum = 0;
  let totalCount = 0;

  for (const sub of childSubcategories) {
    const subScore = childPhase1Scores.has(sub.uuid)
      ? childPhase1Scores.get(sub.uuid)
      : parseFloat(sub.score);
    const subCount = countRatingsInSubtree(sub.uuid, combined);
    if (Number.isFinite(subScore) && subCount > 0) {
      totalWeightedSum += subScore * subCount;
      totalCount += subCount;
    }
  }

  for (const entry of directEntries) {
    const s = parseFloat(entry.score);
    if (Number.isFinite(s)) {
      totalWeightedSum += s;
      totalCount += 1;
    }
  }

  if (totalCount === 0) {
    return { calculatedAverage: null, updates: allUpdates };
  }

  const calculatedAverage = totalWeightedSum / totalCount;

  // ── Phase 3: normalise direct children so average → 5 ────────────────────
  for (const sub of childSubcategories) {
    const currentScore = childPhase1Scores.has(sub.uuid)
      ? childPhase1Scores.get(sub.uuid)
      : parseFloat(sub.score);
    if (!Number.isFinite(currentScore)) continue;
    allUpdates.set(
      sub.uuid,
      roundToValidScore(convertRating(currentScore, calculatedAverage, 5)),
    );
  }

  for (const entry of directEntries) {
    const s = parseFloat(entry.score);
    if (!Number.isFinite(s)) continue;
    allUpdates.set(
      entry.uuid,
      roundToValidScore(convertRating(s, calculatedAverage, 5)),
    );
  }

  // ── Phase 4: update own score ─────────────────────────────────────────────
  if (Number.isFinite(originalScore)) {
    allUpdates.set(
      categoryUuid,
      roundToValidScore(convertRating(calculatedAverage, 5, originalScore)),
    );
  }

  return { calculatedAverage, updates: allUpdates };
}

/**
 * Core piecewise scale conversion.
 * Below moss: linear from [0,moss] → [0,mnss]
 * Above moss: linear from [moss,10] → [mnss,10]
 */
export function convertRating(r, moss, mnss) {
  if (moss === mnss) return r;
  if (r <= moss) {
    return moss === 0 ? 0 : (r / moss) * mnss;
  }
  return ((r - moss) / (10 - moss)) * (10 - mnss) + mnss;
}

/**
 * Convert a score from a child category's scale to its parent's scale.
 * The midpoint (5) on the child maps to categoryScoreInParent on the parent.
 */
export function convertToParentScale(score, categoryScoreInParent) {
  return convertRating(score, 5, categoryScoreInParent);
}

/**
 * Convert a score from a child category's scale to a parent category's scale.
 * The midpoint (5) on the parent maps to categoryScoreInChild on the child.
 */
export function convertToChildScale(score, categoryScoreInChild) {
  return convertRating(score, categoryScoreInChild, 5);
}

/**
 * Walk up the category tree, converting `score` at each hop until we reach
 * the base category (one with no parent). Returns the converted score.
 *
 * @param {number} score - The score in `categoryUuid`'s own scale
 * @param {string} categoryUuid - The category the score belongs to
 * @param {Map<string, object>} categoriesMap - uuid → full category object
 */
export function convertToBaseScore(score, categoryUuid, categoriesMap) {
  let current = parseFloat(score);
  if (!Number.isFinite(current)) return current;

  let currentUuid = categoryUuid;
  const visited = new Set();

  while (currentUuid) {
    if (visited.has(currentUuid)) break;
    visited.add(currentUuid);

    const category = categoriesMap.get(currentUuid);
    if (!category || !category.ratingCategory) break;

    const catScore = parseFloat(category.score);
    if (!Number.isFinite(catScore)) break;

    current = convertToParentScale(current, catScore);
    currentUuid = category.ratingCategory;
  }

  return current;
}

/**
 * Returns the root (base) category entry — the one with no parent.
 */
export function getBaseCategory(categoryUuid, categoriesMap) {
  let currentUuid = categoryUuid;
  const visited = new Set();
  while (currentUuid) {
    if (visited.has(currentUuid)) break;
    visited.add(currentUuid);
    const cat = categoriesMap.get(currentUuid);
    if (!cat) return null;
    if (!cat.ratingCategory) return cat;
    currentUuid = cat.ratingCategory;
  }
  return null;
}
