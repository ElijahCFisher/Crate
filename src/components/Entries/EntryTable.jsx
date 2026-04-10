import React, { useState, useMemo, useEffect } from 'react';
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
import FilterBar from '../Filters/FilterBar';
import { applyFilters, makeDefaultFilter } from '../Filters/FilterBuilder';
import { formatDate } from '../../utils/dateUtils';
import { evalAdditionalInfo } from '../../utils/mathUtils';

const COLUMNS = [
  { id: 'ratingCategory', label: 'Category', sortable: true },
  { id: 'restaurantName', label: 'Restaurant', sortable: true },
  { id: 'specifier', label: 'Specifier', sortable: true },
  { id: 'location', label: 'Location', sortable: true },
  { id: 'score', label: 'Score', sortable: true, align: 'center' },
  { id: 'dateRated', label: 'Date Rated', sortable: true },
  { id: 'additionalInfo', label: 'Notes', sortable: false },
];

function ScoreBadge({ score }) {
  if (score == null) return <Typography variant="body2" color="text.disabled">—</Typography>;
  const color = score >= 8 ? 'success' : score >= 5 ? 'warning' : 'error';
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

export default function EntryTable({
  foodEntries,
  categories,
  loading,
  onAdd,
  onEdit,
  onDelete,
}) {
  const [filters, setFilters] = useState(() => [makeDefaultFilter()]);
  const [order, setOrder] = useState('asc');
  const [orderBy, setOrderBy] = useState('restaurantName');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [pageInput, setPageInput] = useState('1');

  const categoryMap = useMemo(() => {
    const m = new Map();
    for (const c of categories) m.set(c.uuid, c.restaurantName);
    return m;
  }, [categories]);

  const searchedEntries = useMemo(
    () => applyFilters(foodEntries, filters, categories),
    [foodEntries, filters, categories]
  );

  const sortedEntries = useMemo(() => {
    return [...searchedEntries].sort((a, b) => {
      let aVal, bVal;
      if (orderBy === 'ratingCategory') {
        aVal = categoryMap.get(a.ratingCategory) || '';
        bVal = categoryMap.get(b.ratingCategory) || '';
      } else {
        aVal = a[orderBy] ?? '';
        bVal = b[orderBy] ?? '';
      }
      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }, [searchedEntries, order, orderBy, categoryMap]);

  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / rowsPerPage));

  // Reset to page 0 when filters or sort change
  useEffect(() => {
    setPage(0);
  }, [filters, orderBy, order]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep pageInput in sync with page state (e.g., after filter reset or prev/next navigation)
  useEffect(() => {
    setPageInput(String(page + 1));
  }, [page]);

  const pagedEntries = useMemo(
    () => sortedEntries.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [sortedEntries, page, rowsPerPage]
  );

  function handleSort(col) {
    if (orderBy === col) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(col);
      setOrder('asc');
    }
  }

  function handlePageChange(_, newPage) {
    setPage(newPage);
  }

  function handleRowsPerPageChange(e) {
    setRowsPerPage(parseInt(e.target.value, 10));
    setPage(0);
  }

  function commitPageInput() {
    const n = parseInt(pageInput, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      setPage(n - 1);
    } else {
      setPageInput(String(page + 1)); // reset to current page on invalid input
    }
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
        <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd} size="small">
          Add Entry
        </Button>
      </Box>

      <FilterBar filters={filters} onFiltersChange={setFilters} />

      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
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
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedEntries.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length + 1} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    {foodEntries.length === 0
                      ? 'No entries yet. Click "Add Entry" to get started.'
                      : 'No entries match your filters.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {pagedEntries.map((entry) => (
              <TableRow key={entry.uuid} hover>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination row: page-jump input on the left, MUI pagination on the right */}
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
          count={sortedEntries.length}
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
