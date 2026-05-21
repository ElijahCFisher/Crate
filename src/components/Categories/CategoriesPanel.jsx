import React, { useState, useMemo } from 'react';
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
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import CreateCategoryDialog from './CreateCategoryDialog';
import DeleteConfirmDialog from '../Entries/DeleteConfirmDialog';
import { formatDate } from '../../utils/dateUtils';
import { evalAdditionalInfo } from '../../utils/mathUtils';

const COLUMNS = [
  { id: 'restaurantName', label: 'Name', sortable: true },
  { id: 'parent', label: 'Parent', sortable: true },
  { id: 'score', label: 'Score', sortable: true, align: 'center' },
  { id: 'dateRated', label: 'Date Rated', sortable: true },
  { id: 'additionalInfo', label: 'Notes', sortable: false },
];

function ScoreBadge({ score }) {
  if (score == null) return <Typography variant="body2" color="text.disabled">—</Typography>;
  const num = parseFloat(score);
  const color = !isNaN(num) ? (num >= 8 ? 'success' : num >= 5 ? 'warning' : 'error') : undefined;
  return <Chip label={score} size="small" color={color} variant="outlined" sx={{ fontWeight: 700, minWidth: 40 }} />;
}

export default function CategoriesPanel({
  categories,
  combined,      // full Map<uuid, entry> — passed through to the edit dialog for rebalance
  onAdd,         // (categoryData) => entry
  onEdit,        // (editEntry, categoryData) — caller applies modifyEntry
  onDelete,      // (entry)
  onAddCategory, // (categoryData) => entry  (for creating a parent on-the-fly)
  onRebalance,   // (updates: Map<uuid, newScore>) => void
}) {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState('asc');
  const [orderBy, setOrderBy] = useState('restaurantName');

  // Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [deleteEntry, setDeleteEntry] = useState(null);

  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.uuid, c.restaurantName])),
    [categories]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => {
      const parentName = catMap.get(c.ratingCategory) || '';
      return (
        (c.restaurantName || '').toLowerCase().includes(q) ||
        parentName.toLowerCase().includes(q) ||
        (c.additionalInfo || '').toLowerCase().includes(q)
      );
    });
  }, [categories, search, catMap]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal, bVal;
      if (orderBy === 'parent') {
        aVal = catMap.get(a.ratingCategory) || '';
        bVal = catMap.get(b.ratingCategory) || '';
      } else {
        aVal = a[orderBy] ?? '';
        bVal = b[orderBy] ?? '';
      }
      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, order, orderBy, catMap]);

  function handleSort(col) {
    if (orderBy === col) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(col);
      setOrder('asc');
    }
  }

  // ── Add dialog handlers ────────────────────────────────────────────────────

  function handleAddSave(categoryData) {
    const entry = onAdd(categoryData);
    return entry;
  }

  function handleAddClose(entry) {
    setAddOpen(false);
  }

  // ── Edit dialog handlers ───────────────────────────────────────────────────

  function handleEditSave(categoryData) {
    if (!editingEntry) return editingEntry;
    onEdit(editingEntry, categoryData);
    // Return a synthetic updated entry so CreateCategoryDialog can call onClose(entry)
    return {
      ...editingEntry,
      restaurantName: categoryData.name,
      ratingCategory: categoryData.ratingCategory,
      score: categoryData.score,
      dateRated: categoryData.dateRated,
      additionalInfo: categoryData.additionalInfo || '',
    };
  }

  function handleEditClose() {
    setEditingEntry(null);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function handleDeleteConfirm() {
    if (deleteEntry) onDelete(deleteEntry);
    setDeleteEntry(null);
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">
          Categories{' '}
          <Typography component="span" variant="body2" color="text.secondary">
            ({filtered.length}{filtered.length !== categories.length ? ` / ${categories.length}` : ''})
          </Typography>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ width: 200 }}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} size="small">
            Add Category
          </Button>
        </Box>
      </Box>

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
                  ) : col.label}
                </TableCell>
              ))}
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length + 1} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    {categories.length === 0
                      ? 'No categories yet.'
                      : 'No categories match your search.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {sorted.map((cat) => {
              const parentName = catMap.get(cat.ratingCategory) || '';
              const notes = cat.additionalInfo ? evalAdditionalInfo(cat.additionalInfo) : '';
              const notesTruncated = notes.length > 40 ? notes.slice(0, 40) + '…' : notes;
              return (
                <TableRow key={cat.uuid} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{cat.restaurantName || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    {parentName ? (
                      <Chip label={parentName} size="small" variant="outlined" color="primary" />
                    ) : (
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center"><ScoreBadge score={cat.score} /></TableCell>
                  <TableCell>{formatDate(cat.dateRated)}</TableCell>
                  <TableCell>
                    {notes ? (
                      <Tooltip title={notes} placement="top-start">
                        <Typography variant="body2" sx={{ cursor: 'default', maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {notesTruncated}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => setEditingEntry(cat)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => setDeleteEntry(cat)} color="error">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add dialog */}
      <CreateCategoryDialog
        open={addOpen}
        initialName=""
        categories={categories}
        onSave={handleAddSave}
        onAddCategory={onAddCategory}
        onClose={handleAddClose}
      />

      {/* Edit dialog */}
      <CreateCategoryDialog
        open={!!editingEntry}
        editEntry={editingEntry}
        initialName=""
        categories={categories}
        combined={combined}
        onSave={handleEditSave}
        onAddCategory={onAddCategory}
        onRebalance={onRebalance}
        onClose={handleEditClose}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteEntry}
        entry={deleteEntry}
        categories={categories}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteEntry(null)}
      />
    </Box>
  );
}
