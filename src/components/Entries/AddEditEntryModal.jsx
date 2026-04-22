import React, { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import AddIcon from '@mui/icons-material/Add';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ReplayIcon from '@mui/icons-material/Replay';
import { CategorySelect } from '../Categories/CategorySelector';
import CreateCategoryDialog from '../Categories/CreateCategoryDialog';
import { msToDateInput, dateInputToMs } from '../../utils/dateUtils';
import { evalAdditionalInfo, hasExpressions } from '../../utils/mathUtils';
import {
  LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_RATING, LABEL_CATEGORY,
  LABEL_LOCATION, LABEL_DATE, LABEL_ADDITIONAL_INFO, LABEL_PICTURE,
} from '../../constants/fieldLabels';

/** Read-only UUID field with a one-click copy-to-clipboard button. */
function CopyableUuidField({ uuid }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(uuid).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <TextField
      label="UUID"
      value={uuid}
      InputProps={{
        readOnly: true,
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={copied ? 'Copied!' : 'Copy UUID'}>
              <IconButton size="small" onClick={copy} edge="end">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      }}
      fullWidth
      size="small"
      sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.72rem', color: 'text.secondary' } }}
    />
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const SHARED_DEFAULTS = {
  restaurantName: '',
  specifier: '',
  location: '',
  dateRated: '',
  additionalInfo: '',
  picture: '',
};

function entryToForm(entry) {
  if (!entry) return {
    ...SHARED_DEFAULTS,
    dateRated: msToDateInput(Date.now()),   // display value for date picker
    dateRatedMs: Date.now(),                // actual timestamp — preserved if user doesn't change date
    primaryRating: { ratingCategory: '', score: '' },
    additionalRatings: [],
  };
  return {
    restaurantName: entry.restaurantName || '',
    specifier: entry.specifier || '',
    location: entry.location || '',
    dateRated: msToDateInput(entry.dateRated),
    additionalInfo: entry.additionalInfo || '',
    picture: entry.picture || '',
    primaryRating: {
      ratingCategory: entry.ratingCategory || '',
      score: entry.score != null ? String(entry.score) : '',
    },
    additionalRatings: [],  // edits only touch this one entry
  };
}

/**
 * Compute diff between original entry values and the current form submission.
 * Only returns fields that actually changed.
 */
function computeDiff(original, formShared, primaryRating) {
  const updates = {};

  // String fields
  for (const field of ['restaurantName', 'specifier', 'location', 'additionalInfo', 'picture']) {
    const fv = formShared[field] || '';
    const ov = original[field] || '';
    if (fv !== ov) updates[field] = fv;
  }

  // ratingCategory (UUID string)
  const frc = primaryRating.ratingCategory || '';
  const orc = original.ratingCategory || '';
  if (frc !== orc) updates.ratingCategory = frc;

  // score (string or null; original.score may be a legacy number in memory)
  const fScore = primaryRating.score !== '' ? primaryRating.score : null;
  const origScore = original.score != null ? String(original.score) : null;
  if (fScore !== origScore) updates.score = fScore;

  // dateRated (compare as date strings to avoid sub-day timestamp drift)
  const fDateStr = formShared.dateRated;
  const oDateStr = msToDateInput(original.dateRated);
  if (fDateStr !== oDateStr) updates.dateRated = dateInputToMs(fDateStr);

  return updates;
}

// ── Additional-rating field helpers ──────────────────────────────────────────

/**
 * Normalise the primary rating into a flat source object (same shape as
 * additional-rating entries) so helpers below can accept either.
 */
function getPrimarySource(form) {
  return {
    ratingCategory: form.primaryRating.ratingCategory,
    score: form.primaryRating.score,
    restaurantName: form.restaurantName,
    specifier: form.specifier,
    location: form.location,
    dateRated: form.dateRated,
    dateRatedMs: form.dateRatedMs ?? null,
    additionalInfo: form.additionalInfo,
    picture: form.picture,
  };
}

/**
 * Build a fresh independent additional entry pre-filled from source.
 * Copies ALL fields. NOT linked as an identical on submit (unique groupId).
 */
function makeAdditionalRating(source) {
  const id = Date.now() + Math.random();
  return {
    id,
    groupId: String(id),   // unique — won't be linked with anyone else on submit
    isIdentical: false,
    ratingCategory: source.ratingCategory ?? '',
    score: source.score ?? '',
    restaurantName: source.restaurantName ?? '',
    specifier: source.specifier ?? '',
    location: source.location ?? '',
    dateRated: source.dateRated ?? '',
    dateRatedMs: source.dateRatedMs ?? null,
    additionalInfo: source.additionalInfo ?? '',
    picture: source.picture ?? '',
  };
}

/**
 * Build a re-rating entry that copies ALL fields from source.
 * Shares groupId with the source → both are submitted as identicals.
 */
function makeIdenticalRating(source, groupId) {
  return {
    id: Date.now() + Math.random(),
    groupId,               // shared with source's group — linked on submit
    isIdentical: true,
    ratingCategory: source.ratingCategory ?? '',
    score: source.score ?? '',
    restaurantName: source.restaurantName ?? '',
    specifier: source.specifier ?? '',
    location: source.location ?? '',
    dateRated: source.dateRated ?? '',
    dateRatedMs: source.dateRatedMs ?? null,
    additionalInfo: source.additionalInfo ?? '',
    picture: source.picture ?? '',
  };
}

// ── Bulk-add reconstruction helpers ───────────────────────────────────────────

/**
 * Group entries into connected components based on identicals linkage.
 * Each component is an array of entries that are re-ratings of each other.
 */
function buildIdenticalGroups(entries) {
  const byUuid = new Map(entries.map((e) => [e.uuid, e]));
  const visited = new Set();
  const groups = [];
  for (const entry of entries) {
    if (visited.has(entry.uuid)) continue;
    const group = [];
    const queue = [entry];
    while (queue.length > 0) {
      const curr = queue.shift();
      if (visited.has(curr.uuid)) continue;
      visited.add(curr.uuid);
      group.push(curr);
      for (const uid of (curr.identicals || [])) {
        const neighbor = byUuid.get(uid);
        if (neighbor && !visited.has(uid)) queue.push(neighbor);
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Reconstruct form state from an array of existing entry objects (bulk-add resume).
 */
function entriesToForm(entries) {
  if (!entries || entries.length === 0) return entryToForm(null);
  const groups = buildIdenticalGroups(entries);
  const primaryEntry = groups[0][0];

  const shared = {
    restaurantName: primaryEntry.restaurantName || '',
    specifier: primaryEntry.specifier || '',
    location: primaryEntry.location || '',
    dateRated: msToDateInput(primaryEntry.dateRated),
    dateRatedMs: primaryEntry.dateRated ?? Date.now(),
    additionalInfo: primaryEntry.additionalInfo || '',
    picture: primaryEntry.picture || '',
  };

  const primaryRating = {
    ratingCategory: primaryEntry.ratingCategory || '',
    score: primaryEntry.score != null ? String(primaryEntry.score) : '',
  };

  function entryToAdditional(e, groupId, isIdentical) {
    return {
      id: Date.now() + Math.random(),
      groupId,
      isIdentical,
      originalUuid: e.uuid,
      ratingCategory: e.ratingCategory || '',
      score: e.score != null ? String(e.score) : '',
      restaurantName: e.restaurantName || '',
      specifier: e.specifier || '',
      location: e.location || '',
      dateRated: msToDateInput(e.dateRated),
      dateRatedMs: e.dateRated ?? Date.now(),
      additionalInfo: e.additionalInfo || '',
      picture: e.picture || '',
    };
  }

  const additionalRatings = [];

  // Primary group re-ratings
  for (const e of groups[0].slice(1)) {
    additionalRatings.push(entryToAdditional(e, 'primary', true));
  }

  // Other groups (from + button)
  for (const group of groups.slice(1)) {
    const groupId = String(Date.now() + Math.random());
    for (let i = 0; i < group.length; i++) {
      additionalRatings.push(entryToAdditional(group[i], groupId, i > 0));
    }
  }

  return { ...shared, primaryRating, primaryOriginalUuid: primaryEntry.uuid, additionalRatings };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AddEditEntryModal({
  open,
  entry,           // null for add, entry object for edit
  initialEntries,  // array of existing entries to pre-fill (bulk-add resume)
  categories,
  onSave,          // (payload) — payload is updates object (edit) or array of entry data (add)
  onSaveGroups,    // (groups: Array<Array<entryData>>) — all groups at once (add mode)
  onBulkSave,      // (changes: Array<{uuid, updates}>) — edit existing entries from a bulk add
  onAddCategory,   // (categoryData) => entry
  onClose,
  loading,
  saveError,
  showAdvancedByDefault = false,
}) {
  const isEdit = !!entry;
  const isBulkEdit = !!onBulkSave;

  const [form, setForm] = useState(entryToForm(null));
  const [showAdvanced, setShowAdvanced] = useState(showAdvancedByDefault);
  const [pendingCategoryName, setPendingCategoryName] = useState(null);
  const [categoryDialogTarget, setCategoryDialogTarget] = useState(null);

  useEffect(() => {
    if (open) {
      setShowAdvanced(showAdvancedByDefault);
      if (!entry && initialEntries && initialEntries.length > 0) {
        setForm(entriesToForm(initialEntries));
      } else {
        setForm(entryToForm(entry));
      }
    }
  }, [open, entry, initialEntries, showAdvancedByDefault]);

  function setShared(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setPrimary(field, value) {
    setForm((f) => ({ ...f, primaryRating: { ...f.primaryRating, [field]: value } }));
  }

  function setAdditional(idx, field, value) {
    setForm((f) => {
      const next = [...f.additionalRatings];
      next[idx] = { ...next[idx], [field]: value };
      return { ...f, additionalRatings: next };
    });
  }

  function addAdditionalRating() {
    setForm((f) => ({
      ...f,
      additionalRatings: [...f.additionalRatings, makeAdditionalRating(getPrimarySource(f))],
    }));
  }

  function addIdenticalRating() {
    setForm((f) => ({
      ...f,
      additionalRatings: [...f.additionalRatings, makeIdenticalRating(getPrimarySource(f), 'primary')],
    }));
  }

  /** Add an independent copy branching from an existing additional entry. */
  function addAdditionalFromEntry(idx) {
    setForm((f) => ({
      ...f,
      additionalRatings: [...f.additionalRatings, makeAdditionalRating(f.additionalRatings[idx])],
    }));
  }

  /** Add a re-rating linked to an existing additional entry. */
  function addIdenticalOfEntry(idx) {
    setForm((f) => {
      const src = f.additionalRatings[idx];
      return {
        ...f,
        additionalRatings: [...f.additionalRatings, makeIdenticalRating(src, src.groupId)],
      };
    });
  }

  function removeAdditionalRating(idx) {
    setForm((f) => {
      const next = [...f.additionalRatings];
      next.splice(idx, 1);
      return { ...f, additionalRatings: next };
    });
  }

  // ── Category selection ──────────────────────────────────────────────────────

  function requestCategory(target, newName) {
    setPendingCategoryName(newName);
    setCategoryDialogTarget(target);
  }

  function applyCategory(target, uuid) {
    if (target === 'primary') {
      setPrimary('ratingCategory', uuid);
    } else {
      const idx = parseInt(target.replace('additional-', ''), 10);
      setAdditional(idx, 'ratingCategory', uuid);
    }
  }

  function handleCategoryDialogClose(newEntry) {
    if (newEntry) applyCategory(categoryDialogTarget, newEntry.uuid);
    setPendingCategoryName(null);
    setCategoryDialogTarget(null);
  }

  function makeRatingCategoryChangeHandler(target) {
    return (uuid, newName) => {
      if (newName) {
        requestCategory(target, newName);
      } else {
        applyCategory(target, uuid || '');
      }
    };
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  function handleSubmit(e) {
    e.preventDefault();

    if (isEdit) {
      const updates = computeDiff(entry, form, form.primaryRating);
      if (Object.keys(updates).length === 0) { onClose(); return; }
      onSave(updates);
    } else if (isBulkEdit) {
      const byUuid = new Map((initialEntries || []).map((orig) => [orig.uuid, orig]));
      const changes = [];
      // Primary entry diff
      if (form.primaryOriginalUuid) {
        const orig = byUuid.get(form.primaryOriginalUuid);
        if (orig) {
          const diff = computeDiff(orig, form, form.primaryRating);
          if (Object.keys(diff).length > 0) changes.push({ uuid: form.primaryOriginalUuid, updates: diff });
        }
      }
      // Additional entries diffs
      for (const r of form.additionalRatings) {
        if (!r.originalUuid) continue;
        const orig = byUuid.get(r.originalUuid);
        if (orig) {
          const diff = computeDiff(orig, r, { ratingCategory: r.ratingCategory, score: r.score });
          if (Object.keys(diff).length > 0) changes.push({ uuid: r.originalUuid, updates: diff });
        }
      }
      if (changes.length > 0) onBulkSave(changes);
    } else {
      // Helper to convert a rating form object to a saveable entry object
      function toEntry(r, scoreField, categoryField) {
        return {
          restaurantName: r.restaurantName,
          specifier: r.specifier,
          location: r.location,
          dateRated: r.dateRatedMs ?? dateInputToMs(r.dateRated),
          additionalInfo: r.additionalInfo,
          picture: r.picture,
          ratingCategory: categoryField,
          score: scoreField !== '' ? scoreField : null,
        };
      }

      const primaryEntry = toEntry(
        form, form.primaryRating.score, form.primaryRating.ratingCategory
      );

      // Primary group: primary + all additional ratings re-linked to it (groupId === 'primary')
      const primaryGroupExtras = form.additionalRatings
        .filter((r) => r.groupId === 'primary')
        .map((r) => toEntry(r, r.score, r.ratingCategory));

      // Other groups: each unique groupId that isn't 'primary'
      const otherAdditionals = form.additionalRatings.filter((r) => r.groupId !== 'primary');
      const groupsMap = new Map();
      for (const r of otherAdditionals) {
        if (!groupsMap.has(r.groupId)) groupsMap.set(r.groupId, []);
        groupsMap.get(r.groupId).push(r);
      }
      const otherGroups = Array.from(groupsMap.values()).map((g) =>
        g.map((r) => toEntry(r, r.score, r.ratingCategory))
      );

      if (onSaveGroups) {
        onSaveGroups([[primaryEntry, ...primaryGroupExtras], ...otherGroups]);
      } else {
        onSave([primaryEntry, ...primaryGroupExtras]);
        for (const group of otherGroups) onSave(group);
      }
    }
    onClose();
  }

  // ── Field render helpers ──────────────────────────────────────────────────

  function renderSimpleSharedFields(values, onChange) {
    return (
      <>
        <Grid item xs={12} sm={6}>
          <TextField label={LABEL_RESTAURANT} value={values.restaurantName}
            onChange={(e) => onChange('restaurantName', e.target.value)}
            fullWidth size="small" />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField label={LABEL_FOOD_NAME} placeholder="e.g. Chocolate"
            value={values.specifier}
            onChange={(e) => onChange('specifier', e.target.value)}
            fullWidth size="small" />
        </Grid>
      </>
    );
  }

  function renderAdvancedSharedFields(values, onChange, onDateChange) {
    return (
      <>
        <Grid item xs={12} sm={8}>
          <TextField label={LABEL_LOCATION} placeholder="e.g. Denver"
            value={values.location}
            onChange={(e) => onChange('location', e.target.value)}
            fullWidth size="small" />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField label={LABEL_DATE} type="date"
            value={values.dateRated}
            onChange={(e) => onDateChange(e.target.value)}
            fullWidth size="small" InputLabelProps={{ shrink: true }} />
        </Grid>
        <Grid item xs={12}>
          <TextField label={LABEL_ADDITIONAL_INFO}
            value={values.additionalInfo}
            onChange={(e) => onChange('additionalInfo', e.target.value)}
            fullWidth multiline rows={2} size="small" />
          {hasExpressions(values.additionalInfo) && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              Preview: {evalAdditionalInfo(values.additionalInfo)}
            </Typography>
          )}
        </Grid>
        <Grid item xs={12}>
          <TextField label={LABEL_PICTURE}
            value={values.picture}
            onChange={(e) => onChange('picture', e.target.value)}
            fullWidth size="small" />
        </Grid>
      </>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit}>
          <DialogTitle>{isEdit ? 'Edit Entry' : isBulkEdit ? 'Edit Bulk Add' : 'Add Entry'}</DialogTitle>
          <DialogContent dividers>
            {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}

            <Grid container spacing={2}>
              {/* ── UUID (read-only, edit mode only) ─────────────────────── */}
              {isEdit && entry?.uuid && (
                <Grid item xs={12}>
                  <CopyableUuidField uuid={entry.uuid} />
                </Grid>
              )}

              {/* ── Primary Rating ──────────────────────────────────────── */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                  {isEdit ? 'Rating' : form.additionalRatings.length > 0 ? 'Rating 1' : 'Rating'}
                </Typography>
              </Grid>

              {/* Simple shared fields: Restaurant/Brand + Food Name */}
              {/* In add mode: shown here (before score). In edit mode: shown after divider below. */}
              {!isEdit && renderSimpleSharedFields(form, setShared)}

              {/* Category: always in edit, advanced-only in add */}
              {(isEdit || showAdvanced) && (
                <Grid item xs={12} sm={7}>
                  <CategorySelect
                    categories={categories}
                    value={form.primaryRating.ratingCategory}
                    onChange={makeRatingCategoryChangeHandler('primary')}
                    label={LABEL_CATEGORY}
                  />
                </Grid>
              )}

              {/* Rating (score) — always visible */}
              <Grid item xs={9} sm={(isEdit || showAdvanced) ? 3 : 4}>
                <TextField
                  label={LABEL_RATING}
                  value={form.primaryRating.score}
                  onChange={(e) => setPrimary('score', e.target.value)}
                  fullWidth size="small"
                />
              </Grid>

              {/* Add / re-rate buttons */}
              {!isEdit && !isBulkEdit && (
                <Grid item xs={3} sm={2} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Tooltip title="Add another item from this visit (separate entry)">
                    <IconButton size="small" onClick={addAdditionalRating} color="primary">
                      <AddIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Add a re-rating of this entry (linked as identical — same item, different visit)">
                    <IconButton size="small" onClick={addIdenticalRating} sx={{ color: 'text.secondary' }}>
                      <ReplayIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Grid>
              )}

              {/* Show / Hide Advanced toggle (add/bulk-edit mode only) */}
              {!isEdit && (
                <Grid item xs={12}>
                  <Button
                    size="small"
                    variant="text"
                    sx={{ textTransform: 'none', color: 'text.secondary', p: 0, minWidth: 0 }}
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
                  </Button>
                </Grid>
              )}

              {/* Advanced fields: divider + (restaurant/food name in edit) + location/date/notes/picture */}
              {(isEdit || showAdvanced) && (
                <>
                  <Grid item xs={12}><Divider /></Grid>
                  {/* In edit mode, simple fields appear here (current position) */}
                  {isEdit && renderSimpleSharedFields(form, setShared)}
                  {renderAdvancedSharedFields(
                    form,
                    setShared,
                    (v) => setForm((f) => ({ ...f, dateRated: v, dateRatedMs: dateInputToMs(v) }))
                  )}
                </>
              )}

              {/* ── Additional ratings ───────────────────────────────────── */}
              {!isEdit && (() => {
                // Map entry id → actual index in additionalRatings (for all handlers)
                const idxById = new Map(form.additionalRatings.map((r, i) => [r.id, i]));

                // Collect non-primary groupIds in order of first appearance
                const seen = new Set(['primary']);
                const nonPrimaryGroupOrder = [];
                for (const r of form.additionalRatings) {
                  if (!seen.has(r.groupId)) { seen.add(r.groupId); nonPrimaryGroupOrder.push(r.groupId); }
                }

                // Sequential label numbers for group leaders (Rating 2, 3, …)
                const leaderNumber = new Map(nonPrimaryGroupOrder.map((gid, i) => [gid, i + 2]));

                /**
                 * Render one additional rating block.
                 * indented=true → left-border accent + margin to show it belongs to the entry above.
                 */
                function renderAdditionalBlock(r, indented) {
                  const idx = idxById.get(r.id);
                  const label = r.isIdentical ? 'Re-rating' : `Rating ${leaderNumber.get(r.groupId)}`;

                  const inner = (
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {r.isIdentical && (
                              <Tooltip title="Re-rating: linked as identical — same item, different visit">
                                <ReplayIcon sx={{ fontSize: '0.9rem', color: 'primary.main' }} />
                              </Tooltip>
                            )}
                            <Typography variant="subtitle2" color="text.secondary">{label}</Typography>
                          </Box>
                          <IconButton size="small" onClick={() => removeAdditionalRating(idx)} color="error">
                            <RemoveCircleOutlineIcon fontSize="small" />
                          </IconButton>
                        </Box>
                        <Divider sx={{ mt: 0.5 }} />
                      </Grid>

                      {/* Simple shared fields */}
                      {renderSimpleSharedFields(r, (field, value) => setAdditional(idx, field, value))}

                      {/* Category: advanced-only */}
                      {showAdvanced && (
                        <Grid item xs={12} sm={7}>
                          <CategorySelect
                            categories={categories}
                            value={r.ratingCategory}
                            onChange={makeRatingCategoryChangeHandler(`additional-${idx}`)}
                            label={LABEL_CATEGORY}
                          />
                        </Grid>
                      )}

                      {/* Rating (score) — always visible */}
                      <Grid item xs={9} sm={showAdvanced ? 3 : 4}>
                        <TextField
                          label={LABEL_RATING}
                          value={r.score}
                          onChange={(e) => setAdditional(idx, 'score', e.target.value)}
                          fullWidth size="small"
                        />
                      </Grid>

                      {!isBulkEdit && (
                        <Grid item xs={3} sm={2} sx={{ display: 'flex', alignItems: 'center' }}>
                          <Tooltip title="Add another item from this visit (separate entry)">
                            <IconButton size="small" onClick={() => addAdditionalFromEntry(idx)} color="primary">
                              <AddIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Add a re-rating of this entry (linked as identical — same item, different visit)">
                            <IconButton size="small" onClick={() => addIdenticalOfEntry(idx)} sx={{ color: 'text.secondary' }}>
                              <ReplayIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Grid>
                      )}

                      {/* Advanced shared fields */}
                      {showAdvanced && renderAdvancedSharedFields(
                        r,
                        (field, value) => setAdditional(idx, field, value),
                        (v) => setForm((f) => {
                          const next = [...f.additionalRatings];
                          next[idx] = { ...next[idx], dateRated: v, dateRatedMs: dateInputToMs(v) };
                          return { ...f, additionalRatings: next };
                        })
                      )}
                    </Grid>
                  );

                  return (
                    <Grid item xs={12} key={r.id}>
                      {indented ? (
                        <Box sx={{ ml: 3, pl: 1.5, borderLeft: '3px solid', borderColor: 'primary.main', mt: 1 }}>
                          {inner}
                        </Box>
                      ) : inner}
                    </Grid>
                  );
                }

                // Re-ratings of primary — rendered indented directly under the primary block
                const primaryReratings = form.additionalRatings.filter((r) => r.groupId === 'primary');
                // Other groups: [leader, ...re-ratings], grouped by first-seen groupId order
                const otherGroups = nonPrimaryGroupOrder.map((gid) =>
                  form.additionalRatings.filter((r) => r.groupId === gid)
                );

                return (
                  <>
                    {primaryReratings.map((r) => renderAdditionalBlock(r, true))}
                    {otherGroups.map((members) => (
                      <React.Fragment key={members[0].groupId}>
                        {renderAdditionalBlock(members[0], false)}
                        {members.slice(1).map((r) => renderAdditionalBlock(r, true))}
                      </React.Fragment>
                    ))}
                  </>
                );
              })()}
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={loading}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}>
              {loading ? 'Saving…' : 'Save'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Category creation dialog — shown when user types a new category name */}
      <CreateCategoryDialog
        open={!!pendingCategoryName}
        initialName={pendingCategoryName || ''}
        categories={categories}
        onSave={onAddCategory}
        onAddCategory={onAddCategory}
        onClose={handleCategoryDialogClose}
      />
    </>
  );
}
