import React, { useState, useEffect, useMemo } from 'react';
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
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { CategorySelect } from './CategorySelector';
import { msToDateInput, dateInputToMs } from '../../utils/dateUtils';
import { computeRebalance } from '../../utils/scaleUtils';

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

function scoreDisplay(val) {
  if (val == null) return '—';
  const n = parseFloat(val);
  return Number.isFinite(n) ? String(n) : '—';
}

const EMPTY = { name: '', ratingCategory: '', score: '', dateRated: '', additionalInfo: '' };

export default function CreateCategoryDialog({
  open,
  editEntry = null,      // if set, dialog is in "Edit Category" mode
  initialName = '',
  categories,
  combined,              // full Map of all entries — needed for rebalance preview
  onSave,        // (categoryData) => entry  — called for both add and edit
  onAddCategory, // (categoryData) => entry  (for creating a parent on the fly)
  onRebalance,   // (updates: Map<uuid, newScore>) => void — applies rebalance
  onClose,
}) {
  const isEditMode = !!editEntry;
  const [form, setForm] = useState({ ...EMPTY, name: initialName });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Rebalance state ────────────────────────────────────────────────────────
  const [rebalanceEnabled, setRebalanceEnabled] = useState(false);
  const [rebalanceDescendants, setRebalanceDescendants] = useState(true);

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
    // Reset rebalance toggles each time the dialog opens.
    setRebalanceEnabled(false);
    setRebalanceDescendants(true);
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

  // ── Rebalance computation (pure, no side effects) ──────────────────────────
  const rebalanceResult = useMemo(() => {
    if (!isEditMode || !rebalanceEnabled || !editEntry || !combined) return null;
    return computeRebalance(editEntry.uuid, combined, rebalanceDescendants);
  }, [isEditMode, rebalanceEnabled, editEntry, combined, rebalanceDescendants]);

  // Up to 10 direct children with non-null scores — shown in the preview table.
  const previewItems = useMemo(() => {
    if (!rebalanceResult || !editEntry || !combined) return [];
    const children = Array.from(combined.values()).filter(
      (e) => e.ratingCategory === editEntry.uuid && e.score != null && Number.isFinite(parseFloat(e.score)),
    );
    return children.slice(0, 10).map((child) => {
      const before = parseFloat(child.score);
      const after = rebalanceResult.updates.has(child.uuid)
        ? rebalanceResult.updates.get(child.uuid)
        : before;
      return {
        uuid: child.uuid,
        name: child.entryType === 'category'
          ? child.restaurantName
          : [child.specifier, child.restaurantName].filter(Boolean).join(' — ') || 'Entry',
        type: child.entryType,
        before,
        after,
        changed: after !== before,
      };
    });
  }, [rebalanceResult, editEntry, combined]);

  const totalDirectChildren = useMemo(() => {
    if (!editEntry || !combined) return 0;
    return Array.from(combined.values()).filter(
      (e) => e.ratingCategory === editEntry.uuid && e.score != null && Number.isFinite(parseFloat(e.score)),
    ).length;
  }, [editEntry, combined]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      const entry = await onSave({
        name: form.name.trim(),
        ratingCategory: form.ratingCategory,
        score: form.score !== '' ? form.score : null,
        // Use actual timestamp if user didn't change the date; midnight if they did.
        dateRated: form.dateRatedMs ?? dateInputToMs(form.dateRated),
        additionalInfo: form.additionalInfo,
      });

      if (
        rebalanceEnabled &&
        rebalanceResult &&
        rebalanceResult.updates.size > 0 &&
        onRebalance
      ) {
        onRebalance(rebalanceResult.updates);
      }

      onClose(entry);
    } catch (err) {
      setError(err.message || 'Failed to save category.');
    } finally {
      setSaving(false);
    }
  }

  // Widen dialog when showing the rebalance preview table.
  const dialogMaxWidth = isEditMode && rebalanceEnabled ? 'sm' : 'xs';

  return (
    <Dialog open={open} onClose={() => onClose(null)} maxWidth={dialogMaxWidth} fullWidth>
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

            {/* ── Rebalance section (edit mode only) ────────────────────── */}
            {isEditMode && (
              <>
                <Grid item xs={12}>
                  <Divider />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={rebalanceEnabled}
                        onChange={(e) => setRebalanceEnabled(e.target.checked)}
                        size="small"
                      />
                    }
                    label={<Typography variant="body2">Rebalance this category on save</Typography>}
                  />
                </Grid>

                {rebalanceEnabled && (
                  <>
                    <Grid item xs={12} sx={{ pt: '4px !important' }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={rebalanceDescendants}
                            onChange={(e) => setRebalanceDescendants(e.target.checked)}
                            size="small"
                          />
                        }
                        label={<Typography variant="body2">Rebalance descendants first</Typography>}
                        sx={{ ml: 2 }}
                      />
                    </Grid>

                    <Grid item xs={12}>
                      {!rebalanceResult && (
                        <Typography variant="body2" color="text.secondary">Computing…</Typography>
                      )}

                      {rebalanceResult && rebalanceResult.calculatedAverage == null && (
                        <Alert severity="info" sx={{ py: 0.5 }}>
                          No rated items found in this category — nothing to rebalance.
                        </Alert>
                      )}

                      {rebalanceResult && rebalanceResult.calculatedAverage != null && (
                        <>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                            Weighted average: <strong>{rebalanceResult.calculatedAverage.toFixed(3)}</strong>
                            {rebalanceResult.updates.has(editEntry.uuid) && (
                              <> &nbsp;·&nbsp; This category's score:{' '}
                                <strong>{scoreDisplay(editEntry.score)}</strong>
                                {' → '}
                                <strong>{scoreDisplay(rebalanceResult.updates.get(editEntry.uuid))}</strong>
                              </>
                            )}
                          </Typography>

                          {previewItems.length > 0 && (
                            <>
                              <Typography variant="caption" color="text.secondary">
                                Sample ({previewItems.length < totalDirectChildren
                                  ? `${previewItems.length} of ${totalDirectChildren}`
                                  : totalDirectChildren} direct{' '}
                                {totalDirectChildren === 1 ? 'item' : 'items'})
                              </Typography>
                              <Table size="small" sx={{ mt: 0.5 }}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell sx={{ py: 0.5 }}>Name</TableCell>
                                    <TableCell align="center" sx={{ py: 0.5 }}>Before</TableCell>
                                    <TableCell align="center" sx={{ py: 0.5 }}>After</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {previewItems.map((item) => (
                                    <TableRow key={item.uuid}>
                                      <TableCell sx={{ py: 0.5 }}>
                                        <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                                          {item.name}
                                        </Typography>
                                      </TableCell>
                                      <TableCell align="center" sx={{ py: 0.5 }}>
                                        <Typography variant="body2">{scoreDisplay(item.before)}</Typography>
                                      </TableCell>
                                      <TableCell align="center" sx={{ py: 0.5 }}>
                                        <Typography
                                          variant="body2"
                                          fontWeight={item.changed ? 700 : 400}
                                          color={item.changed ? 'primary.main' : 'text.primary'}
                                        >
                                          {scoreDisplay(item.after)}
                                        </Typography>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </>
                          )}

                          {previewItems.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                              No direct children with scores to preview.
                            </Typography>
                          )}
                        </>
                      )}
                    </Grid>
                  </>
                )}
              </>
            )}
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
