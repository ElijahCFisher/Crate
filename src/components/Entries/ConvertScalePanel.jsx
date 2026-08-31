import React, { useState, useMemo, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FilterBar from '../Filters/FilterBar';
import {
  applyFilters, makeDefaultFilter, getActiveFilters,
  getFilterLogicState, remapFilterLogic,
} from '../Filters/FilterBuilder';
import { CategorySelect } from '../Categories/CategorySelector';
import { convertBetweenScales, roundToValidScore, getBaseCategory } from '../../utils/scaleUtils';

function categoryPath(uuid, categoryMap) {
  if (!uuid) return '(uncategorized)';
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
  return parts.join(' / ') || '(uncategorized)';
}

/**
 * Move whatever the filter found into one category, restating each score in
 * that category's scale so it keeps the meaning it had — a 7 under a harsh
 * category isn't a 7 under a generous one.
 *
 * Every entry converts from *its own* category, so one pass can pull entries
 * out of many different categories at once and each still lands correctly.
 *
 * Computes the change set and hands it up via `onPreviewChange`; the dialog
 * owns the apply button. Nothing is written until that button is pressed.
 */
export default function ConvertScalePanel({
  foodEntries, categories, onPreviewChange, onDirty, resultCount,
}) {
  const [filters, setFilters] = useState(() => [makeDefaultFilter()]);
  const [filterLogic, setFilterLogic] = useState('');
  const [toUuid, setToUuid] = useState('');

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.uuid, c])),
    [categories],
  );

  const logicState = useMemo(
    () => getFilterLogicState(filters, filterLogic),
    [filters, filterLogic],
  );

  // An empty filter matches everything, and "convert my entire library" is not
  // something anyone should be one click away from by default.
  const hasFilter = getActiveFilters(filters).length > 0;

  const matches = useMemo(() => {
    if (!hasFilter || !toUuid) return [];
    return applyFilters(foodEntries, filters, categories, filterLogic).map((entry) => {
      const hasScore = Number.isFinite(parseFloat(entry.score));
      const converted = hasScore
        ? roundToValidScore(
          convertBetweenScales(entry.score, entry.ratingCategory, toUuid, categoryMap),
        )
        : null;
      const changed = entry.ratingCategory !== toUuid
        || (hasScore && String(converted) !== String(entry.score));
      return { entry, hasScore, converted, changed };
    });
  }, [foodEntries, filters, filterLogic, categories, toUuid, categoryMap, hasFilter]);

  const changes = useMemo(() => matches
    .filter(({ changed }) => changed)
    .map(({ entry, hasScore, converted }) => ({
      uuid: entry.uuid,
      updates: hasScore
        ? { ratingCategory: toUuid, score: String(converted) }
        : { ratingCategory: toUuid },
    })), [matches, toUuid]);

  useEffect(() => { onPreviewChange(changes); }, [changes, onPreviewChange]);

  // Scores only mean the same thing when both categories hang off one root.
  const crossTreeCount = useMemo(() => {
    if (!toUuid) return 0;
    const destRoot = getBaseCategory(toUuid, categoryMap);
    if (!destRoot) return 0;
    return matches.filter(({ entry }) => {
      if (!entry.ratingCategory) return false;
      const sourceRoot = getBaseCategory(entry.ratingCategory, categoryMap);
      return !!sourceRoot && sourceRoot.uuid !== destRoot.uuid;
    }).length;
  }, [matches, toUuid, categoryMap]);

  const sourceCategoryCount = useMemo(
    () => new Set(matches.map(({ entry }) => entry.ratingCategory || '')).size,
    [matches],
  );

  function handleFiltersChange(nextFilters, meta) {
    setFilters(nextFilters);
    if (meta?.previousFilters && meta?.nextFilters) {
      setFilterLogic((logic) => remapFilterLogic(logic, meta.previousFilters, meta.nextFilters));
    } else if (getActiveFilters(nextFilters).length === 0) {
      setFilterLogic('');
    }
    onDirty?.();
  }

  const toName = toUuid ? categoryMap.get(toUuid)?.restaurantName : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Filter for the ratings to move, then pick where they land. Each one is converted
        from whichever category it's in now, so a mixed result set still comes out right.
      </Typography>

      <FilterBar
        filters={filters}
        filterLogic={filterLogic}
        logicState={logicState}
        onFiltersChange={handleFiltersChange}
        onFilterLogicChange={(logic) => { setFilterLogic(logic); onDirty?.(); }}
      />

      <Box sx={{ maxWidth: 340 }}>
        <CategorySelect
          categories={categories}
          value={toUuid}
          onChange={(uuid) => { setToUuid(uuid || ''); onDirty?.(); }}
          label="Convert to"
        />
      </Box>

      {crossTreeCount > 0 && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {crossTreeCount} of these sit under a different root category than the
          destination, so their scores were never measured against a common scale. The
          conversion will still run, but the result is only as meaningful as those roots
          are comparable.
        </Alert>
      )}

      <Box sx={{ mt: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {resultCount != null
            ? `Converted ${resultCount} entr${resultCount === 1 ? 'y' : 'ies'}`
            : !hasFilter
              ? 'Add a filter above to choose what to convert'
              : !toUuid
                ? 'Pick a category to convert to'
                : matches.length === 0
                  ? 'No entries match that filter'
                  : `${changes.length} of ${matches.length} will change, moving to ${toName}`
                    + (sourceCategoryCount > 1 ? ` from ${sourceCategoryCount} categories` : '')}
        </Typography>

        {matches.length > 0 && (
          <Box sx={{ maxHeight: 260, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {matches.map(({ entry, hasScore, converted, changed }, idx) => (
              <React.Fragment key={entry.uuid}>
                {idx > 0 && <Divider />}
                <Box sx={{ px: 1.5, py: 1, opacity: changed ? 1 : 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {[entry.restaurantName, entry.specifier].filter(Boolean).join(' · ') || entry.uuid}
                    {' — '}{categoryPath(entry.ratingCategory, categoryMap)}
                    {!changed && ' (already there)'}
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
