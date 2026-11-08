import { convertBetweenScales, roundToValidScore, getBaseCategory } from './scaleUtils';
import { LINKABLE_FIELDS, collectLinkedFollowers } from './linkUtils';

/**
 * Work out what a bulk edit writes.
 *
 * `selected` are the entries the user ticked. `values` holds only the fields
 * the user filled in (anything left blank stays as it is per entry). When the
 * category changes and `convertScores` is on, each score is restated in the
 * new category's scale from whichever category that entry is in now — the
 * same conversion Find & Replace → Convert scale uses — so a 7 keeps meaning
 * what it meant. With it off, scores are left exactly as they are.
 *
 * Fields linked to a selected entry follow it, as they do when one entry is
 * edited on its own; an entry that is itself selected keeps its own result.
 *
 * Returns { edits: [{ uuid, updates }], rows, linkedCount, crossTreeCount }.
 * `rows` describes each selected entry for the preview.
 */
export function buildBulkEdits({ selected, values, convertScores, combined, categoriesMap }) {
  const categoryUuid = values.ratingCategory || '';
  const editsByUuid = new Map();
  const rows = [];
  let crossTreeCount = 0;
  const destRoot = categoryUuid ? getBaseCategory(categoryUuid, categoriesMap) : null;

  for (const entry of selected) {
    const updates = {};
    for (const field of ['restaurantName', 'location', 'dateRated']) {
      if (values[field] == null || values[field] === '') continue;
      if (entry[field] !== values[field]) updates[field] = values[field];
    }

    const hasScore = Number.isFinite(parseFloat(entry.score));
    let newScore = null;
    if (categoryUuid && (entry.ratingCategory || '') !== categoryUuid) {
      updates.ratingCategory = categoryUuid;
      if (convertScores && hasScore) {
        const converted = convertBetweenScales(entry.score, entry.ratingCategory || '', categoryUuid, categoriesMap);
        if (Number.isFinite(converted)) {
          newScore = String(roundToValidScore(converted));
          if (newScore !== String(entry.score)) updates.score = newScore;
        }
      }
      const sourceRoot = entry.ratingCategory ? getBaseCategory(entry.ratingCategory, categoriesMap) : null;
      if (convertScores && hasScore && destRoot && sourceRoot && sourceRoot.uuid !== destRoot.uuid) crossTreeCount++;
    }

    if (Object.keys(updates).length) editsByUuid.set(entry.uuid, updates);
    rows.push({
      entry,
      hasScore,
      newScore: 'score' in updates ? updates.score : null,
      changed: Object.keys(updates).length > 0,
    });
  }

  // Linked followers that weren't selected themselves.
  const followerUpdates = new Map();
  for (const [uuid, updates] of editsByUuid) {
    for (const [field, value] of Object.entries(updates)) {
      if (!LINKABLE_FIELDS.includes(field)) continue;
      for (const followerUuid of collectLinkedFollowers(combined, uuid, field)) {
        if (editsByUuid.has(followerUuid)) continue;
        const follower = combined.get(followerUuid);
        if (!follower || follower[field] === value) continue;
        if (!followerUpdates.has(followerUuid)) followerUpdates.set(followerUuid, {});
        const fu = followerUpdates.get(followerUuid);
        if (!(field in fu)) fu[field] = value;
      }
    }
  }

  const edits = [
    ...Array.from(editsByUuid, ([uuid, updates]) => ({ uuid, updates })),
    ...Array.from(followerUpdates, ([uuid, updates]) => ({ uuid, updates })),
  ];
  return { edits, rows, linkedCount: followerUpdates.size, crossTreeCount };
}
