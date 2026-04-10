import React, { useState } from 'react';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';

const filter = createFilterOptions();

/**
 * Build option list. When multiple categories share the same name, appends
 * "(ParentName)" to disambiguate — e.g. "Protein (Drink)" vs "Protein (Snack)".
 */
function buildOptions(categories) {
  const nameCounts = new Map();
  for (const c of categories) {
    const key = (c.restaurantName || '').toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  const catMap = new Map(categories.map((c) => [c.uuid, c]));
  return categories.map((c) => {
    let label = c.restaurantName || '';
    if ((nameCounts.get(label.toLowerCase()) || 0) > 1) {
      const parent = catMap.get(c.ratingCategory);
      if (parent?.restaurantName) label = `${label} (${parent.restaurantName})`;
    }
    return { uuid: c.uuid, label };
  });
}

/**
 * Single-select autocomplete for picking a category (or creating a new one).
 * Passes the selected UUID string to onChange.
 */
export function CategorySelect({ categories, value, onChange, label = 'Category', required = false }) {
  const options = buildOptions(categories);
  const selectedOption = options.find((o) => o.uuid === value) || null;

  return (
    <Autocomplete
      value={selectedOption}
      onChange={(_, newValue) => {
        if (newValue && newValue.inputValue) {
          // "Create new" option selected — caller must handle creation
          onChange(null, newValue.inputValue);
        } else {
          onChange(newValue ? newValue.uuid : '', null);
        }
      }}
      filterOptions={(options, params) => {
        const filtered = filter(options, params);
        const { inputValue } = params;
        if (inputValue !== '' && !filtered.some((o) => o.label.toLowerCase() === inputValue.toLowerCase())) {
          filtered.push({ inputValue, label: `Add "${inputValue}"` });
        }
        return filtered;
      }}
      options={options}
      getOptionLabel={(opt) => opt.inputValue || opt.label || ''}
      renderInput={(params) => (
        <TextField {...params} label={label} required={required} size="small" />
      )}
      selectOnFocus
      clearOnBlur
      handleHomeEndKeys
      freeSolo
    />
  );
}

/**
 * Multi-select autocomplete for picking multiple categories.
 * Passes an array of UUID strings to onChange.
 */
export function CategoryMultiSelect({ categories, value = [], onChange, label = 'Categories' }) {
  const options = buildOptions(categories);
  const selectedOptions = value.map((uuid) => options.find((o) => o.uuid === uuid)).filter(Boolean);

  return (
    <Autocomplete
      multiple
      value={selectedOptions}
      onChange={(_, newValues) => {
        onChange(newValues.map((v) => v.uuid));
      }}
      options={options}
      getOptionLabel={(opt) => opt.label || ''}
      isOptionEqualToValue={(opt, val) => opt.uuid === val.uuid}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => (
          <Chip label={option.label} size="small" {...getTagProps({ index })} key={option.uuid} />
        ))
      }
      renderInput={(params) => <TextField {...params} label={label} size="small" />}
    />
  );
}
