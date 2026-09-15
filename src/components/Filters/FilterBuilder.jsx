import React, { useState, useMemo, useDeferredValue } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import Collapse from '@mui/material/Collapse';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import EditIcon from '@mui/icons-material/Edit';
import {
  FIELDS, getOps, needsValue, makeDefaultFilter, buildDefaultFilterLogic,
  countFilterSuggestions, narrowFilterSuggestions,
} from '../../utils/filterLogic';

// Pure filtering logic (applyFilters, describeFilter, etc.) lives in
// filterLogic.js so it can be imported by non-React code (e.g. the MCP
// server) without pulling in JSX. Re-exported here so existing imports of
// `from './FilterBuilder'` elsewhere in the app keep working unchanged.
export * from '../../utils/filterLogic';

// ── Component ─────────────────────────────────────────────────────────────────

export default function FilterBuilder({
  filters,
  filterLogic,
  logicState,
  onChange,
  onFilterLogicChange,
  groupStatsByFilterId,
  entries,          // optional: enables value suggestions
  categories = [],
  filterOptions,
}) {
  const [draggingId, setDraggingId] = useState(null);
  const [showLogic, setShowLogic] = useState(false);

  // Suggestions are only worked out for the value box that has focus, and only
  // recounted when the *other* filters change — typing just narrows the list.
  const [focusedId, setFocusedId] = useState(null);
  const focused = filters.find((f) => f.id === focusedId);
  const othersKey = JSON.stringify(
    filters.filter((f) => f.id !== focusedId).map((f) => [f.field, f.op, f.value, f.connector, f.caseSensitive, f.useRegex])
  );
  const deferredOthersKey = useDeferredValue(othersKey);
  const counted = useMemo(
    () => (entries && focused && !focused.useRegex
      ? countFilterSuggestions(entries, filters, categories, focusedId, filterOptions)
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, categories, filterOptions, focusedId, focused?.field, focused?.useRegex, deferredOthersKey]
  );
  const typed = useDeferredValue(focused?.value ?? '');
  const suggestions = useMemo(
    () => narrowFilterSuggestions(counted, typed).map((s) => s.value),
    [counted, typed]
  );

  function addFilter() {
    onChange([...filters, makeDefaultFilter()]);
  }

  function removeFilter(id) {
    // Always keep at least one row
    const next = filters.filter((f) => f.id !== id);
    onChange(next.length ? next : [makeDefaultFilter()]);
  }

  function update(id, updates) {
    const next = filters.map((f) => (f.id === id ? { ...f, ...updates } : f));
    onChange(next, { previousFilters: filters, nextFilters: next });
  }

  function moveFilter(sourceId, targetId) {
    if (sourceId === targetId) return;
    const sourceIndex = filters.findIndex((f) => f.id === sourceId);
    const targetIndex = filters.findIndex((f) => f.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const next = [...filters];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    onChange(next, { previousFilters: filters, nextFilters: next });
  }

  const visibleLogic = filterLogic || buildDefaultFilterLogic(filters);

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      {filters.map((f, idx) => (
        <Box
          key={f.id}
          onDragEnd={() => setDraggingId(null)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const sourceId = Number(e.dataTransfer.getData('text/plain')) || draggingId;
            moveFilter(sourceId, f.id);
            setDraggingId(null);
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 1,
            flexWrap: 'wrap',
            opacity: draggingId === f.id ? 0.5 : 1,
          }}
        >
          <Tooltip title="Drag to reorder">
            <IconButton
              size="small"
              draggable
              onDragStart={(e) => {
                setDraggingId(f.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(f.id));
              }}
              sx={{ cursor: 'grab' }}
            >
              <DragIndicatorIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* AND / OR connector */}
          {idx > 0 && (
            <Tooltip title="Toggle AND / OR">
              <Chip
                label={f.connector}
                size="small"
                color={f.connector === 'OR' ? 'secondary' : 'primary'}
                variant="outlined"
                onClick={() => update(f.id, { connector: f.connector === 'AND' ? 'OR' : 'AND' })}
                sx={{ cursor: 'pointer', minWidth: 44 }}
              />
            </Tooltip>
          )}

          {/* Field selector */}
          <Select
            value={f.field}
            onChange={(e) => {
              const ops = getOps(e.target.value);
              update(f.id, { field: e.target.value, op: ops[0].value });
            }}
            size="small"
            sx={{ minWidth: 130 }}
          >
            {FIELDS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>

          {/* Operator selector */}
          <Select
            value={f.op}
            onChange={(e) => update(f.id, { op: e.target.value })}
            size="small"
            sx={{ minWidth: 110 }}
          >
            {getOps(f.field).map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>

          {/* Value input */}
          {needsValue(f) && f.field === 'dateRated' && (
            <TextField
              type="date"
              value={f.value}
              onChange={(e) => update(f.id, { value: e.target.value })}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ width: 160 }}
            />
          )}
          {needsValue(f) && f.field === 'score' && (
            <TextField
              type="number"
              value={f.value}
              onChange={(e) => update(f.id, { value: e.target.value })}
              size="small"
              placeholder="rating…"
              inputProps={{ step: 0.1, min: 0, max: 10 }}
              sx={{ width: 100 }}
            />
          )}
          {needsValue(f) && f.field !== 'score' && f.field !== 'dateRated' && (
            <Autocomplete
              freeSolo
              disableClearable
              size="small"
              options={f.id === focusedId ? suggestions : []}
              filterOptions={(options) => options}
              inputValue={f.value}
              onInputChange={(e, value, reason) => {
                // A 'reset' with no event is Autocomplete syncing itself after a
                // re-render, not you picking or typing anything.
                if (reason === 'reset' && !e) return;
                if (value !== f.value) update(f.id, { value });
              }}
              onFocus={() => setFocusedId(f.id)}
              onBlur={() => setFocusedId((id) => (id === f.id ? null : id))}
              slotProps={{ popper: { sx: { minWidth: 260 } } }}
              sx={{ width: 160 }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={f.useRegex ? 'regex…' : 'value…'}
                  error={f.useRegex && !isValidRegex(f.value)}
                />
              )}
            />
          )}
          {/* Case-sensitive toggle */}
          {needsValue(f) && f.field !== 'dateRated' && f.field !== 'score' && (
            <Tooltip title={f.caseSensitive ? 'Case sensitive (on)' : 'Case sensitive (off)'}>
              <ToggleButton
                value="caseSensitive"
                selected={f.caseSensitive}
                onChange={() => update(f.id, { caseSensitive: !f.caseSensitive })}
                size="small"
                sx={{ px: 1, py: 0.25, fontFamily: 'monospace', fontWeight: 700, fontSize: '0.75rem', lineHeight: 1.5 }}
              >
                Aa
              </ToggleButton>
            </Tooltip>
          )}

          {/* Regex toggle */}
          {needsValue(f) && f.field !== 'dateRated' && f.field !== 'score' && (
            <Tooltip title={f.useRegex ? 'Regex (on)' : 'Regex (off)'}>
              <ToggleButton
                value="useRegex"
                selected={f.useRegex}
                onChange={() => update(f.id, { useRegex: !f.useRegex })}
                size="small"
                sx={{ px: 1, py: 0.25, fontFamily: 'monospace', fontWeight: 700, fontSize: '0.75rem', lineHeight: 1.5 }}
              >
                .*
              </ToggleButton>
            </Tooltip>
          )}

          {groupStatsByFilterId?.get(f.id) && (
            <Chip
              label={groupStatsByFilterId.get(f.id)}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
          )}

          {/* Remove row */}
          <IconButton size="small" onClick={() => removeFilter(f.id)} color="error">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}

      <Button size="small" startIcon={<AddIcon />} onClick={addFilter} variant="outlined">
        Add Filter
      </Button>

      <Box sx={{ mt: 1 }}>
        <Button
          size="small"
          startIcon={<EditIcon />}
          onClick={() => setShowLogic((show) => !show)}
          color="inherit"
        >
          {showLogic ? 'Hide Logic' : 'Edit Logic'}
        </Button>
      </Box>

      <Collapse in={showLogic}>
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            label="Logic"
            value={visibleLogic}
            onChange={(e) => onFilterLogicChange?.(e.target.value)}
            size="small"
            multiline
            minRows={2}
            placeholder='(Restaurant/Brand contains "Pizza Hut" AND Category contains "Pizza") OR Restaurant/Brand contains "Dominos"'
            error={!!filterLogic && logicState?.valid === false}
            helperText={filterLogic && logicState?.valid === false ? logicState.error : 'Edit the full filter text with AND, OR, and parentheses.'}
            sx={{ minWidth: 280, flex: '1 1 520px' }}
          />
          {filterLogic && (
            <Button size="small" onClick={() => onFilterLogicChange?.('')} color="inherit" sx={{ mt: 0.5 }}>
              Reset Logic
            </Button>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

function isValidRegex(pattern) {
  if (!pattern) return true;
  try { new RegExp(pattern); return true; } catch { return false; }
}
