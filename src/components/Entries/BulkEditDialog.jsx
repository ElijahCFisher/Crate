import React, { useState, useEffect, useMemo } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { CategorySelect } from '../Categories/CategorySelector';
import { buildBulkEdits } from '../../utils/bulkEdit';
import { dateInputToMs } from '../../utils/dateUtils';
import { LABEL_RESTAURANT, LABEL_LOCATION, LABEL_DATE } from '../../constants/fieldLabels';

const PREVIEW_LIMIT = 50;

/**
 * Change several entries at once. Only the fields filled in are written;
 * blank ones stay as they are on each entry.
 */
export default function BulkEditDialog({ open, onClose, selected, categories, combined, onApply }) {
  const [ratingCategory, setRatingCategory] = useState('');
  const [convertScores, setConvertScores] = useState(true);
  const [restaurantName, setRestaurantName] = useState('');
  const [location, setLocation] = useState('');
  const [dateRated, setDateRated] = useState('');

  useEffect(() => {
    if (!open) return;
    setRatingCategory('');
    setConvertScores(true);
    setRestaurantName('');
    setLocation('');
    setDateRated('');
  }, [open]);

  const categoriesMap = useMemo(() => new Map(categories.map((c) => [c.uuid, c])), [categories]);

  const result = useMemo(() => {
    if (!open) return null;
    return buildBulkEdits({
      selected,
      values: {
        ratingCategory,
        restaurantName: restaurantName.trim(),
        location: location.trim(),
        dateRated: dateRated ? dateInputToMs(dateRated) : '',
      },
      convertScores,
      combined,
      categoriesMap,
    });
  }, [open, selected, ratingCategory, restaurantName, location, dateRated, convertScores, combined, categoriesMap]);

  const changedCount = result ? result.rows.filter((r) => r.changed).length : 0;
  const movingCount = result
    ? result.rows.filter((r) => ratingCategory && (r.entry.ratingCategory || '') !== ratingCategory).length
    : 0;

  function handleApply() {
    if (!result?.edits.length) return;
    onApply(result.edits);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Edit {selected.length} entr{selected.length === 1 ? 'y' : 'ies'}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Fill in only what you want to change. Anything left blank stays as it is on each entry.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <CategorySelect
              categories={categories}
              value={ratingCategory}
              onChange={(uuid) => setRatingCategory(uuid || '')}
              label="Move to category"
            />
            <FormControlLabel
              sx={{ mt: 0.5 }}
              control={
                <Switch
                  size="small"
                  checked={convertScores}
                  onChange={(e) => setConvertScores(e.target.checked)}
                  disabled={!ratingCategory}
                />
              }
              label={
                <Typography variant="body2">
                  Rebalance scores to the new category's scale
                </Typography>
              }
            />
            {ratingCategory && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {convertScores
                  ? 'Each score is converted from the category that entry is in now, so it keeps its meaning.'
                  : 'Scores stay exactly as they are.'}
              </Typography>
            )}
          </Box>

          <TextField
            size="small"
            label={LABEL_RESTAURANT}
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
          />
          <TextField
            size="small"
            label={LABEL_LOCATION}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <TextField
            size="small"
            type="date"
            label={LABEL_DATE}
            value={dateRated}
            onChange={(e) => setDateRated(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ maxWidth: 220 }}
          />
        </Box>

        {result && result.crossTreeCount > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {result.crossTreeCount} of these are under a different root category than the destination,
            so their scores were never on a shared scale. The conversion will still run, but it's only
            as meaningful as those roots are comparable.
          </Alert>
        )}

        {result && ratingCategory && convertScores && movingCount > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Scores after moving
            </Typography>
            <Box sx={{ maxHeight: 240, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
              {result.rows
                .filter((r) => (r.entry.ratingCategory || '') !== ratingCategory)
                .slice(0, PREVIEW_LIMIT)
                .map(({ entry, hasScore, newScore }, idx) => (
                  <React.Fragment key={entry.uuid}>
                    {idx > 0 && <Divider />}
                    <Box sx={{ px: 1.5, py: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[entry.restaurantName, entry.specifier].filter(Boolean).join(' · ') || entry.uuid}
                        <Typography component="span" variant="caption" color="text.secondary">
                          {' — '}{categoriesMap.get(entry.ratingCategory)?.restaurantName || '(uncategorized)'}
                        </Typography>
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', width: 36, textAlign: 'right' }}>
                        {hasScore ? entry.score : '—'}
                      </Typography>
                      <ArrowForwardIcon fontSize="small" color="action" />
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', width: 36, color: newScore != null ? 'success.main' : 'text.secondary' }}>
                        {hasScore ? (newScore ?? entry.score) : '—'}
                      </Typography>
                    </Box>
                  </React.Fragment>
                ))}
              {movingCount > PREVIEW_LIMIT && (
                <>
                  <Divider />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.75 }}>
                    Showing first {PREVIEW_LIMIT} of {movingCount}
                  </Typography>
                </>
              )}
            </Box>
          </Box>
        )}

        {result && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {changedCount === 0
              ? 'Nothing to change yet.'
              : `${changedCount} of ${selected.length} will change`
                + (result.linkedCount > 0
                  ? `, plus ${result.linkedCount} linked entr${result.linkedCount === 1 ? 'y' : 'ies'} that follow them`
                  : '')
                + '.'}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleApply} disabled={!result?.edits.length}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
