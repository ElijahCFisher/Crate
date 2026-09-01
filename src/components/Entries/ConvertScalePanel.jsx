import React, { useMemo, useEffect, useDeferredValue } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FilterBar from '../Filters/FilterBar';
import {
  applyFilters, getActiveFilters,
  getFilterLogicState, remapFilterLogic,
} from '../Filters/FilterBuilder';
import { CategorySelect } from '../Categories/CategorySelector';
import { convertBetweenScales, roundToValidScore, getBaseCategory } from '../../utils/scaleUtils';

export const CONVERT_PREVIEW_LIMIT = 5;

function makeCategoryMap(categories) {
  return categories instanceof Map
    ? categories
    : new Map(categories.map((c) => [c.uuid, c]));
}

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

export function buildConvertPreview({
  foodEntries,
  filters,
  filterLogic,
  categories,
  toUuid,
}) {
  const categoryMap = makeCategoryMap(categories);
  const hasFilter = getActiveFilters(filters).length > 0;
  const filteredEntries = hasFilter
    ? applyFilters(foodEntries, filters, categories, filterLogic)
    : [];

  const matches = filteredEntries.map((entry) => {
    const hasScore = Number.isFinite(parseFloat(entry.score));
    const converted = toUuid && hasScore
      ? roundToValidScore(
        convertBetweenScales(entry.score, entry.ratingCategory, toUuid, categoryMap),
      )
      : null;
    const changed = !!toUuid && (
      entry.ratingCategory !== toUuid
      || (hasScore && String(converted) !== String(entry.score))
    );
    return { entry, hasScore, converted, changed };
  });

  const changes = toUuid
    ? matches
      .filter(({ changed }) => changed)
      .map(({ entry, hasScore, converted }) => ({
        uuid: entry.uuid,
        updates: hasScore
          ? { ratingCategory: toUuid, score: String(converted) }
          : { ratingCategory: toUuid },
      }))
    : [];

  const crossTreeCount = toUuid
    ? matches.filter(({ entry }) => {
      if (!entry.ratingCategory) return false;
      const destRoot = getBaseCategory(toUuid, categoryMap);
      if (!destRoot) return false;
      const sourceRoot = getBaseCategory(entry.ratingCategory, categoryMap);
      return !!sourceRoot && sourceRoot.uuid !== destRoot.uuid;
    }).length
    : 0;

  const sourceCategoryCount = new Set(
    matches.map(({ entry }) => entry.ratingCategory || ''),
  ).size;

  return {
    categoryMap,
    hasFilter,
    filteredEntries,
    matches,
    previewMatches: matches.slice(0, CONVERT_PREVIEW_LIMIT),
    changes,
    crossTreeCount,
    sourceCategoryCount,
  };
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
  foodEntries,
  categories,
  filters,
  filterLogic,
  toUuid,
  onFiltersChange,
  onFilterLogicChange,
  onToUuidChange,
  onPreviewChange,
  onDirty,
  resultCount,
}) {
  const deferredFilters = useDeferredValue(filters);
  const deferredFilterLogic = useDeferredValue(filterLogic);

  const logicState = useMemo(
    () => getFilterLogicState(filters, filterLogic),
    [filters, filterLogic],
  );

  const {
    categoryMap,
    hasFilter,
    filteredEntries,
    matches,
    previewMatches,
    changes,
    crossTreeCount,
    sourceCategoryCount,
  } = useMemo(() => buildConvertPreview({
    foodEntries,
    filters: deferredFilters,
    filterLogic: deferredFilterLogic,
    categories,
    toUuid,
  }), [foodEntries, deferredFilters, deferredFilterLogic, categories, toUuid]);

  useEffect(() => { onPreviewChange(changes); }, [changes, onPreviewChange]);

  function handleFiltersChange(nextFilters, meta) {
    onFiltersChange(nextFilters);
    if (meta?.previousFilters && meta?.nextFilters) {
      onFilterLogicChange((logic) => remapFilterLogic(logic, meta.previousFilters, meta.nextFilters));
    } else if (getActiveFilters(nextFilters).length === 0) {
      onFilterLogicChange('');
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
        onFilterLogicChange={(logic) => { onFilterLogicChange(logic); onDirty?.(); }}
      />

      <Box sx={{ maxWidth: 340 }}>
        <CategorySelect
          categories={categories}
          value={toUuid}
          onChange={(uuid) => { onToUuidChange(uuid || ''); onDirty?.(); }}
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
              : filteredEntries.length === 0
                  ? 'No entries match that filter'
                  : !toUuid
                    ? `${filteredEntries.length} entr${filteredEntries.length === 1 ? 'y matches' : 'ies match'}; pick a category to convert to`
                    : `${changes.length} of ${filteredEntries.length} will change, moving to ${toName}`
                      + (sourceCategoryCount > 1 ? ` from ${sourceCategoryCount} categories` : '')}
        </Typography>

        {matches.length > 0 && (
          <Box sx={{ maxHeight: 260, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {previewMatches.map(({ entry, hasScore, converted, changed }, idx) => (
              <React.Fragment key={entry.uuid}>
                {idx > 0 && <Divider />}
                <Box sx={{ px: 1.5, py: 1, opacity: !toUuid || changed ? 1 : 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {[entry.restaurantName, entry.specifier].filter(Boolean).join(' · ') || entry.uuid}
                    {' — '}{categoryPath(entry.ratingCategory, categoryMap)}
                    {toUuid && !changed && ' (already there)'}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', color: 'error.main' }}>
                      {hasScore ? entry.score : '(no score)'}
                    </Typography>
                    {toUuid && (
                      <>
                        <ArrowForwardIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
                        <Typography variant="body2" sx={{ flex: 1, fontFamily: 'monospace', color: 'success.main' }}>
                          {hasScore ? converted : '(score unchanged)'}
                        </Typography>
                      </>
                    )}
                  </Box>
                </Box>
              </React.Fragment>
            ))}
            {matches.length > CONVERT_PREVIEW_LIMIT && (
              <>
                <Divider />
                <Box sx={{ px: 1.5, py: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Showing first {CONVERT_PREVIEW_LIMIT} of {matches.length}
                  </Typography>
                </Box>
              </>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
