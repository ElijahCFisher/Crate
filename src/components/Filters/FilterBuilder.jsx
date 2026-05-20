import React, { useState } from 'react';
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
  LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_RATING,
  LABEL_CATEGORY, LABEL_LOCATION, LABEL_NOTES, LABEL_DATE,
} from '../../constants/fieldLabels';

const FIELDS = [
  { value: 'any', label: 'Any field' },
  { value: 'restaurantName', label: LABEL_RESTAURANT },
  { value: 'specifier', label: LABEL_FOOD_NAME },
  { value: 'location', label: LABEL_LOCATION },
  { value: 'score', label: LABEL_RATING },
  { value: 'additionalInfo', label: LABEL_NOTES },
  { value: 'ratingCategory', label: LABEL_CATEGORY },
  { value: 'dateRated', label: LABEL_DATE },
  { value: 'uuid', label: 'UUID' },
];

const TEXT_OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: '=' },
  { value: 'notContains', label: 'not contains' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

const DATE_OPS = [
  { value: 'dateOn', label: 'on' },
  { value: 'dateBefore', label: 'before' },
  { value: 'dateAfter', label: 'after' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

function getOps(field) {
  if (field === 'dateRated') return DATE_OPS;
  return TEXT_OPS;
}

function needsValue(f) {
  return !['isEmpty', 'isNotEmpty'].includes(f.op);
}

function isActiveFilter(f) {
  return !needsValue(f) || f.value.trim();
}

export function makeDefaultFilter() {
  return { id: Date.now() + Math.random(), field: 'any', op: 'contains', value: '', caseSensitive: false, useRegex: false, connector: 'AND' };
}

export function getActiveFilters(filters) {
  return filters.filter(isActiveFilter);
}

export function buildDefaultFilterLogic(filters) {
  const parts = [];
  filters.forEach((filter) => {
    if (!isActiveFilter(filter)) return;
    if (parts.length > 0) parts.push(filter.connector || 'AND');
    parts.push(describeFilter(filter));
  });
  return parts.join(' ');
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
  const catMap = makeCategoryMap(categories);
  return entries.filter((entry) => group.every((filter) => matchFilter(entry, filter, catMap)));
}

export function describeFilter(filter) {
  const fieldLabel = FIELDS.find((field) => field.value === filter.field)?.label || filter.field;
  const allOps = [...TEXT_OPS, ...DATE_OPS];
  const opLabel = allOps.find((op) => op.value === filter.op)?.label || filter.op;
  const value = needsValue(filter) ? ` "${filter.value}"` : '';
  return `${fieldLabel} ${opLabel}${value}`;
}

export function describeFilterGroup(group) {
  return group.map((filter, idx) => {
    const prefix = idx > 0 ? ' AND ' : '';
    return `${prefix}${describeFilter(filter)}`;
  }).join('');
}

function tokenizeLogic(logic, filters) {
  const tokens = [];
  const operands = getActiveFilters(filters)
    .map((filter) => ({ filter, text: describeFilter(filter) }))
    .sort((a, b) => b.text.length - a.text.length);
  let i = 0;

  while (i < logic.length) {
    const char = logic[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ type: char, value: char });
      i++;
      continue;
    }
    const wordMatch = logic.slice(i).match(/^(AND|OR)\b/i);
    if (wordMatch) {
      const word = wordMatch[0].toUpperCase();
      tokens.push({ type: word, value: word });
      i += wordMatch[0].length;
      continue;
    }
    const operand = operands.find(({ text }) => logic.startsWith(text, i));
    if (operand) {
      tokens.push({ type: 'FILTER', value: operand.text, filterId: operand.filter.id });
      i += operand.text.length;
      continue;
    }
    return { tokens: [], error: `Expected filter text near "${logic.slice(i, i + 30)}"` };
  }

  return { tokens, error: null };
}

function parseFilterLogic(logic, filters) {
  const normalized = (logic || buildDefaultFilterLogic(filters)).trim();
  if (!normalized) return { valid: true, ast: null, logic: normalized };

  const { tokens, error } = tokenizeLogic(normalized, filters);
  if (error) return { valid: false, error, ast: null, logic: normalized };

  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume(type) {
    if (peek()?.type !== type) return null;
    return tokens[pos++];
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return { error: 'Expected filter text or parentheses' };

    if (consume('(')) {
      const inner = parseOr();
      if (inner.error) return inner;
      if (!consume(')')) return { error: 'Missing closing parenthesis' };
      return inner;
    }

    const filter = consume('FILTER');
    if (!filter) return { error: 'Expected filter text' };
    return { node: { type: 'filter', filterId: filter.filterId } };
  }

  function parseAnd() {
    let left = parsePrimary();
    if (left.error) return left;

    while (consume('AND')) {
      const right = parsePrimary();
      if (right.error) return right;
      left = { node: { type: 'AND', left: left.node, right: right.node } };
    }

    return left;
  }

  function parseOr() {
    let left = parseAnd();
    if (left.error) return left;

    while (consume('OR')) {
      const right = parseAnd();
      if (right.error) return right;
      left = { node: { type: 'OR', left: left.node, right: right.node } };
    }

    return left;
  }

  const parsed = parseOr();
  if (parsed.error) return { valid: false, error: parsed.error, ast: null, logic: normalized };
  if (pos < tokens.length) return { valid: false, error: `Unexpected "${tokens[pos].value}"`, ast: null, logic: normalized };

  return { valid: true, ast: parsed.node, logic: normalized };
}

function evalFilterAstWithCatMap(ast, entry, filters, catMap) {
  if (!ast) return true;
  if (ast.type === 'AND') return evalFilterAstWithCatMap(ast.left, entry, filters, catMap) && evalFilterAstWithCatMap(ast.right, entry, filters, catMap);
  if (ast.type === 'OR') return evalFilterAstWithCatMap(ast.left, entry, filters, catMap) || evalFilterAstWithCatMap(ast.right, entry, filters, catMap);

  const filter = filters.find((f) => f.id === ast.filterId);
  if (!filter || !isActiveFilter(filter)) return false;
  return matchFilter(entry, filter, catMap);
}

function collectTopLevelOrGroups(ast) {
  if (!ast) return [];
  if (ast.type === 'OR') return [...collectTopLevelOrGroups(ast.left), ...collectTopLevelOrGroups(ast.right)];
  return [ast];
}

function collectFilterIds(ast, ids = new Set()) {
  if (!ast) return ids;
  if (ast.type === 'filter') ids.add(ast.filterId);
  else {
    collectFilterIds(ast.left, ids);
    collectFilterIds(ast.right, ids);
  }
  return ids;
}

export function getFilterLogicState(filters, logic) {
  return parseFilterLogic(logic, filters);
}

export function applyFilterLogicGroup(entries, filters, categories, ast) {
  const catMap = makeCategoryMap(categories);
  return entries.filter((entry) => evalFilterAstWithCatMap(ast, entry, filters, catMap));
}

export function getFilterLogicGroups(filters, logic) {
  const parsed = parseFilterLogic(logic, filters);
  if (!parsed.valid || !parsed.ast) return [];

  return collectTopLevelOrGroups(parsed.ast).map((ast) => {
    const ids = collectFilterIds(ast);
    const groupFilters = filters.filter((filter) => ids.has(filter.id));
    return {
      ast,
      filters: groupFilters,
      lastFilterId: groupFilters[groupFilters.length - 1]?.id,
    };
  });
}

export function remapFilterLogic(logic, oldFilters, nextFilters) {
  if (!logic?.trim()) return logic;

  let nextLogic = logic;
  for (const oldFilter of oldFilters) {
    const nextFilter = nextFilters.find((filter) => filter.id === oldFilter.id);
    if (!nextFilter) continue;
    const oldText = describeFilter(oldFilter);
    const nextText = describeFilter(nextFilter);
    if (oldText === nextText) continue;
    nextLogic = nextLogic.split(oldText).join(nextText);
  }
  return nextLogic;
}

// ── Filter matching ───────────────────────────────────────────────────────────

export function applyFilters(entries, filters, categories, logic = '') {
  // Ignore filters whose value is empty and the op needs one
  const parsed = parseFilterLogic(logic, filters);
  if (!parsed.valid) return applyFilters(entries, filters, categories);
  if (!parsed.ast) return entries;

  const catMap = makeCategoryMap(categories);
  return entries.filter((entry) => evalFilterAstWithCatMap(parsed.ast, entry, filters, catMap));
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

function makeCategoryMap(categories) {
  return categories instanceof Map
    ? categories
    : new Map(categories.map((c) => [c.uuid, c.restaurantName]));
}

function matchFilter(entry, filter, catMap) {
  const { field, op, value, caseSensitive, useRegex } = filter;

  // Date field: compare ms timestamps against a YYYY-MM-DD date input
  if (field === 'dateRated') {
    const ms = entry.dateRated;
    if (op === 'isEmpty') return ms == null;
    if (op === 'isNotEmpty') return ms != null;
    if (!value) return false;
    // Compare by date only (strip time from the entry's timestamp)
    const entryDate = new Date(ms);
    const entryStr = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`;
    if (op === 'dateOn') return entryStr === value;
    if (op === 'dateBefore') return entryStr < value;
    if (op === 'dateAfter') return entryStr > value;
    return false;
  }

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

export default function FilterBuilder({
  filters,
  filterLogic,
  logicState,
  onChange,
  onFilterLogicChange,
  groupStatsByFilterId,
}) {
  const [draggingId, setDraggingId] = useState(null);
  const [showLogic, setShowLogic] = useState(false);

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
          {needsValue(f) && f.field !== 'score' && f.field !== 'dateRated' && (
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
          {needsValue(f) && f.field !== 'dateRated' && (
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
          {needsValue(f) && f.field !== 'dateRated' && (
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
