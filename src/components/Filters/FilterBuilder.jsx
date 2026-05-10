import React from 'react';
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
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_RATING,
  LABEL_CATEGORY, LABEL_LOCATION, LABEL_NOTES,
} from '../../constants/fieldLabels';

const FIELDS = [
  { value: 'any', label: 'Any field' },
  { value: 'restaurantName', label: LABEL_RESTAURANT },
  { value: 'specifier', label: LABEL_FOOD_NAME },
  { value: 'location', label: LABEL_LOCATION },
  { value: 'score', label: LABEL_RATING },
  { value: 'additionalInfo', label: LABEL_NOTES },
  { value: 'ratingCategory', label: LABEL_CATEGORY },
  { value: 'uuid', label: 'UUID' },
];

const TEXT_OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: '=' },
  { value: 'notContains', label: 'not contains' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

function getOps(field) {
  return TEXT_OPS;
}

function needsValue(f) {
  return !['isEmpty', 'isNotEmpty'].includes(f.op);
}

export function makeDefaultFilter() {
  return { id: Date.now() + Math.random(), field: 'any', op: 'contains', value: '', caseSensitive: false, useRegex: false, connector: 'AND' };
}

export function getActiveFilters(filters) {
  return filters.filter((f) => !needsValue(f) || f.value.trim());
}

export function splitFiltersIntoOrGroups(filters) {
  const active = getActiveFilters(filters);
  const groups = [];
  let current = [];

  for (let i = 0; i < active.length; i++) {
    if (i > 0 && active[i].connector === 'OR' && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(active[i]);
  }

  if (current.length) groups.push(current);
  return groups;
}

export function applyFilterGroup(entries, group, categories) {
  if (!group.length) return entries;
  return entries.filter((entry) => group.every((filter) => matchFilter(entry, filter, categories)));
}

export function describeFilterGroup(group) {
  return group.map((filter, idx) => {
    const fieldLabel = FIELDS.find((field) => field.value === filter.field)?.label || filter.field;
    const opLabel = TEXT_OPS.find((op) => op.value === filter.op)?.label || filter.op;
    const value = needsValue(filter) ? ` "${filter.value}"` : '';
    const prefix = idx > 0 ? ' AND ' : '';
    return `${prefix}${fieldLabel} ${opLabel}${value}`;
  }).join('');
}

// ── Filter matching ───────────────────────────────────────────────────────────

export function applyFilters(entries, filters, categories) {
  // Ignore filters whose value is empty and the op needs one
  const groups = splitFiltersIntoOrGroups(filters);
  if (groups.length === 0) return entries;

  return entries.filter((entry) =>
    groups.some((group) => group.every((filter) => matchFilter(entry, filter, categories)))
  );
}

/**
 * Returns a space-joined string of ALL ancestor category names for an entry,
 * including the direct parent. Uses entry.categories (precomputed ancestor UUID list).
 */
function allCatNamesStr(entry, catMap) {
  // entry.categories already contains the direct parent + all ancestors
  const uuids = new Set([entry.ratingCategory, ...(Array.isArray(entry.categories) ? entry.categories : [])].filter(Boolean));
  return Array.from(uuids).map((uuid) => catMap.get(uuid) || '').filter(Boolean).join(' ');
}

function matchFilter(entry, filter, categories) {
  const { field, op, value, caseSensitive, useRegex } = filter;

  // Build catMap once per filter call for fast UUID → name lookup
  const catMap = new Map(categories.map((c) => [c.uuid, c.restaurantName]));

  // UUID field: exact match only (no partial substring matching)
  if (field === 'uuid') {
    const uuid = String(entry.uuid ?? '');
    if (op === 'isEmpty') return !uuid.trim();
    if (op === 'isNotEmpty') return !!uuid.trim();
    const h = caseSensitive ? uuid : uuid.toLowerCase();
    const n = caseSensitive ? value : value.toLowerCase();
    if (op === 'notContains') return h !== n;
    return h === n;
  }

  if (field === 'any') {
    if (op === 'isEmpty' || op === 'isNotEmpty') {
      const rawStr = [entry.restaurantName, entry.specifier, entry.location, entry.additionalInfo,
        allCatNamesStr(entry, catMap), entry.score != null ? String(entry.score) : ''].join(' ');
      return op === 'isEmpty' ? !rawStr.trim() : !!rawStr.trim();
    }
    // Check all normal fields first
    const dataStr = [entry.restaurantName, entry.specifier, entry.location, entry.additionalInfo,
      allCatNamesStr(entry, catMap), entry.score != null ? String(entry.score) : ''].join(' ');
    const dataMatch = testString(dataStr, op, value, caseSensitive, useRegex);
    // UUID: exact match only in normal mode, regex match in regex mode
    const uuid = String(entry.uuid ?? '');
    const uuidMatch = useRegex
      ? testString(uuid, op, value, caseSensitive, useRegex)
      : (caseSensitive ? uuid : uuid.toLowerCase()) === (caseSensitive ? value : value.toLowerCase());
    if (op === 'notContains') return dataMatch && !uuidMatch;
    return dataMatch || uuidMatch;
  }

  const rawStr =
    field === 'ratingCategory'
      ? allCatNamesStr(entry, catMap)   // searches ALL ancestors, not just direct parent
      : String(entry[field] ?? '');

  if (op === 'isEmpty') return !rawStr.trim();
  if (op === 'isNotEmpty') return !!rawStr.trim();

  return testString(rawStr, op, value, caseSensitive, useRegex);
}

function testString(haystack, op, needle, caseSensitive, useRegex) {
  if (useRegex) {
    let re;
    try {
      re = new RegExp(needle, caseSensitive ? '' : 'i');
    } catch {
      return false; // invalid regex → no match
    }
    if (op === 'notContains') return !re.test(haystack);
    return re.test(haystack);
  }

  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  if (op === 'contains') return h.includes(n);
  if (op === 'equals') return h === n;
  if (op === 'notContains') return !h.includes(n);
  return true;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FilterBuilder({ filters, onChange, groupStatsByFilterId }) {
  function addFilter() {
    onChange([...filters, makeDefaultFilter()]);
  }

  function removeFilter(id) {
    // Always keep at least one row
    const next = filters.filter((f) => f.id !== id);
    onChange(next.length ? next : [makeDefaultFilter()]);
  }

  function update(id, updates) {
    onChange(filters.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      {filters.map((f, idx) => (
        <Box key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, flexWrap: 'wrap' }}>
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
          {needsValue(f) && f.field !== 'score' && (
            <TextField
              value={f.value}
              onChange={(e) => update(f.id, { value: e.target.value })}
              size="small"
              placeholder={f.useRegex ? 'regex…' : 'value…'}
              sx={{ width: 160 }}
              error={f.useRegex && !isValidRegex(f.value)}
            />
          )}
          {/* Case-sensitive toggle */}
          {needsValue(f) && (
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
          {needsValue(f) && (
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
    </Paper>
  );
}

function isValidRegex(pattern) {
  if (!pattern) return true;
  try { new RegExp(pattern); return true; } catch { return false; }
}
