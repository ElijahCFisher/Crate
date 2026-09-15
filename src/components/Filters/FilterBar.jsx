import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Snackbar from '@mui/material/Snackbar';
import ClearIcon from '@mui/icons-material/Clear';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import FilterBuilder, { makeDefaultFilter } from './FilterBuilder';
import { FIELDS, parseFilterText, serializeFilters } from '../../utils/filterLogic';

export default function FilterBar({
  filters,
  filterLogic,
  logicState,
  onFiltersChange,
  onFilterLogicChange,
  groupStatsByFilterId,
  entries,
  categories,
  filterOptions,
  fields = FIELDS,
}) {
  const hasActiveFilter = filters.some((f) => f.value.trim() || ['isEmpty', 'isNotEmpty'].includes(f.op));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [message, setMessage] = useState('');

  function clearAll() {
    onFiltersChange([makeDefaultFilter()]);
  }

  async function copyFilter() {
    try {
      await navigator.clipboard.writeText(serializeFilters(filters, filterLogic, fields));
      setMessage('Filter copied');
    } catch {
      setMessage("Couldn't reach the clipboard");
    }
  }

  async function openPaste() {
    setPasteError('');
    setPasteText('');
    setPasteOpen(true);
    // Fill in whatever's on the clipboard when the browser allows it; the box
    // is still there to paste into by hand when it doesn't.
    try {
      const clip = await navigator.clipboard.readText();
      if (clip && !parseFilterText(clip, fields).error) setPasteText(clip);
    } catch {}
  }

  function applyPaste() {
    const result = parseFilterText(pasteText, fields);
    if (result.error) {
      setPasteError(result.error);
      return;
    }
    onFiltersChange(result.filters);
    onFilterLogicChange?.(result.logic);
    setPasteOpen(false);
  }

  return (
    <Box sx={{ mb: 2 }}>
      <FilterBuilder
        filters={filters}
        filterLogic={filterLogic}
        logicState={logicState}
        onChange={onFiltersChange}
        onFilterLogicChange={onFilterLogicChange}
        groupStatsByFilterId={groupStatsByFilterId}
        entries={entries}
        categories={categories}
        filterOptions={filterOptions}
        fields={fields}
      />
      <Box sx={{ mt: 0.75, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {hasActiveFilter && (
          <>
            <Button size="small" startIcon={<ClearIcon />} onClick={clearAll} color="inherit">
              Clear filters
            </Button>
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyFilter} color="inherit">
              Copy filter
            </Button>
          </>
        )}
        <Button size="small" startIcon={<ContentPasteIcon />} onClick={openPaste} color="inherit">
          Paste filter
        </Button>
      </Box>

      <Dialog open={pasteOpen} onClose={() => setPasteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Paste filter</DialogTitle>
        <DialogContent>
          <TextField
            value={pasteText}
            onChange={(e) => { setPasteText(e.target.value); setPasteError(''); }}
            multiline
            minRows={3}
            fullWidth
            autoFocus
            placeholder={'Restaurant/Brand contains "Pizza Hut" AND Rating ≥ "8"'}
            error={!!pasteError}
            helperText={pasteError || 'Text from Copy filter, or typed the same way. This replaces the current filters.'}
            sx={{ mt: 1 }}
            InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasteOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={applyPaste} disabled={!pasteText.trim()}>Apply</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!message}
        autoHideDuration={2500}
        onClose={() => setMessage('')}
        message={message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
