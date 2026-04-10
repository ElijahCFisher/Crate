import React, { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import AddIcon from '@mui/icons-material/Add';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { CategorySelect } from '../Categories/CategorySelector';
import CreateCategoryDialog from '../Categories/CreateCategoryDialog';
import { msToDateInput, dateInputToMs } from '../../utils/dateUtils';
import { evalAdditionalInfo, hasExpressions } from '../../utils/mathUtils';

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

  // score (float or null)
  const fScore = primaryRating.score !== '' ? parseFloat(primaryRating.score) : null;
  if (fScore !== original.score) updates.score = fScore;

  // dateRated (compare as date strings to avoid sub-day timestamp drift)
  const fDateStr = formShared.dateRated;
  const oDateStr = msToDateInput(original.dateRated);
  if (fDateStr !== oDateStr) updates.dateRated = dateInputToMs(fDateStr);

  return updates;
}

// ── Additional-rating field helpers ──────────────────────────────────────────

/** Build a fresh additional rating pre-filled from the primary form state. */
function makeAdditionalRating(form) {
  return {
    id: Date.now() + Math.random(),
    ratingCategory: '',
    score: '',
    restaurantName: form.restaurantName,
    specifier: form.specifier,
    location: form.location,
    dateRated: form.dateRated,
    dateRatedMs: form.dateRatedMs ?? null,
    additionalInfo: form.additionalInfo,
    picture: form.picture,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AddEditEntryModal({
  open,
  entry,           // null for add, entry object for edit
  categories,
  onSave,          // (payload) — payload is updates object (edit) or array of entry data (add)
  onAddCategory,   // (categoryData) => entry
  onClose,
  loading,
  saveError,
}) {
  const isEdit = !!entry;

  const [form, setForm] = useState(entryToForm(null));
  const [pendingCategoryName, setPendingCategoryName] = useState(null);
  const [categoryDialogTarget, setCategoryDialogTarget] = useState(null);

  useEffect(() => {
    if (open) setForm(entryToForm(entry));
  }, [open, entry]);

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
      additionalRatings: [...f.additionalRatings, makeAdditionalRating(f)],
    }));
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
    } else {
      // Primary entry uses top-level form fields
      const primaryEntry = {
        restaurantName: form.restaurantName,
        specifier: form.specifier,
        location: form.location,
        dateRated: form.dateRatedMs ?? dateInputToMs(form.dateRated),
        additionalInfo: form.additionalInfo,
        picture: form.picture,
        ratingCategory: form.primaryRating.ratingCategory,
        score: form.primaryRating.score !== '' ? parseFloat(form.primaryRating.score) : null,
      };
      // Each additional rating has its own full set of fields
      const additionalEntries = form.additionalRatings.map((r) => ({
        restaurantName: r.restaurantName,
        specifier: r.specifier,
        location: r.location,
        dateRated: r.dateRatedMs ?? dateInputToMs(r.dateRated),
        additionalInfo: r.additionalInfo,
        picture: r.picture,
        ratingCategory: r.ratingCategory,
        score: r.score !== '' ? parseFloat(r.score) : null,
      }));
      onSave([primaryEntry, ...additionalEntries]);
    }
    onClose();
  }

  // ── Shared fields render helper ───────────────────────────────────────────

  function renderSharedFields(values, onChange, onDateChange) {
    return (
      <>
        <Grid item xs={12} sm={6}>
          <TextField label="Restaurant Name" value={values.restaurantName}
            onChange={(e) => onChange('restaurantName', e.target.value)}
            fullWidth size="small" />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField label="Specifier" placeholder="e.g. Chocolate"
            value={values.specifier}
            onChange={(e) => onChange('specifier', e.target.value)}
            fullWidth size="small" />
        </Grid>
        <Grid item xs={12} sm={8}>
          <TextField label="Location" placeholder="e.g. Denver"
            value={values.location}
            onChange={(e) => onChange('location', e.target.value)}
            fullWidth size="small" />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField label="Date Rated" type="date"
            value={values.dateRated}
            onChange={(e) => onDateChange(e.target.value)}
            fullWidth size="small" InputLabelProps={{ shrink: true }} />
        </Grid>
        <Grid item xs={12}>
          <TextField label="Additional Information"
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
          <TextField label="Picture URL"
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
          <DialogTitle>{isEdit ? 'Edit Entry' : 'Add Entry'}</DialogTitle>
          <DialogContent dividers>
            {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}

            <Grid container spacing={2}>
              {/* ── Primary Rating ──────────────────────────────────────── */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                  {isEdit ? 'Rating' : form.additionalRatings.length > 0 ? 'Rating 1' : 'Rating'}
                </Typography>
              </Grid>

              <Grid item xs={12} sm={8}>
                <CategorySelect
                  categories={categories}
                  value={form.primaryRating.ratingCategory}
                  onChange={makeRatingCategoryChangeHandler('primary')}
                  label="Rating Category"
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Score"
                  type="number"
                  inputProps={{ step: 0.1, min: 0, max: 10 }}
                  value={form.primaryRating.score}
                  onChange={(e) => setPrimary('score', e.target.value)}
                  fullWidth size="small"
                />
              </Grid>
              {!isEdit && (
                <Grid item xs={1} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Tooltip title="Add another rating (different category/brand/specifier)">
                    <IconButton size="small" onClick={addAdditionalRating} color="primary">
                      <AddIcon />
                    </IconButton>
                  </Tooltip>
                </Grid>
              )}

              {/* ── Primary shared fields ────────────────────────────── */}
              <Grid item xs={12}><Divider /></Grid>
              {renderSharedFields(
                form,
                (field, value) => setShared(field, value),
                (v) => setForm((f) => ({ ...f, dateRated: v, dateRatedMs: dateInputToMs(v) }))
              )}

              {/* ── Additional ratings ───────────────────────────────── */}
              {!isEdit && form.additionalRatings.map((r, idx) => (
                <React.Fragment key={r.id}>
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Rating {idx + 2}
                      </Typography>
                      <IconButton size="small" onClick={() => removeAdditionalRating(idx)} color="error">
                        <RemoveCircleOutlineIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Divider sx={{ mt: 0.5 }} />
                  </Grid>

                  {/* Category + Score */}
                  <Grid item xs={12} sm={8}>
                    <CategorySelect
                      categories={categories}
                      value={r.ratingCategory}
                      onChange={makeRatingCategoryChangeHandler(`additional-${idx}`)}
                      label="Rating Category"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Score"
                      type="number"
                      inputProps={{ step: 0.1, min: 0, max: 10 }}
                      value={r.score}
                      onChange={(e) => setAdditional(idx, 'score', e.target.value)}
                      fullWidth size="small"
                    />
                  </Grid>

                  {/* All shared fields, editable per-additional-rating */}
                  {renderSharedFields(
                    r,
                    (field, value) => setAdditional(idx, field, value),
                    (v) => setForm((f) => {
                      const next = [...f.additionalRatings];
                      next[idx] = { ...next[idx], dateRated: v, dateRatedMs: dateInputToMs(v) };
                      return { ...f, additionalRatings: next };
                    })
                  )}
                </React.Fragment>
              ))}
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
