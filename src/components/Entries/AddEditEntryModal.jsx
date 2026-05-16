import React, { useState, useEffect, useMemo, useRef } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import AddIcon from '@mui/icons-material/Add';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import ReplayIcon from '@mui/icons-material/Replay';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ClearIcon from '@mui/icons-material/Clear';
import { CategorySelect } from '../Categories/CategorySelector';
import { uploadPhoto } from '../../services/driveService';
import DriveImage from '../DriveImage';
import { msToDateInput, dateInputToMs } from '../../utils/dateUtils';
import { evalAdditionalInfo, hasExpressions } from '../../utils/mathUtils';
import {
  LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_RATING, LABEL_CATEGORY,
  LABEL_LOCATION, LABEL_DATE, LABEL_ADDITIONAL_INFO, LABEL_PICTURE,
} from '../../constants/fieldLabels';

/** Read-only UUID field with a one-click copy-to-clipboard button. */
function CopyableUuidField({ uuid }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(uuid).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <TextField
      label="UUID"
      value={uuid}
      InputProps={{
        readOnly: true,
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={copied ? 'Copied!' : 'Copy UUID'}>
              <IconButton size="small" onClick={copy} edge="end">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      }}
      fullWidth
      size="small"
      sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.72rem', color: 'text.secondary' } }}
    />
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const SHARED_DEFAULTS = {
  restaurantName: '',
  specifier: '',
  location: '',
  dateRated: '',
  additionalInfo: '',
  picture: '',
  identicalsText: '',
};

function entryToForm(entry) {
  if (!entry) return {
    ...SHARED_DEFAULTS,
    dateRated: msToDateInput(Date.now()),
    dateRatedMs: Date.now(),
    primaryRating: { ratingCategory: '', newCategoryName: null, score: '' },
    additionalRatings: [],
  };
  return {
    restaurantName: entry.restaurantName || '',
    specifier: entry.specifier || '',
    location: entry.location || '',
    dateRated: msToDateInput(entry.dateRated),
    additionalInfo: entry.additionalInfo || '',
    picture: entry.picture || '',
    identicalsText: formatIdenticalsForInput(entry.identicals),
    primaryRating: {
      ratingCategory: entry.ratingCategory || '',
      newCategoryName: null,
      score: entry.score != null ? String(entry.score) : '',
    },
    additionalRatings: [],
  };
}

function formatIdenticalsForInput(identicals) {
  return (identicals || []).filter(Boolean).join('\n');
}

function parseIdenticalsInput(value, ownUuid) {
  const seen = new Set();
  return String(value || '')
    .split(/[\s,|]+/)
    .map((uuid) => uuid.trim())
    .filter((uuid) => uuid && uuid !== ownUuid)
    .filter((uuid) => {
      if (seen.has(uuid)) return false;
      seen.add(uuid);
      return true;
    });
}

function sameStringArray(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}

/**
 * Compute diff between original entry values and the current form submission.
 * primaryRating.ratingCategory should already be resolved to a UUID before calling.
 */
function computeDiff(original, formShared, primaryRating) {
  const updates = {};

  for (const field of ['restaurantName', 'specifier', 'location', 'additionalInfo', 'picture']) {
    const fv = formShared[field] || '';
    const ov = original[field] || '';
    if (fv !== ov) updates[field] = fv;
  }

  const frc = primaryRating.ratingCategory || '';
  const orc = original.ratingCategory || '';
  if (frc !== orc) updates.ratingCategory = frc;

  const fScore = primaryRating.score !== '' ? primaryRating.score : null;
  const origScore = original.score != null ? String(original.score) : null;
  if (fScore !== origScore) updates.score = fScore;

  const fDateStr = formShared.dateRated;
  const oDateStr = msToDateInput(original.dateRated);
  if (fDateStr !== oDateStr) updates.dateRated = dateInputToMs(fDateStr);

  if ('identicalsText' in formShared) {
    const nextIdenticals = parseIdenticalsInput(formShared.identicalsText, original.uuid);
    const currentIdenticals = parseIdenticalsInput(formatIdenticalsForInput(original.identicals), original.uuid);
    if (!sameStringArray(nextIdenticals, currentIdenticals)) updates.identicals = nextIdenticals;
  }

  return updates;
}

// ── Additional-rating field helpers ──────────────────────────────────────────

function getPrimarySource(form) {
  return {
    ratingCategory: form.primaryRating.ratingCategory,
    newCategoryName: form.primaryRating.newCategoryName,
    score: form.primaryRating.score,
    restaurantName: form.restaurantName,
    specifier: form.specifier,
    location: form.location,
    dateRated: form.dateRated,
    dateRatedMs: form.dateRatedMs ?? null,
    additionalInfo: form.additionalInfo,
    picture: form.picture,
  };
}

function makeAdditionalRating(source) {
  const id = Date.now() + Math.random();
  return {
    id,
    groupId: String(id),
    isIdentical: false,
    ratingCategory: source.ratingCategory ?? '',
    newCategoryName: source.newCategoryName ?? null,
    score: source.score ?? '',
    restaurantName: source.restaurantName ?? '',
    specifier: source.specifier ?? '',
    location: source.location ?? '',
    dateRated: source.dateRated ?? '',
    dateRatedMs: source.dateRatedMs ?? null,
    additionalInfo: source.additionalInfo ?? '',
    picture: source.picture ?? '',
  };
}

function makeIdenticalRating(source, groupId) {
  return {
    id: Date.now() + Math.random(),
    groupId,
    isIdentical: true,
    ratingCategory: source.ratingCategory ?? '',
    newCategoryName: source.newCategoryName ?? null,
    score: source.score ?? '',
    restaurantName: source.restaurantName ?? '',
    specifier: source.specifier ?? '',
    location: source.location ?? '',
    dateRated: source.dateRated ?? '',
    dateRatedMs: source.dateRatedMs ?? null,
    additionalInfo: source.additionalInfo ?? '',
    picture: source.picture ?? '',
  };
}

// ── Bulk-add reconstruction helpers ───────────────────────────────────────────

function buildIdenticalGroups(entries) {
  const byUuid = new Map(entries.map((e) => [e.uuid, e]));
  const visited = new Set();
  const groups = [];
  for (const entry of entries) {
    if (visited.has(entry.uuid)) continue;
    const group = [];
    const queue = [entry];
    while (queue.length > 0) {
      const curr = queue.shift();
      if (visited.has(curr.uuid)) continue;
      visited.add(curr.uuid);
      group.push(curr);
      for (const uid of (curr.identicals || [])) {
        const neighbor = byUuid.get(uid);
        if (neighbor && !visited.has(uid)) queue.push(neighbor);
      }
    }
    groups.push(group);
  }
  return groups;
}

function entriesToForm(entries) {
  if (!entries || entries.length === 0) return entryToForm(null);
  const groups = buildIdenticalGroups(entries);
  const primaryEntry = groups[0][0];

  const shared = {
    restaurantName: primaryEntry.restaurantName || '',
    specifier: primaryEntry.specifier || '',
    location: primaryEntry.location || '',
    dateRated: msToDateInput(primaryEntry.dateRated),
    dateRatedMs: primaryEntry.dateRated ?? Date.now(),
    additionalInfo: primaryEntry.additionalInfo || '',
    picture: primaryEntry.picture || '',
  };

  const primaryRating = {
    ratingCategory: primaryEntry.ratingCategory || '',
    newCategoryName: null,
    score: primaryEntry.score != null ? String(primaryEntry.score) : '',
  };

  function entryToAdditional(e, groupId, isIdentical) {
    return {
      id: Date.now() + Math.random(),
      groupId,
      isIdentical,
      originalUuid: e.uuid,
      ratingCategory: e.ratingCategory || '',
      newCategoryName: null,
      score: e.score != null ? String(e.score) : '',
      restaurantName: e.restaurantName || '',
      specifier: e.specifier || '',
      location: e.location || '',
      dateRated: msToDateInput(e.dateRated),
      dateRatedMs: e.dateRated ?? Date.now(),
      additionalInfo: e.additionalInfo || '',
      picture: e.picture || '',
    };
  }

  const additionalRatings = [];

  for (const e of groups[0].slice(1)) {
    additionalRatings.push(entryToAdditional(e, 'primary', true));
  }

  for (const group of groups.slice(1)) {
    const groupId = String(Date.now() + Math.random());
    for (let i = 0; i < group.length; i++) {
      additionalRatings.push(entryToAdditional(group[i], groupId, i > 0));
    }
  }

  return { ...shared, primaryRating, primaryOriginalUuid: primaryEntry.uuid, additionalRatings };
}

// ── Component ─────────────────────────────────────────────────────────────────


export default function AddEditEntryModal({
  open,
  entry,
  initialEntries,
  categories,
  foodEntries = [],
  onSave,
  onSaveGroups,
  onBulkSave,
  onAddCategory,
  onClose,
  loading,
  saveError,
  showAdvancedByDefault = false,
  picturesFolderId,
}) {
  const isEdit = !!entry;
  const isBulkEdit = !!onBulkSave;

  const restaurantSuggestions = useMemo(() =>
    [...new Set(foodEntries.map((e) => e.restaurantName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [foodEntries]);
  const foodNameSuggestions = useMemo(() =>
    [...new Set(foodEntries.map((e) => e.specifier).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [foodEntries]);
  const locationSuggestions = useMemo(() =>
    [...new Set(foodEntries.map((e) => e.location).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [foodEntries]);

  const [form, setForm] = useState(entryToForm(null));
  const [showAdvanced, setShowAdvanced] = useState(showAdvancedByDefault);
  const [showIdenticalsEditor, setShowIdenticalsEditor] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef(null);
  const highlightedSuggestionsRef = useRef({});

  useEffect(() => {
    if (open) {
      setShowAdvanced(showAdvancedByDefault);
      setShowIdenticalsEditor(false);
      setFormKey((k) => k + 1);
      if (!entry && initialEntries && initialEntries.length > 0) {
        setForm(entriesToForm(initialEntries));
      } else {
        setForm(entryToForm(entry));
      }
    }
  }, [open, entry, initialEntries, showAdvancedByDefault]);

  function setShared(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setPrimary(field, value) {
    setForm((f) => ({ ...f, primaryRating: { ...f.primaryRating, [field]: value } }));
  }

  function setAdditional(idx, field, value) {
    setForm((f) => {
      const next = [...f.additionalRatings];
      next[idx] = { ...next[idx], [field]: value };
      return { ...f, additionalRatings: next };
    });
  }

  function suggestionCommitProps(field, onChange) {
    return {
      onHighlightChange: (_, option) => {
        highlightedSuggestionsRef.current[field] = option || '';
      },
      onKeyDown: (event) => {
        if (event.key !== 'Tab') return;
        const option = highlightedSuggestionsRef.current[field];
        if (option) onChange(field, option);
      },
    };
  }

  async function handlePhotoSelect(file, onChange) {
    if (!file || !picturesFolderId) return;
    setPhotoUploading(true);
    try {
      const fileId = await uploadPhoto(picturesFolderId, crypto.randomUUID(), file);
      onChange('picture', fileId);
    } catch (err) {
      console.error('Photo upload failed:', err);
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  function addAdditionalRating() {
    setForm((f) => ({
      ...f,
      additionalRatings: [...f.additionalRatings, makeAdditionalRating(getPrimarySource(f))],
    }));
  }

  function addIdenticalRating() {
    setForm((f) => ({
      ...f,
      additionalRatings: [...f.additionalRatings, makeIdenticalRating(getPrimarySource(f), 'primary')],
    }));
  }

  function addAdditionalFromEntry(idx) {
    setForm((f) => ({
      ...f,
      additionalRatings: [...f.additionalRatings, makeAdditionalRating(f.additionalRatings[idx])],
    }));
  }

  function addIdenticalOfEntry(idx) {
    setForm((f) => {
      const src = f.additionalRatings[idx];
      return {
        ...f,
        additionalRatings: [...f.additionalRatings, makeIdenticalRating(src, src.groupId)],
      };
    });
  }

  function removeAdditionalRating(idx) {
    setForm((f) => {
      const next = [...f.additionalRatings];
      next.splice(idx, 1);
      return { ...f, additionalRatings: next };
    });
  }

  // ── Category selection ──────────────────────────────────────────────────────

  function applyCategory(target, uuid) {
    if (target === 'primary') {
      setForm((f) => ({
        ...f,
        primaryRating: { ...f.primaryRating, ratingCategory: uuid, newCategoryName: null },
      }));
    } else {
      const idx = parseInt(target.replace('additional-', ''), 10);
      setForm((f) => {
        const next = [...f.additionalRatings];
        next[idx] = { ...next[idx], ratingCategory: uuid, newCategoryName: null };
        return { ...f, additionalRatings: next };
      });
    }
  }

  function applyNewCategoryName(target, name) {
    if (target === 'primary') {
      setForm((f) => ({
        ...f,
        primaryRating: { ...f.primaryRating, ratingCategory: '', newCategoryName: name || null },
      }));
    } else {
      const idx = parseInt(target.replace('additional-', ''), 10);
      setForm((f) => {
        const next = [...f.additionalRatings];
        next[idx] = { ...next[idx], ratingCategory: '', newCategoryName: name || null };
        return { ...f, additionalRatings: next };
      });
    }
  }

  function makeRatingCategoryChangeHandler(target) {
    return (uuid, newName) => {
      if (newName) {
        applyNewCategoryName(target, newName);
      } else {
        applyCategory(target, uuid || '');
      }
    };
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  function handleSubmit(e) {
    e.preventDefault();

    // Resolve a pending new-category name to a UUID, deduped by lowercase name.
    const newCatCache = new Map();
    function resolveCategory(newCategoryName, existingUuid) {
      if (!newCategoryName) return existingUuid || '';
      const key = newCategoryName.trim().toLowerCase();
      if (newCatCache.has(key)) return newCatCache.get(key);
      const cat = onAddCategory({ name: newCategoryName.trim(), dateRated: Date.now() });
      const uuid = cat?.uuid || '';
      newCatCache.set(key, uuid);
      return uuid;
    }

    if (isEdit) {
      const resolvedCategoryUuid = resolveCategory(
        form.primaryRating.newCategoryName,
        form.primaryRating.ratingCategory,
      );
      const resolvedPrimary = { ...form.primaryRating, ratingCategory: resolvedCategoryUuid };
      const updates = computeDiff(entry, form, resolvedPrimary);
      if (Object.keys(updates).length === 0) { onClose(); return; }
      onSave(updates);
    } else if (isBulkEdit) {
      const byUuid = new Map((initialEntries || []).map((orig) => [orig.uuid, orig]));
      const changes = [];

      if (form.primaryOriginalUuid) {
        const orig = byUuid.get(form.primaryOriginalUuid);
        if (orig) {
          const resolvedPrimary = {
            ...form.primaryRating,
            ratingCategory: resolveCategory(form.primaryRating.newCategoryName, form.primaryRating.ratingCategory),
          };
          const diff = computeDiff(orig, form, resolvedPrimary);
          if (Object.keys(diff).length > 0) changes.push({ uuid: form.primaryOriginalUuid, updates: diff });
        }
      }
      for (const r of form.additionalRatings) {
        if (!r.originalUuid) continue;
        const orig = byUuid.get(r.originalUuid);
        if (orig) {
          const resolvedUuid = resolveCategory(r.newCategoryName, r.ratingCategory);
          const diff = computeDiff(orig, r, { ratingCategory: resolvedUuid, score: r.score });
          if (Object.keys(diff).length > 0) changes.push({ uuid: r.originalUuid, updates: diff });
        }
      }

      // Collect new entries (no originalUuid) grouped by their linked existing UUIDs
      function toNewEntry(r) {
        return {
          restaurantName: r.restaurantName,
          specifier: r.specifier,
          location: r.location,
          dateRated: r.dateRatedMs ?? dateInputToMs(r.dateRated),
          additionalInfo: r.additionalInfo,
          picture: r.picture,
          ratingCategory: resolveCategory(r.newCategoryName, r.ratingCategory),
          score: r.score !== '' ? r.score : null,
        };
      }

      const newGroupData = [];

      const primaryNew = form.additionalRatings.filter((r) => r.groupId === 'primary' && !r.originalUuid);
      if (primaryNew.length > 0) {
        newGroupData.push({
          entries: primaryNew.map(toNewEntry),
          existingUuids: form.primaryOriginalUuid ? [form.primaryOriginalUuid] : [],
        });
      }

      const otherNewByGroup = new Map();
      for (const r of form.additionalRatings) {
        if (r.groupId === 'primary') continue;
        if (!otherNewByGroup.has(r.groupId)) otherNewByGroup.set(r.groupId, { entries: [], existingUuids: [] });
        const g = otherNewByGroup.get(r.groupId);
        if (r.originalUuid) g.existingUuids.push(r.originalUuid);
        else g.entries.push(toNewEntry(r));
      }
      for (const [, g] of otherNewByGroup) {
        if (g.entries.length > 0) newGroupData.push(g);
      }

      if (changes.length > 0 || newGroupData.length > 0) onBulkSave(changes, newGroupData);
    } else {
      function toEntry(r, scoreField, resolvedCategoryUuid) {
        return {
          restaurantName: r.restaurantName,
          specifier: r.specifier,
          location: r.location,
          dateRated: r.dateRatedMs ?? dateInputToMs(r.dateRated),
          additionalInfo: r.additionalInfo,
          picture: r.picture,
          ratingCategory: resolvedCategoryUuid,
          score: scoreField !== '' ? scoreField : null,
        };
      }

      const primaryCatUuid = resolveCategory(form.primaryRating.newCategoryName, form.primaryRating.ratingCategory);
      const primaryEntry = toEntry(form, form.primaryRating.score, primaryCatUuid);

      const primaryGroupExtras = form.additionalRatings
        .filter((r) => r.groupId === 'primary')
        .map((r) => toEntry(r, r.score, resolveCategory(r.newCategoryName, r.ratingCategory)));

      const otherAdditionals = form.additionalRatings.filter((r) => r.groupId !== 'primary');
      const groupsMap = new Map();
      for (const r of otherAdditionals) {
        if (!groupsMap.has(r.groupId)) groupsMap.set(r.groupId, []);
        groupsMap.get(r.groupId).push(r);
      }
      const otherGroups = Array.from(groupsMap.values()).map((g) =>
        g.map((r) => toEntry(r, r.score, resolveCategory(r.newCategoryName, r.ratingCategory)))
      );

      if (onSaveGroups) {
        onSaveGroups([[primaryEntry, ...primaryGroupExtras], ...otherGroups]);
      } else {
        onSave([primaryEntry, ...primaryGroupExtras]);
        for (const group of otherGroups) onSave(group);
      }
    }
    onClose();
  }

  // ── Field render helpers ──────────────────────────────────────────────────

  function renderSimpleSharedFields(values, onChange) {
    return (
      <>
        <Grid item xs={12} sm={6}>
          <Autocomplete
            freeSolo
            options={restaurantSuggestions}
            inputValue={values.restaurantName}
            onInputChange={(_, v) => {
              highlightedSuggestionsRef.current.restaurantName = '';
              onChange('restaurantName', v);
            }}
            {...suggestionCommitProps('restaurantName', onChange)}
            renderInput={(params) => (
              <TextField {...params} label={LABEL_RESTAURANT} size="small" fullWidth />
            )}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <Autocomplete
            freeSolo
            options={foodNameSuggestions}
            inputValue={values.specifier}
            onInputChange={(_, v) => {
              highlightedSuggestionsRef.current.specifier = '';
              onChange('specifier', v);
            }}
            {...suggestionCommitProps('specifier', onChange)}
            renderInput={(params) => (
              <TextField {...params} label={LABEL_FOOD_NAME} placeholder="e.g. Chocolate" size="small" fullWidth />
            )}
          />
        </Grid>
      </>
    );
  }

  function renderAdvancedSharedFields(values, onChange, onDateChange) {
    return (
      <>
        <Grid item xs={12} sm={8}>
          <Autocomplete
            freeSolo
            options={locationSuggestions}
            inputValue={values.location}
            onInputChange={(_, v) => {
              highlightedSuggestionsRef.current.location = '';
              onChange('location', v);
            }}
            {...suggestionCommitProps('location', onChange)}
            renderInput={(params) => (
              <TextField {...params} label={LABEL_LOCATION} placeholder="e.g. Denver" size="small" fullWidth />
            )}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField label={LABEL_DATE} type="date"
            value={values.dateRated}
            onChange={(e) => onDateChange(e.target.value)}
            fullWidth size="small" InputLabelProps={{ shrink: true }} />
        </Grid>
        <Grid item xs={12}>
          <TextField label={LABEL_ADDITIONAL_INFO}
            value={values.additionalInfo}
            onChange={(e) => onChange('additionalInfo', e.target.value)}
            fullWidth multiline rows={2} size="small" />
          {hasExpressions(values.additionalInfo) && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              Preview: {evalAdditionalInfo(values.additionalInfo)}
            </Typography>
          )}
        </Grid>
        <Grid item xs={12}>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => handlePhotoSelect(e.target.files?.[0], onChange)}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                {LABEL_PICTURE}
              </Typography>
              {photoUploading ? (
                <CircularProgress size={20} />
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CameraAltIcon fontSize="small" />}
                  onClick={() => photoInputRef.current?.click()}
                  disabled={!picturesFolderId}
                >
                  {values.picture ? 'Replace' : 'Add Photo'}
                </Button>
              )}
              {values.picture && !photoUploading && (
                <IconButton size="small" onClick={() => onChange('picture', '')}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
            {values.picture && !values.picture.startsWith('http') && (
              <DriveImage fileId={values.picture} height={160} style={{ maxWidth: '100%' }} />
            )}
            {values.picture && values.picture.startsWith('http') && (
              <img src={values.picture} alt="Rating photo" style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 4, display: 'block' }} />
            )}
          </Box>
        </Grid>
      </>
    );
  }

  function renderIdenticalsEditor() {
    const identicals = parseIdenticalsInput(form.identicalsText, entry?.uuid);
    return (
      <Grid item xs={12}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: showIdenticalsEditor ? 1 : 0 }}>
          <Typography variant="body2" color="text.secondary">
            Identicals: {identicals.length}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<EditIcon fontSize="small" />}
            onClick={() => setShowIdenticalsEditor((v) => !v)}
          >
            {showIdenticalsEditor ? 'Hide' : 'Edit'}
          </Button>
        </Box>
        {showIdenticalsEditor && (
          <TextField
            label="Identicals"
            value={form.identicalsText}
            onChange={(e) => setShared('identicalsText', e.target.value)}
            helperText="Enter entry UUIDs separated by spaces, commas, pipes, or new lines."
            fullWidth
            multiline
            minRows={3}
            size="small"
          />
        )}
      </Grid>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEdit ? 'Edit Entry' : isBulkEdit ? 'Bulk Add' : 'Add Entry'}</DialogTitle>
        <DialogContent dividers>
          {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}

          <Grid container spacing={2}>
            {/* ── UUID (read-only, edit mode only) ─────────────────────── */}
            {isEdit && entry?.uuid && (
              <Grid item xs={12}>
                <CopyableUuidField uuid={entry.uuid} />
              </Grid>
            )}

            {/* ── Primary Rating ──────────────────────────────────────── */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                {isEdit ? 'Rating' : form.additionalRatings.length > 0 ? 'Rating 1' : 'Rating'}
              </Typography>
            </Grid>

            {/* Simple shared fields: Restaurant/Brand + Food Name */}
            {/* In add mode: shown here (before score). In edit mode: shown after divider below. */}
            {!isEdit && renderSimpleSharedFields(form, setShared)}

            {/* Category: always in edit, advanced-only in add */}
            {(isEdit || showAdvanced) && (
              <Grid item xs={12} sm={7}>
                <CategorySelect
                  key={`primary-cat-${formKey}`}
                  categories={categories}
                  value={form.primaryRating.ratingCategory}
                  newCategoryName={form.primaryRating.newCategoryName}
                  onChange={makeRatingCategoryChangeHandler('primary')}
                  label={LABEL_CATEGORY}
                />
              </Grid>
            )}

            {/* Rating (score) — always visible */}
            <Grid item xs={9} sm={(isEdit || showAdvanced) ? 3 : 4}>
              <TextField
                label={LABEL_RATING}
                value={form.primaryRating.score}
                onChange={(e) => setPrimary('score', e.target.value)}
                fullWidth size="small"
              />
            </Grid>

            {/* Add / re-rate buttons */}
            {!isEdit && (
              <Grid item xs={3} sm={2} sx={{ display: 'flex', alignItems: 'center' }}>
                <Tooltip title="Add another item from this visit (separate entry)">
                  <IconButton size="small" onClick={addAdditionalRating} color="primary">
                    <AddIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Add a re-rating of this entry (linked as identical — same item, different visit)">
                  <IconButton size="small" onClick={addIdenticalRating} sx={{ color: 'text.secondary' }}>
                    <ReplayIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Grid>
            )}

            {/* Show / Hide Advanced toggle (add/bulk-edit mode only) */}
            {!isEdit && (
              <Grid item xs={12}>
                <Button
                  size="small"
                  variant="text"
                  sx={{ textTransform: 'none', color: 'text.secondary', p: 0, minWidth: 0 }}
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
                </Button>
              </Grid>
            )}

            {/* Advanced fields: divider + (restaurant/food name in edit) + location/date/notes/picture */}
            {(isEdit || showAdvanced) && (
              <>
                <Grid item xs={12}><Divider /></Grid>
                {isEdit && renderSimpleSharedFields(form, setShared)}
                {renderAdvancedSharedFields(
                  form,
                  setShared,
                  (v) => setForm((f) => ({ ...f, dateRated: v, dateRatedMs: dateInputToMs(v) }))
                )}
                {isEdit && renderIdenticalsEditor()}
              </>
            )}

            {/* ── Additional ratings ───────────────────────────────────── */}
            {!isEdit && (() => {
              const idxById = new Map(form.additionalRatings.map((r, i) => [r.id, i]));

              const seen = new Set(['primary']);
              const nonPrimaryGroupOrder = [];
              for (const r of form.additionalRatings) {
                if (!seen.has(r.groupId)) { seen.add(r.groupId); nonPrimaryGroupOrder.push(r.groupId); }
              }

              const leaderNumber = new Map(nonPrimaryGroupOrder.map((gid, i) => [gid, i + 2]));

              function renderAdditionalBlock(r, indented) {
                const idx = idxById.get(r.id);
                const label = r.isIdentical ? 'Re-rating' : `Rating ${leaderNumber.get(r.groupId)}`;

                const inner = (
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {r.isIdentical && (
                            <Tooltip title="Re-rating: linked as identical — same item, different visit">
                              <ReplayIcon sx={{ fontSize: '0.9rem', color: 'primary.main' }} />
                            </Tooltip>
                          )}
                          <Typography variant="subtitle2" color="text.secondary">{label}</Typography>
                        </Box>
                        <IconButton size="small" onClick={() => removeAdditionalRating(idx)} color="error">
                          <RemoveCircleOutlineIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      <Divider sx={{ mt: 0.5 }} />
                    </Grid>

                    {/* Simple shared fields */}
                    {renderSimpleSharedFields(r, (field, value) => setAdditional(idx, field, value))}

                    {/* Category: advanced-only */}
                    {showAdvanced && (
                      <Grid item xs={12} sm={7}>
                        <CategorySelect
                          key={`additional-cat-${formKey}-${r.id}`}
                          categories={categories}
                          value={r.ratingCategory}
                          newCategoryName={r.newCategoryName}
                          onChange={makeRatingCategoryChangeHandler(`additional-${idx}`)}
                          label={LABEL_CATEGORY}
                        />
                      </Grid>
                    )}

                    {/* Rating (score) — always visible */}
                    <Grid item xs={9} sm={showAdvanced ? 3 : 4}>
                      <TextField
                        label={LABEL_RATING}
                        value={r.score}
                        onChange={(e) => setAdditional(idx, 'score', e.target.value)}
                        fullWidth size="small"
                      />
                    </Grid>

                    <Grid item xs={3} sm={2} sx={{ display: 'flex', alignItems: 'center' }}>
                      <Tooltip title="Add another item from this visit (separate entry)">
                        <IconButton size="small" onClick={() => addAdditionalFromEntry(idx)} color="primary">
                          <AddIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Add a re-rating of this entry (linked as identical — same item, different visit)">
                        <IconButton size="small" onClick={() => addIdenticalOfEntry(idx)} sx={{ color: 'text.secondary' }}>
                          <ReplayIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Grid>

                    {/* Advanced shared fields */}
                    {showAdvanced && renderAdvancedSharedFields(
                      r,
                      (field, value) => setAdditional(idx, field, value),
                      (v) => setForm((f) => {
                        const next = [...f.additionalRatings];
                        next[idx] = { ...next[idx], dateRated: v, dateRatedMs: dateInputToMs(v) };
                        return { ...f, additionalRatings: next };
                      })
                    )}
                  </Grid>
                );

                return (
                  <Grid item xs={12} key={r.id}>
                    {indented ? (
                      <Box sx={{ ml: 3, pl: 1.5, borderLeft: '3px solid', borderColor: 'primary.main', mt: 1 }}>
                        {inner}
                      </Box>
                    ) : inner}
                  </Grid>
                );
              }

              const primaryReratings = form.additionalRatings.filter((r) => r.groupId === 'primary');
              const otherGroups = nonPrimaryGroupOrder.map((gid) =>
                form.additionalRatings.filter((r) => r.groupId === gid)
              );

              return (
                <>
                  {primaryReratings.map((r) => renderAdditionalBlock(r, true))}
                  {otherGroups.map((members) => (
                    <React.Fragment key={members[0].groupId}>
                      {renderAdditionalBlock(members[0], false)}
                      {members.slice(1).map((r) => renderAdditionalBlock(r, true))}
                    </React.Fragment>
                  ))}
                </>
              );
            })()}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={loading}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}>
            {loading ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
