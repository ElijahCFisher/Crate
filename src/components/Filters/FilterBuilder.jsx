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

const FIELDS = [
  { value: 'any', label: 'Any field' },
  { value: 'restaurantName', label: 'Restaurant' },
  { value: 'specifier', label: 'Specifier' },
  { value: 'location', label: 'Location' },
  { value: 'score', label: 'Score' },
  { value: 'additionalInfo', label: 'Notes' },
  { value: 'ratingCategory', label: 'Category' },
  { value: 'uuid', label: 'UUID' },
];

const TEXT_OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: '=' },
  { value: 'notContains', label: 'not contains' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

const NUM_OPS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

function getOps(field) {
  return field === 'score' ? NUM_OPS : TEXT_OPS;
}

function needsValue(f) {
  return !['isEmpty', 'isNotEmpty'].includes(f.op);
}

export function makeDefaultFilter() {
  return { id: Date.now() + Math.random(), field: 'any', op: 'contains', value: '', caseSensitive: false, useRegex: false, connector: 'AND' };
}

// ── Filter matching ───────────────────────────────────────────────────────────

export function applyFilters(entries, filters, categories) {
  // Ignore filters whose value is empty and the op needs one
  const active = filters.filter((f) => !needsValue(f) || f.value.trim());
  if (active.length === 0) return entries;

  return entries.filter((entry) => {
    let result = true;
    for (let i = 0; i < active.length; i++) {
      const match = matchFilter(entry, active[i], categories);
      result = i === 0 ? match : active[i].connector === 'OR' ? result || match : result && match;
    }
    return result;
  });
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

  if (field === 'score') {
    const raw = entry.score;
    if (op === 'isEmpty') return raw == null;
    if (op === 'isNotEmpty') return raw != null;
    const num = parseFloat(value);
    if (isNaN(num)) return true;
    if (op === 'eq') return raw === num;
    if (op === 'neq') return raw !== num;
    if (op === 'lt') return raw < num;
    if (op === 'lte') return raw <= num;
    if (op === 'gt') return raw > num;
    if (op === 'gte') return raw >= num;
    return true;
  }

  // Build catMap once per filter call for fast UUID → name lookup
  const catMap = new Map(categories.map((c) => [c.uuid, c.restaurantName]));

  const rawStr =
    field === 'any'
      ? [entry.restaurantName, entry.specifier, entry.location, entry.additionalInfo,
          allCatNamesStr(entry, catMap), entry.score != null ? String(entry.score) : '',
          entry.uuid || ''].join(' ')
      : field === 'ratingCategory'
      ? allCatNamesStr(entry, catMap)   // searches ALL ancestors, not just direct parent
      : field === 'uuid'
      ? String(entry.uuid ?? '')
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

export default function FilterBuilder({ filters, onChange }) {
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
          {needsValue(f) && f.field === 'score' && (
            <TextField
              value={f.value}
              onChange={(e) => update(f.id, { value: e.target.value })}
              size="small"
              type="number"
              sx={{ width: 80 }}
            />
          )}

          {/* Case-sensitive toggle — only for text fields */}
          {f.field !== 'score' && needsValue(f) && (
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

          {/* Regex toggle — only for text fields */}
          {f.field !== 'score' && needsValue(f) && (
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
