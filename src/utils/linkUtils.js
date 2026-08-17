/**
 * Field links: an entry can hold other entries' values in sync for a given
 * field, so an uncertain restaurant name typed once can be corrected once and
 * land everywhere. Persisted on the *leader* as `linkedFields`
 * ({ field: [followerUuid, …] }, see csvService), which is what makes the
 * behaviour survive a reload and future batch edits.
 */

/** Every input can be linked — the key is just the field's name. */
export const LINKABLE_FIELDS = [
  'restaurantName', 'specifier', 'location', 'dateRated',
  'additionalInfo', 'picture', 'score', 'ratingCategory',
];

/**
 * Build a key → UUID resolver for a saved link plan. Keys are either
 * `uuid:<uuid>` for entries that already existed, or `new:<group>:<index>`
 * pointing into the groups this save just created (their UUIDs are assigned
 * during the write, so the modal can only refer to them positionally).
 */
export function makeLinkKeyResolver(createdByGroup = []) {
  return (key) => {
    if (typeof key !== 'string') return null;
    if (key.startsWith('uuid:')) return key.slice(5) || null;
    const match = /^new:(\d+):(\d+)$/.exec(key);
    if (!match) return null;
    return createdByGroup[Number(match[1])]?.[Number(match[2])]?.uuid || null;
  };
}

function sameLinkMap(a = {}, b = {}) {
  const keysOf = (map) => Object.keys(map).filter((k) => (map[k] || []).length > 0).sort();
  const aKeys = keysOf(a);
  const bKeys = keysOf(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, i) => {
    if (bKeys[i] !== key) return false;
    const aList = [...a[key]].sort();
    const bList = [...b[key]].sort();
    return aList.length === bList.length && aList.every((uuid, j) => uuid === bList[j]);
  });
}

/**
 * Turn a modal link plan into the `linkedFields` writes it implies.
 *
 * `plan` is { links: [{ parent, child, field }], keys: [key, …] } — `keys`
 * being every rating the form had on screen. Only those are re-decided here;
 * a follower that wasn't on screen keeps its stored link, so editing one batch
 * can't quietly drop links belonging to another.
 *
 * Returns [{ uuid, linkedFields }] for the entries whose map actually changed.
 */
export function resolveLinkPlan(plan, resolveKey, combined) {
  if (!plan || !Array.isArray(plan.links) || !Array.isArray(plan.keys)) return [];

  const scope = new Set(plan.keys.map(resolveKey).filter(Boolean));
  if (scope.size === 0) return [];

  const asserted = [];
  for (const { parent, child, field } of plan.links) {
    if (!LINKABLE_FIELDS.includes(field)) continue;
    const parentUuid = resolveKey(parent);
    const childUuid = resolveKey(child);
    if (!parentUuid || !childUuid || parentUuid === childUuid) continue;
    asserted.push({ parentUuid, childUuid, field });
  }

  const updates = [];
  for (const uuid of scope) {
    const stored = combined.get(uuid)?.linkedFields || {};
    const next = {};

    for (const [field, followers] of Object.entries(stored)) {
      const offScreen = (followers || []).filter((f) => !scope.has(f));
      if (offScreen.length > 0) next[field] = offScreen;
    }
    for (const { parentUuid, childUuid, field } of asserted) {
      if (parentUuid !== uuid) continue;
      if (!next[field]) next[field] = [];
      if (!next[field].includes(childUuid)) next[field].push(childUuid);
    }

    if (!sameLinkMap(stored, next)) updates.push({ uuid, linkedFields: next });
  }
  return updates;
}

/**
 * Every entry downstream of `leaderUuid` for `field`, following the chain — a
 * follower that leads its own followers passes the value along.
 */
export function collectLinkedFollowers(combined, leaderUuid, field) {
  const followers = [];
  const seen = new Set([leaderUuid]);
  const queue = [leaderUuid];
  while (queue.length > 0) {
    const uuid = queue.shift();
    for (const next of combined.get(uuid)?.linkedFields?.[field] || []) {
      if (seen.has(next) || !combined.has(next)) continue;
      seen.add(next);
      followers.push(next);
      queue.push(next);
    }
  }
  return followers;
}
