import React, { useState, useMemo, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowRightAltIcon from '@mui/icons-material/ArrowRightAlt';
import { CategorySelect } from '../Categories/CategorySelector';
import { convertBetweenScales, roundToValidScore, getBaseCategory } from '../../utils/scaleUtils';
import {
  LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_LOCATION, LABEL_NOTES,
} from '../../constants/fieldLabels';

const NARROW_FIELDS = [
  { value: 'restaurantName', label: LABEL_RESTAURANT },
  { value: 'specifier', label: LABEL_FOOD_NAME },
  { value: 'location', label: LABEL_LOCATION },
  { value: 'additionalInfo', label: LABEL_NOTES },
];

function categoryPath(uuid, categoryMap) {
  const parts = [];
  let current = uuid;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const category = categoryMap.get(current);
    if (!category) break;
    parts.unshift(category.restaurantName || '(unnamed)');
    current = category.ratingCategory;
  }
  return parts.join(' / ');
}

/**
 * Move ratings from one category to another, restating each score in the
 * destination's scale so it keeps the meaning it had — a 7 under a harsh
 * category isn't a 7 under a generous one.
 *
 * Computes the change set and hands it up via `onPreviewChange`; the dialog
 * owns the apply button. Nothing is written until that button is pressed.
 */
export default function ConvertScalePanel({
  foodEntries, categories, onPreviewChange, onDirty, resultCount,
}) {
  const [fromUuid, setFromUuid] = useState('');
  const [toUuid, setToUuid] = useState('');
  const [includeSubcategories, setIncludeSubcategories] = useState(true);
  const [narrowField, setNarrowField] = useState('restaurantName');
  const [narrowText, setNarrowText] = useState('');

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.uuid, c])),
    [categories],
  );

  const matches = useMemo(() => {
    if (!fromUuid || !toUuid || fromUuid === toUuid) return [];
    const needle = narrowText.trim().toLowerCase();

    return foodEntries
      .filter((entry) => {
        const inScope = includeSubcategories
          ? entry.ratingCategory === fromUuid || (entry.categories || []).includes(fromUuid)
          : entry.ratingCategory === fromUuid;
        if (!inScope) return false;
        if (!needle) return true;
        return String(entry[narrowField] ?? '').toLowerCase().includes(needle);
      })
      .map((entry) => {
        const hasScore = Number.isFinite(parseFloat(entry.score));
        const converted = hasScore
          ? roundToValidScore(
            convertBetweenScales(entry.score, entry.ratingCategory, toUuid, categoryMap),
          )
          : null;
        return { entry, hasScore, converted };
      });
  }, [
    foodEntries, fromUuid, toUuid, includeSubcategories,
    narrowField, narrowText, categoryMap,
  ]);

  const changes = useMemo(() => matches.map(({ entry, hasScore, converted }) => ({
    uuid: entry.uuid,
    updates: hasScore
      ? { ratingCategory: toUuid, score: String(converted) }
      : { ratingCategory: toUuid },
  })), [matches, toUuid]);

  useEffect(() => { onPreviewChange(changes); }, [changes, onPreviewChange]);

  // Scores only mean the same thing when both categories hang off one root.
  const crossTree = useMemo(() => {
    if (!fromUuid || !toUuid) return false;
    const fromRoot = getBaseCategory(fromUuid, categoryMap);
    const toRoot = getBaseCategory(toUuid, categoryMap);
    return !!fromRoot && !!toRoot && fromRoot.uuid !== toRoot.uuid;
  }, [fromUuid, toUuid, categoryMap]);

  const scoreChangeCount = matches.filter(
    ({ hasScore, converted, entry }) => hasScore && String(converted) !== String(entry.score),
  ).length;

  const toName = toUuid ? categoryMap.get(toUuid)?.restaurantName : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 200, flex: 1 }}>
          <CategorySelect
            categories={categories}
            value={fromUuid}
            onChange={(uuid) => { setFromUuid(uuid || ''); onDirty?.(); }}
            label="Convert from"
          />
        </Box>
        <ArrowRightAltIcon color="action" />
        <Box sx={{ minWidth: 200, flex: 1 }}>
          <CategorySelect
            categories={categories}
            value={toUuid}
            onChange={(uuid) => { setToUuid(uuid || ''); onDirty?.(); }}
            label="Convert to"
          />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={includeSubcategories}
              onChange={(e) => { setIncludeSubcategories(e.target.checked); onDirty?.(); }}
            />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              Include subcategories
            </Typography>
          }
        />

        <FormControl size="small" sx={{ width: 170 }}>
          <InputLabel>Narrow by</InputLabel>
          <Select
            value={narrowField}
            label="Narrow by"
            onChange={(e) => { setNarrowField(e.target.value); onDirty?.(); }}
          >
            {NARROW_FIELDS.map((f) => (
              <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          size="small"
          label="containing"
          value={narrowText}
          onChange={(e) => { setNarrowText(e.target.value); onDirty?.(); }}
          placeholder="optional…"
          sx={{ flex: 1, minWidth: 150 }}
        />
      </Box>

      {crossTree && (
        <Alert severity="warning">
          These two categories sit under different root categories, so their scores were
          never measured against a common scale. The conversion will still run, but the
          result is only as meaningful as those two roots are comparable.
        </Alert>
      )}

      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {resultCount != null
            ? `Converted ${resultCount} entr${resultCount === 1 ? 'y' : 'ies'}`
            : !fromUuid || !toUuid
              ? 'Pick a category to convert from and to'
              : fromUuid === toUuid
                ? 'Pick two different categories'
                : `${matches.length} entr${matches.length !== 1 ? 'ies' : 'y'} will move to ${toName}`
                  + (matches.length ? `, ${scoreChangeCount} with a score change` : '')}
        </Typography>

        {matches.length > 0 && (
          <Box sx={{ maxHeight: 260, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {matches.map(({ entry, hasScore, converted }, idx) => (
              <React.Fragment key={entry.uuid}>
                {idx > 0 && <Divider />}
                <Box sx={{ px: 1.5, py: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {[entry.restaurantName, entry.specifier].filter(Boolean).join(' · ') || entry.uuid}
                    {entry.ratingCategory !== fromUuid && entry.ratingCategory && (
                      <> — {categoryPath(entry.ratingCategory, categoryMap)}</>
                    )}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', color: 'error.main' }}>
                      {hasScore ? entry.score : '(no score)'}
                    </Typography>
                    <ArrowForwardIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', color: 'success.main' }}>
                      {hasScore ? converted : '(score unchanged)'}
                    </Typography>
                  </Box>
                </Box>
              </React.Fragment>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
