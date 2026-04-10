import React, { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Grid from '@mui/material/Grid';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { CategorySelect } from './CategorySelector';
import { msToDateInput, dateInputToMs } from '../../utils/dateUtils';

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

const EMPTY = { name: '', ratingCategory: '', score: '', dateRated: '', additionalInfo: '' };

export default function CreateCategoryDialog({
  open,
  editEntry = null,      // if set, dialog is in "Edit Category" mode
  initialName = '',
  categories,
  onSave,        // (categoryData) => entry  — called for both add and edit
  onAddCategory, // (categoryData) => entry  (for creating a parent on the fly)
  onClose,
}) {
  const isEditMode = !!editEntry;
  const [form, setForm] = useState({ ...EMPTY, name: initialName });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (isEditMode) {
      setForm({
        name: editEntry.restaurantName || '',
        ratingCategory: editEntry.ratingCategory || '',
        score: editEntry.score != null ? String(editEntry.score) : '',
        dateRated: msToDateInput(editEntry.dateRated),
        dateRatedMs: editEntry.dateRated ?? null,
        additionalInfo: editEntry.additionalInfo || '',
      });
    } else {
      setForm({ ...EMPTY, name: initialName, dateRated: msToDateInput(Date.now()), dateRatedMs: Date.now() });
    }
  }, [open, initialName, editEntry, isEditMode]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleParentChange(uuid, newName) {
    if (newName) {
      const parent = await onAddCategory({ name: newName });
      if (parent) set('ratingCategory', parent.uuid);
    } else {
      set('ratingCategory', uuid || '');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      const entry = await onSave({
        name: form.name.trim(),
        ratingCategory: form.ratingCategory,
        score: form.score !== '' ? parseFloat(form.score) : null,
        // Use actual timestamp if user didn't change the date; midnight if they did.
        dateRated: form.dateRatedMs ?? dateInputToMs(form.dateRated),
        additionalInfo: form.additionalInfo,
      });
      onClose(entry);
    } catch (err) {
      setError(err.message || 'Failed to save category.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => onClose(null)} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEditMode ? 'Edit Category' : 'New Category'}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            {/* UUID — read-only, shown in edit mode only */}
            {isEditMode && editEntry?.uuid && (
              <Grid item xs={12}>
                <CopyableUuidField uuid={editEntry.uuid} />
              </Grid>
            )}
            <Grid item xs={12}>
              <TextField
                label="Category Name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                fullWidth size="small" required autoFocus
              />
            </Grid>
            <Grid item xs={12}>
              <CategorySelect
                categories={categories}
                value={form.ratingCategory}
                onChange={handleParentChange}
                label="Parent Category (optional)"
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="Score"
                type="number"
                inputProps={{ step: 0.1, min: 0, max: 10 }}
                value={form.score}
                onChange={(e) => set('score', e.target.value)}
                fullWidth size="small"
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="Date Rated"
                type="date"
                value={form.dateRated}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, dateRated: v, dateRatedMs: dateInputToMs(v) }));
                }}
                fullWidth size="small"
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notes"
                value={form.additionalInfo}
                onChange={(e) => set('additionalInfo', e.target.value)}
                fullWidth size="small" multiline rows={2}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => onClose(null)} disabled={saving}>Cancel</Button>
          <Button
            type="submit" variant="contained" disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Create Category'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
