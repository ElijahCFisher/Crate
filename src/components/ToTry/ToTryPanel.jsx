import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import AddIcon from '@mui/icons-material/Add';
import RateReviewIcon from '@mui/icons-material/RateReview';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DoNotDisturbOnOutlinedIcon from '@mui/icons-material/DoNotDisturbOnOutlined';
import ReplayIcon from '@mui/icons-material/Replay';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import FilterBar from '../Filters/FilterBar';
import ToTryItemDialog from './ToTryItemDialog';
import {
  applyFilters, getActiveFilters, getFilterLogicState, makeDefaultFilter,
  parseSearchVocabulary, remapFilterLogic,
} from '../../utils/filterLogic';
import { TOTRY_FIELDS, statusOf } from '../../utils/toTryUtils';

// `food_ratings_` prefix: cleared on sign-out with the rest of the saved filters.
const PREFS_KEY = 'food_ratings_totry_prefs_v1';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); } catch { return null; }
}

const STATUS_LABELS = { open: 'To try', tried: 'Tried', gone: 'Gone', all: 'All' };
const NO_PLACE = 'No particular place';
const URL_PATTERN = /https?:\/\/\S+/;

export default function ToTryPanel({
  items,
  categories,
  foodEntries,
  searchVocabulary = '',
  onAdd,        // (itemDataArray) => items
  onModify,     // (uuid, updates)
  onDelete,     // (uuid)
  onRate,       // (item) — open Add Entry prefilled from it
  onOpenRating, // (ratingEntry)
}) {
  const [statusFilter, setStatusFilter] = useState(() => loadPrefs()?.statusFilter || 'open');
  const [filters, setFilters] = useState(() => loadPrefs()?.filters || [makeDefaultFilter()]);
  const [filterLogic, setFilterLogic] = useState(() => loadPrefs()?.filterLogic || '');
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ statusFilter, filters, filterLogic })); } catch {}
  }, [statusFilter, filters, filterLogic]);

  const [editing, setEditing] = useState(null); // item, or 'new'
  const [menu, setMenu] = useState(null);       // { anchor, item }
  const [confirmDelete, setConfirmDelete] = useState(null);

  const deferredFilters = useDeferredValue(filters);
  const deferredLogic = useDeferredValue(filterLogic);
  const vocabulary = useMemo(
    () => (searchVocabulary.trim() ? parseSearchVocabulary(searchVocabulary) : null),
    [searchVocabulary]
  );
  const filterOptions = useMemo(() => ({ fields: TOTRY_FIELDS, vocabulary }), [vocabulary]);
  const logicState = useMemo(() => getFilterLogicState(filters, filterLogic, TOTRY_FIELDS), [filters, filterLogic]);

  function handleFiltersChange(nextFilters, meta) {
    setFilters(nextFilters);
    if (meta?.previousFilters && meta?.nextFilters) {
      setFilterLogic((logic) => remapFilterLogic(logic, meta.previousFilters, meta.nextFilters, TOTRY_FIELDS));
    } else if (getActiveFilters(nextFilters).length === 0) {
      setFilterLogic('');
    }
  }

  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.uuid, c.restaurantName])), [categories]);
  const ratingsByUuid = useMemo(() => new Map(foodEntries.map((e) => [e.uuid, e])), [foodEntries]);

  const counts = useMemo(() => {
    const c = { open: 0, tried: 0, gone: 0, all: items.length };
    for (const item of items) c[statusOf(item)]++;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const byStatus = statusFilter === 'all' ? items : items.filter((i) => statusOf(i) === statusFilter);
    return applyFilters(byStatus, deferredFilters, categories, deferredLogic, filterOptions);
  }, [items, statusFilter, deferredFilters, categories, deferredLogic, filterOptions]);

  // Grouped by where, like the list it came from: places A–Z, then everything
  // with no place (chains, groceries, foods to find anywhere) last. Within a
  // place, by category, then name.
  const groups = useMemo(() => {
    const byPlace = new Map();
    for (const item of filtered) {
      const key = item.location?.trim() || '';
      if (!byPlace.has(key)) byPlace.set(key, []);
      byPlace.get(key).push(item);
    }
    const text = (v) => String(v || '').toLowerCase();
    return [...byPlace.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([place, list]) => ({
        place,
        items: list.sort((x, y) =>
          text(categoryNames.get(x.ratingCategory)).localeCompare(text(categoryNames.get(y.ratingCategory)))
          || text(x.restaurantName).localeCompare(text(y.restaurantName))
          || text(x.specifier).localeCompare(text(y.specifier))),
      }));
  }, [filtered, categoryNames]);

  function setStatus(item, status) {
    onModify(item.uuid, { status: status === 'open' ? '' : status });
  }

  function handleRowClick(e, item) {
    if (e.target.closest('button, a, input, [role="button"], .MuiChip-root')) return;
    if (window.getSelection?.().toString()) return;
    setEditing(item);
  }

  function renderRow(item) {
    const status = statusOf(item);
    const link = URL_PATTERN.exec(item.additionalInfo || '')?.[0];
    const rated = (item.triedRatings || []).map((uuid) => ratingsByUuid.get(uuid)).filter(Boolean);
    return (
      <TableRow
        key={item.uuid}
        hover
        onClick={(e) => handleRowClick(e, item)}
        sx={{ cursor: 'pointer', ...(status === 'gone' && { opacity: 0.55 }) }}
      >
        <TableCell>
          <Typography variant="body2" fontWeight={500}>{item.restaurantName || item.specifier || '—'}</Typography>
          {item.restaurantName && item.specifier && (
            <Typography variant="caption" color="text.secondary">{item.specifier}</Typography>
          )}
        </TableCell>
        <TableCell>
          {categoryNames.get(item.ratingCategory)
            ? <Chip size="small" variant="outlined" color="primary" label={categoryNames.get(item.ratingCategory)} />
            : null}
        </TableCell>
        <TableCell>
          {(item.tags || []).map((tag) => <Chip key={tag} size="small" label={tag} sx={{ mr: 0.5, mb: 0.25 }} />)}
        </TableCell>
        <TableCell sx={{ maxWidth: 320 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {item.additionalInfo && (
              <Tooltip title={item.additionalInfo} placement="top-start">
                <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{item.additionalInfo}</Typography>
              </Tooltip>
            )}
            {link && (
              <Tooltip title="Open link">
                <IconButton size="small" component="a" href={link} target="_blank" rel="noopener noreferrer">
                  <OpenInNewIcon sx={{ fontSize: '1rem' }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          {rated.length > 0 && (
            <Tooltip title="Open the rating">
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={rated.length === 1 ? `Rated ${rated[0].score ?? ''}`.trim() : `Rated ×${rated.length}`}
                onClick={() => onOpenRating(rated[rated.length - 1])}
                sx={{ mr: 0.5 }}
              />
            </Tooltip>
          )}
          {status !== 'gone' && (
            <Tooltip title="Rate it — opens Add Entry filled in from this">
              <Button size="small" startIcon={<RateReviewIcon />} onClick={() => onRate(item)}>
                Rate
              </Button>
            </Tooltip>
          )}
          <IconButton size="small" onClick={(e) => setMenu({ anchor: e.currentTarget, item })}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">
          To Try{' '}
          <Typography component="span" variant="body2" color="text.secondary">
            ({filtered.length}{filtered.length !== items.length ? ` / ${items.length}` : ''})
          </Typography>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
            Add
          </Button>
        </Box>
      </Box>

      <ToggleButtonGroup
        value={statusFilter}
        exclusive
        size="small"
        onChange={(_, v) => { if (v) setStatusFilter(v); }}
        sx={{ mb: 1.5 }}
      >
        {['open', 'tried', 'gone', 'all'].map((s) => (
          <ToggleButton key={s} value={s} sx={{ px: 1.5 }}>
            {STATUS_LABELS[s]} ({counts[s]})
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <FilterBar
        filters={filters}
        filterLogic={filterLogic}
        logicState={logicState}
        onFiltersChange={handleFiltersChange}
        onFilterLogicChange={setFilterLogic}
        entries={items}
        categories={categories}
        filterOptions={filterOptions}
        fields={TOTRY_FIELDS}
      />

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Place / brand</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Tags</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    {items.length === 0
                      ? 'Nothing to try yet. Add places and foods you want to get to.'
                      : 'Nothing here matches.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {groups.map((group) => (
              <React.Fragment key={group.place || '\u0000'}>
                <TableRow>
                  <TableCell colSpan={5} sx={{ bgcolor: 'action.hover', py: 0.75 }}>
                    <Typography variant="subtitle2">
                      {group.place || NO_PLACE}
                      <Typography component="span" variant="caption" color="text.secondary"> · {group.items.length}</Typography>
                    </Typography>
                  </TableCell>
                </TableRow>
                {group.items.map(renderRow)}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu && statusOf(menu.item) !== 'tried' && (
          <MenuItem onClick={() => { setStatus(menu.item, 'tried'); setMenu(null); }}>
            <ListItemIcon><CheckCircleOutlineIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Mark tried</ListItemText>
          </MenuItem>
        )}
        {menu && statusOf(menu.item) !== 'open' && (
          <MenuItem onClick={() => { setStatus(menu.item, 'open'); setMenu(null); }}>
            <ListItemIcon><ReplayIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Back to to-try</ListItemText>
          </MenuItem>
        )}
        {menu && statusOf(menu.item) !== 'gone' && (
          <MenuItem onClick={() => { setStatus(menu.item, 'gone'); setMenu(null); }}>
            <ListItemIcon><DoNotDisturbOnOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Mark gone</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => { setEditing(menu.item); setMenu(null); }}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { setConfirmDelete(menu.item); setMenu(null); }} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      <ToTryItemDialog
        open={!!editing}
        item={editing === 'new' ? null : editing}
        items={items}
        categories={categories}
        foodEntries={foodEntries}
        ratingsByUuid={ratingsByUuid}
        onSave={(data) => {
          if (editing === 'new') onAdd([data]);
          else onModify(editing.uuid, data);
        }}
        onOpenRating={(rating) => { setEditing(null); onOpenRating(rating); }}
        onClose={() => setEditing(null)}
      />

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete from To Try?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {[confirmDelete?.restaurantName, confirmDelete?.specifier].filter(Boolean).join(' — ') || 'This item'} will
            be removed from the list. Ratings you made from it stay. To keep it for the record instead, mark it
            tried or gone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)} autoFocus>Cancel</Button>
          <Button color="error" onClick={() => { onDelete(confirmDelete.uuid); setConfirmDelete(null); }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
