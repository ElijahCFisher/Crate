import React, { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import { CategorySelect } from '../Categories/CategorySelector';
import { findSimilarItems, statusOf } from '../../utils/toTryUtils';
import {
  buildRestaurantLocations, locationsForRestaurant, orderLocationSuggestions,
} from '../../utils/restaurantLocations';
import { formatDate } from '../../utils/dateUtils';

const EMPTY = {
  restaurantName: '', specifier: '', location: '', ratingCategory: '',
  additionalInfo: '', status: 'open', tags: [],
};

function toForm(item) {
  if (!item) return { ...EMPTY };
  return {
    restaurantName: item.restaurantName || '',
    specifier: item.specifier || '',
    location: item.location || '',
    ratingCategory: item.ratingCategory || '',
    additionalInfo: item.additionalInfo || '',
    status: statusOf(item),
    tags: [...(item.tags || [])],
  };
}

function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Add or edit one to-try item. */
export default function ToTryItemDialog({
  open,
  item,             // null → a new item
  items,            // everything on the list, for the duplicate warning and tag suggestions
  categories,
  foodEntries,
  ratingsByUuid,    // Map of food entries, to list the ratings an item led to
  onSave,           // new: (data) ; edit: (updates)
  onOpenRating,     // (entry) — open a linked rating
  onClose,
}) {
  const isEdit = !!item;
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (open) setForm(toForm(item));
  }, [open, item]);

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const places = useMemo(
    () => [...new Set([...foodEntries, ...items].map((e) => e.restaurantName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [foodEntries, items]
  );
  const allLocations = useMemo(
    () => [...new Set([...foodEntries, ...items].map((e) => e.location).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [foodEntries, items]
  );
  const restaurantLocations = useMemo(() => buildRestaurantLocations([...foodEntries, ...items]), [foodEntries, items]);
  const allTags = useMemo(
    () => [...new Set(items.flatMap((i) => i.tags || []))].sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const similar = useMemo(
    () => (open ? findSimilarItems(items, form, item?.uuid) : []),
    [open, items, form, item]
  );
  const linkedRatings = (item?.triedRatings || []).map((uuid) => ratingsByUuid?.get(uuid)).filter(Boolean);

  const canSave = !!(form.restaurantName.trim() || form.specifier.trim() || form.additionalInfo.trim());

  function autofillLocation(restaurantName) {
    if (form.location.trim()) return;
    const [mostRecent] = locationsForRestaurant(restaurantLocations, restaurantName);
    if (mostRecent) set('location', mostRecent);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSave) return;
    const clean = {
      restaurantName: form.restaurantName.trim(),
      specifier: form.specifier.trim(),
      location: form.location.trim(),
      ratingCategory: form.ratingCategory || '',
      additionalInfo: form.additionalInfo.trim(),
      status: form.status === 'open' ? '' : form.status,
      tags: [...new Set(form.tags.map((t) => t.trim()).filter(Boolean))],
    };
    if (!isEdit) {
      onSave(clean);
    } else {
      const before = toForm(item);
      const updates = {};
      for (const field of ['restaurantName', 'specifier', 'location', 'ratingCategory', 'additionalInfo']) {
        if (clean[field] !== before[field]) updates[field] = clean[field];
      }
      if (clean.status !== (before.status === 'open' ? '' : before.status)) updates.status = clean.status;
      if (!sameList(clean.tags, before.tags)) updates.tags = clean.tags;
      if (Object.keys(updates).length > 0) onSave(updates);
    }
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEdit ? 'Edit To Try item' : 'Add to To Try'}</DialogTitle>
        <DialogContent dividers>
          {similar.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Already on your list:{' '}
              {similar.slice(0, 3).map((s) => [s.restaurantName, s.specifier].filter(Boolean).join(' — ')
                + (s.location ? ` (${s.location})` : '')).join('; ')}
              {similar.length > 3 ? ` and ${similar.length - 3} more` : ''}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                freeSolo
                options={places}
                inputValue={form.restaurantName}
                onInputChange={(_, v) => set('restaurantName', v)}
                onChange={(_, v, reason) => { if (reason === 'selectOption' && typeof v === 'string') autofillLocation(v); }}
                onBlur={() => autofillLocation(form.restaurantName)}
                renderInput={(params) => (
                  <TextField {...params} label="Place / brand" size="small" fullWidth autoFocus placeholder="e.g. Big Sky Burger" />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Food"
                value={form.specifier}
                onChange={(e) => set('specifier', e.target.value)}
                size="small"
                fullWidth
                placeholder="optional — a dish or item"
              />
            </Grid>
            <Grid item xs={12} sm={7}>
              <Autocomplete
                freeSolo
                options={orderLocationSuggestions(allLocations, restaurantLocations, form.restaurantName)}
                inputValue={form.location}
                onInputChange={(_, v) => set('location', v)}
                renderInput={(params) => (
                  <TextField {...params} label="Location" size="small" fullWidth placeholder="blank for chains" />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={5}>
              <CategorySelect
                categories={categories}
                value={form.ratingCategory}
                label="Genre"
                onChange={(uuid, newName) => {
                  // To-try items don't create categories; a new name is kept as a tag.
                  if (newName) setForm((f) => ({ ...f, tags: [...new Set([...f.tags, newName])] }));
                  else set('ratingCategory', uuid || '');
                }}
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                freeSolo
                options={allTags}
                value={form.tags}
                onChange={(_, value) => set('tags', value)}
                renderTags={(value, getTagProps) => value.map((tag, index) => (
                  <Chip size="small" label={tag} {...getTagProps({ index })} key={tag} />
                ))}
                renderInput={(params) => (
                  <TextField {...params} label="Tags" size="small" placeholder="DoorDash, who to go with…" />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notes"
                value={form.additionalInfo}
                onChange={(e) => set('additionalInfo', e.target.value)}
                size="small"
                fullWidth
                multiline
                minRows={2}
                placeholder="Hours, who recommended it, links…"
              />
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField
                select
                label="Status"
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
                size="small"
                fullWidth
              >
                <MenuItem value="open">To try</MenuItem>
                <MenuItem value="tried">Tried</MenuItem>
                <MenuItem value="gone">Gone — can't get it anymore</MenuItem>
              </TextField>
            </Grid>
            {isEdit && (
              <Grid item xs={12} sm={7} sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  Added {formatDate(item.dateRated)}
                </Typography>
              </Grid>
            )}
            {linkedRatings.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Ratings from trying it</Typography>
                {linkedRatings.map((r) => (
                  <div key={r.uuid}>
                    <Link component="button" type="button" variant="body2" onClick={() => onOpenRating?.(r)}>
                      {[r.restaurantName, r.specifier].filter(Boolean).join(' — ') || 'Rating'}
                      {r.score != null ? ` · ${r.score}` : ''} · {formatDate(r.dateRated)}
                    </Link>
                  </div>
                ))}
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!canSave}>{isEdit ? 'Save' : 'Add'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
