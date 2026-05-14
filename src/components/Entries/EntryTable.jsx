import React, { useState, useMemo, useEffect, useDeferredValue } from 'react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import TablePagination from '@mui/material/TablePagination';
import TextField from '@mui/material/TextField';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import FilterBar from '../Filters/FilterBar';
import {
  applyFilterLogicGroup,
  applyFilters,
  getFilterLogicGroups,
  getFilterLogicState,
  getActiveFilters,
  makeDefaultFilter,
  remapFilterLogic,
} from '../Filters/FilterBuilder';
import { formatDate } from '../../utils/dateUtils';
import { evalAdditionalInfo } from '../../utils/mathUtils';
import {
  LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_RATING,
  LABEL_CATEGORY, LABEL_LOCATION, LABEL_DATE, LABEL_NOTES,
} from '../../constants/fieldLabels';

const TABLE_PREFS_KEY = 'food_ratings_table_prefs_v1';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(TABLE_PREFS_KEY) || 'null'); } catch { return null; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(TABLE_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

const COLUMNS = [
  { id: 'ratingCategory', label: LABEL_CATEGORY, sortable: true },
  { id: 'restaurantName', label: LABEL_RESTAURANT, sortable: true },
  { id: 'specifier', label: LABEL_FOOD_NAME, sortable: true },
  { id: 'location', label: LABEL_LOCATION, sortable: true },
  { id: 'score', label: LABEL_RATING, sortable: true, align: 'center' },
  { id: 'dateRated', label: LABEL_DATE, sortable: true },
  { id: 'additionalInfo', label: LABEL_NOTES, sortable: false },
];

// Total column count = expand cell + data columns + (optional) actions column
const TOTAL_COLS = COLUMNS.length + 2;
const TOTAL_COLS_READONLY = COLUMNS.length + 1;

function ScoreBadge({ score }) {
  if (score == null) return <Typography variant="body2" color="text.disabled">—</Typography>;
  const num = parseFloat(score);
  const color = !isNaN(num) ? (num >= 8 ? 'success' : num >= 5 ? 'warning' : 'error') : undefined;
  return (
    <Chip
      label={score}
      size="small"
      color={color}
      variant="outlined"
      sx={{ fontWeight: 700, minWidth: 40 }}
    />
  );
}

function NotesCell({ text }) {
  if (!text) return <Typography variant="body2" color="text.disabled">—</Typography>;
  const evaluated = evalAdditionalInfo(text);
  const truncated = evaluated.length > 40 ? evaluated.slice(0, 40) + '…' : evaluated;
  return (
    <Tooltip title={evaluated} placement="top-start">
      <Typography variant="body2" sx={{ cursor: 'default', maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {truncated}
      </Typography>
    </Tooltip>
  );
}

function getScoreStats(entries) {
  const scores = entries
    .map((entry) => parseFloat(entry.score))
    .filter((score) => Number.isFinite(score));

  if (!scores.length) return { average: null, weightedAverage: null, count: 0 };

  const total = scores.reduce((sum, score) => sum + score, 0);
  const average = total / scores.length;

  const weightFn = (x) => 10 / (10.5 - x);
  const totalWeight = scores.reduce((sum, score) => sum + weightFn(score), 0);
  const weightedTotal = scores.reduce((sum, score) => sum + score * weightFn(score), 0);
  const weightedAverage = weightedTotal / totalWeight;

  return { average, weightedAverage, count: scores.length };
}

function formatAverage(value) {
  if (value == null) return 'N/A';
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function ScoreSummary({ summary }) {
  if (!summary?.hasActiveFilter) return null;

  return (
    <Box sx={{ mt: 1, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          Filtered average
        </Typography>
        <Chip
          label={`${formatAverage(summary.overall.weightedAverage)} (${formatAverage(summary.overall.average)}) · ${summary.overall.count} rating${summary.overall.count === 1 ? '' : 's'}`}
          size="small"
          color={summary.overall.average == null ? 'default' : 'primary'}
          variant="outlined"
          sx={{ fontWeight: 700 }}
        />
      </Box>

    </Box>
  );
}

export default function EntryTable({
  foodEntries,
  categories,
  loading,
  onAdd,
  onEdit,
  onDelete,
  readOnly = false,
}) {
  const [filters, setFilters] = useState(() => loadPrefs()?.filters || [makeDefaultFilter()]);
  const [filterLogic, setFilterLogic] = useState(() => loadPrefs()?.filterLogic || '');
  const [order, setOrder] = useState(() => loadPrefs()?.order || 'desc');
  const [orderBy, setOrderBy] = useState(() => loadPrefs()?.orderBy || 'dateRated');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(() => loadPrefs()?.rowsPerPage || 20);

  useEffect(() => {
    savePrefs({ filters, filterLogic, order, orderBy, rowsPerPage });
  }, [filters, filterLogic, order, orderBy, rowsPerPage]);
  const [pageInput, setPageInput] = useState('1');
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const deferredFilters = useDeferredValue(filters);
  const deferredFilterLogic = useDeferredValue(filterLogic);

  const categoryMap = useMemo(() => {
    const m = new Map();
    for (const c of categories) m.set(c.uuid, c.restaurantName);
    return m;
  }, [categories]);

  // Full map of all food entries by UUID — used to look up identical entries
  const allEntriesMap = useMemo(
    () => new Map(foodEntries.map((e) => [e.uuid, e])),
    [foodEntries]
  );

  const searchedEntries = useMemo(
    () => applyFilters(foodEntries, deferredFilters, categories, deferredFilterLogic),
    [foodEntries, deferredFilters, categories, deferredFilterLogic]
  );

  const logicState = useMemo(
    () => getFilterLogicState(filters, filterLogic),
    [filters, filterLogic]
  );

  const scoreSummary = useMemo(() => {
    const hasActiveFilter = getActiveFilters(deferredFilters).length > 0;
    if (!hasActiveFilter) return { hasActiveFilter: false };

    const groups = getFilterLogicGroups(deferredFilters, deferredFilterLogic).map((group) => {
      const entries = applyFilterLogicGroup(foodEntries, deferredFilters, categories, group.ast);
      return {
        lastFilterId: group.lastFilterId,
        stats: getScoreStats(entries),
      };
    });

    return {
      hasActiveFilter,
      overall: getScoreStats(searchedEntries),
      groups,
    };
  }, [deferredFilters, deferredFilterLogic, foodEntries, categories, searchedEntries]);

  const groupStatsByFilterId = useMemo(() => {
    const map = new Map();
    if (!scoreSummary?.hasActiveFilter || scoreSummary.groups.length <= 1) return map;

    for (const group of scoreSummary.groups) {
      if (!group.lastFilterId) continue;
      map.set(
        group.lastFilterId,
        `Avg ${formatAverage(group.stats.weightedAverage)} (${formatAverage(group.stats.average)}) · ${group.stats.count}`
      );
    }

    return map;
  }, [scoreSummary]);

  const sortedEntries = useMemo(() => {
    const parseLeadingNumber = (val) => {
      const str = String(val);
      const match = str.match(/^(-?\d+(\.\d+)?)(.*)/s);
      if (!match) return { num: null, rest: str };
      return { num: parseFloat(match[1]), rest: match[3] };
    };

    const compareValues = (aVal, bVal) => {
      const a = parseLeadingNumber(aVal ?? '');
      const b = parseLeadingNumber(bVal ?? '');
      if (a.num !== null && b.num !== null) {
        if (a.num !== b.num) return a.num - b.num;
        return a.rest < b.rest ? -1 : a.rest > b.rest ? 1 : 0;
      }
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    };

    return [...searchedEntries].sort((a, b) => {
      let aVal, bVal;
      if (orderBy === 'ratingCategory') {
        aVal = categoryMap.get(a.ratingCategory) || '';
        bVal = categoryMap.get(b.ratingCategory) || '';
      } else {
        aVal = a[orderBy] ?? '';
        bVal = b[orderBy] ?? '';
      }
      const cmp = compareValues(aVal, bVal);
      return order === 'asc' ? cmp : -cmp;
    });
  }, [searchedEntries, order, orderBy, categoryMap]);

  // ── Identicals grouping ────────────────────────────────────────────────────
  // Entries that share UUIDs in their `identicals` arrays are merged into a
  // single group. Only the "primary" entry appears as a standalone row; the
  // others are revealed via the expand arrow.
  //
  // "others" includes ALL identicals (from allEntriesMap), not just filter-
  // matching ones. This ensures UUID searches always expose the full group.
  const groups = useMemo(() => {
    const visited = new Set();
    const result = [];

    for (const entry of sortedEntries) {
      if (visited.has(entry.uuid)) continue;
      visited.add(entry.uuid);

      const others = (entry.identicals || [])
        .map((uuid) => allEntriesMap.get(uuid))
        .filter(Boolean);

      // Mark identicals as visited so they won't appear as separate primary rows
      for (const o of others) visited.add(o.uuid);

      result.push({ primary: entry, others });
    }

    // UUID-field search priority: if the active filter is a UUID-field filter
    // and an "other" has a better UUID match than the primary, promote it.
    let uuidFilterValue = null;
    for (const f of deferredFilters) {
      if (f.field === 'uuid' && f.value?.trim()) {
        uuidFilterValue = f.value.trim().toLowerCase();
        break;
      }
    }
    if (uuidFilterValue) {
      for (const group of result) {
        if (!group.others.length) continue;
        if (group.primary.uuid.toLowerCase() !== uuidFilterValue) {
          const better = group.others.find((o) =>
            o.uuid.toLowerCase() === uuidFilterValue
          );
          if (better) {
            group.others = [group.primary, ...group.others.filter((o) => o !== better)];
            group.primary = better;
          }
        }
      }
    }

    return result;
  }, [sortedEntries, allEntriesMap, deferredFilters]);

  const totalPages = Math.max(1, Math.ceil(groups.length / rowsPerPage));

  // Reset page and collapse all groups when filters or sort change
  useEffect(() => {
    setPage(0);
    setExpandedGroups(new Set());
  }, [deferredFilters, deferredFilterLogic, orderBy, order]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep pageInput in sync with page state
  useEffect(() => {
    setPageInput(String(page + 1));
  }, [page]);

  const pagedGroups = useMemo(
    () => groups.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [groups, page, rowsPerPage]
  );

  function handleSort(col) {
    if (orderBy === col) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(col);
      setOrder('asc');
    }
  }

  function handleFiltersChange(nextFilters, meta) {
    setFilters(nextFilters);
    if (meta?.previousFilters && meta?.nextFilters) {
      setFilterLogic((logic) => remapFilterLogic(logic, meta.previousFilters, meta.nextFilters));
    } else if (getActiveFilters(nextFilters).length === 0) {
      setFilterLogic('');
    }
  }

  function handlePageChange(_, newPage) { setPage(newPage); }

  function handleRowsPerPageChange(e) {
    setRowsPerPage(parseInt(e.target.value, 10));
    setPage(0);
  }

  function commitPageInput() {
    const n = parseInt(pageInput, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      setPage(n - 1);
    } else {
      setPageInput(String(page + 1));
    }
  }

  function toggleExpand(primaryUuid) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(primaryUuid)) next.delete(primaryUuid);
      else next.add(primaryUuid);
      return next;
    });
  }

  // ── Row renderer ─────────────────────────────────────────────────────────
  // Used for both primary and secondary (expanded identical) rows.

  function renderRow(entry, isPrimary, primaryUuid, othersCount, isExpanded) {
    return (
      <TableRow
        key={entry.uuid}
        hover
        sx={
          !isPrimary
            ? { bgcolor: 'action.hover', '& td': { borderBottom: 'none' } }
            : undefined
        }
      >
        {/* Expand/collapse toggle — only on primary rows that have identicals */}
        <TableCell sx={{ width: 36, p: 0, pl: 0.5 }}>
          {isPrimary && othersCount > 0 ? (
            <Tooltip
              title={
                isExpanded
                  ? 'Hide identical ratings'
                  : `Show ${othersCount} identical rating${othersCount !== 1 ? 's' : ''}`
              }
            >
              <IconButton size="small" onClick={() => toggleExpand(primaryUuid)}>
                {isExpanded
                  ? <KeyboardArrowUpIcon fontSize="small" />
                  : <KeyboardArrowDownIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : null}
        </TableCell>

        <TableCell>
          {categoryMap.get(entry.ratingCategory) ? (
            <Chip
              label={categoryMap.get(entry.ratingCategory)}
              size="small"
              variant="outlined"
              color="primary"
            />
          ) : (
            <Typography variant="body2" color="text.disabled">—</Typography>
          )}
        </TableCell>
        <TableCell>{entry.restaurantName || '—'}</TableCell>
        <TableCell>{entry.specifier || '—'}</TableCell>
        <TableCell>{entry.location || '—'}</TableCell>
        <TableCell align="center"><ScoreBadge score={entry.score} /></TableCell>
        <TableCell>{formatDate(entry.dateRated)}</TableCell>
        <TableCell><NotesCell text={entry.additionalInfo} /></TableCell>
        {!readOnly && (
          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => onEdit(entry)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" onClick={() => onDelete(entry)} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </TableCell>
        )}
      </TableRow>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">
          Entries{' '}
          <Typography component="span" variant="body2" color="text.secondary">
            ({searchedEntries.length}{searchedEntries.length !== foodEntries.length ? ` / ${foodEntries.length}` : ''})
          </Typography>
        </Typography>
        {!readOnly && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd} size="small">
            Add Entry
          </Button>
        )}
      </Box>

      <FilterBar
        filters={filters}
        filterLogic={filterLogic}
        logicState={logicState}
        onFiltersChange={handleFiltersChange}
        onFilterLogicChange={setFilterLogic}
        groupStatsByFilterId={groupStatsByFilterId}
      />
      <ScoreSummary summary={scoreSummary} />

      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {/* Narrow expand-toggle column */}
              <TableCell sx={{ width: 36, p: 0 }} />
              {COLUMNS.map((col) => (
                <TableCell key={col.id} align={col.align}>
                  {col.sortable ? (
                    <TableSortLabel
                      active={orderBy === col.id}
                      direction={orderBy === col.id ? order : 'asc'}
                      onClick={() => handleSort(col.id)}
                    >
                      {col.label}
                    </TableSortLabel>
                  ) : (
                    col.label
                  )}
                </TableCell>
              ))}
              {!readOnly && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={readOnly ? TOTAL_COLS_READONLY : TOTAL_COLS} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    {foodEntries.length === 0
                      ? 'No entries yet. Click "Add Entry" to get started.'
                      : 'No entries match your filters.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {pagedGroups.flatMap(({ primary, others }) => {
              const isExpanded = expandedGroups.has(primary.uuid);
              const rows = [
                renderRow(primary, true, primary.uuid, others.length, isExpanded),
              ];
              if (isExpanded) {
                for (const secondary of others) {
                  rows.push(renderRow(secondary, false, primary.uuid, 0, false));
                }
              }
              return rows;
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1 }}>
          <Typography variant="body2" color="text.secondary">Page</Typography>
          <TextField
            size="small"
            type="number"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={commitPageInput}
            onKeyDown={(e) => { if (e.key === 'Enter') commitPageInput(); }}
            inputProps={{ min: 1, max: totalPages, style: { width: 48, textAlign: 'center', padding: '4px 6px' } }}
            sx={{ '& .MuiOutlinedInput-root': { height: 32 } }}
          />
          <Typography variant="body2" color="text.secondary">of {totalPages}</Typography>
        </Box>

        <TablePagination
          component="div"
          count={groups.length}
          page={page}
          onPageChange={handlePageChange}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleRowsPerPageChange}
          rowsPerPageOptions={[10, 20, 50, 100]}
        />
      </Box>
    </Box>
  );
}
