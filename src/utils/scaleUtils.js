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
