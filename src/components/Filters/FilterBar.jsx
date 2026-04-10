import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ClearIcon from '@mui/icons-material/Clear';
import FilterBuilder, { makeDefaultFilter } from './FilterBuilder';

export default function FilterBar({ filters, onFiltersChange }) {
  const hasActiveFilter = filters.some((f) => f.value.trim() || ['isEmpty', 'isNotEmpty'].includes(f.op));

  function clearAll() {
    onFiltersChange([makeDefaultFilter()]);
  }

  return (
    <Box sx={{ mb: 2 }}>
      <FilterBuilder filters={filters} onChange={onFiltersChange} />
      {hasActiveFilter && (
        <Box sx={{ mt: 0.75 }}>
          <Button size="small" startIcon={<ClearIcon />} onClick={clearAll} color="inherit">
            Clear filters
          </Button>
        </Box>
      )}
    </Box>
  );
}
