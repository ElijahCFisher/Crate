import React, { useRef } from 'react';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

// Filter only on the base category name, not on the "(ParentName)" disambiguator suffix.
const filter = createFilterOptions({
  stringify: (option) => option.baseName ?? option.label,
});

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
    return { uuid: c.uuid, label, baseName: c.restaurantName || '' };
  });
}

export function CategorySelect({
  categories,
  value,
  onChange,
  label = 'Category',
  required = false,
  newCategoryName = null,
}) {
  const options = buildOptions(categories);
  const highlightedOptionRef = useRef(null);
  const skipNextBlurRef = useRef(false);

  const pendingOption = newCategoryName
    ? { uuid: '__new__', label: newCategoryName, isNew: true }
    : null;

  const selectedOption = pendingOption || options.find((o) => o.uuid === value) || null;

  function commitOption(option) {
    if (option?.inputValue) {
      onChange(null, option.inputValue);
    } else if (option?.isNew) {
      return;
    } else {
      onChange(option ? option.uuid : '', null);
    }
  }

  return (
    <Autocomplete
      value={selectedOption}
      onChange={(_, newValue) => {
        commitOption(newValue);
      }}
      onHighlightChange={(_, option) => {
        highlightedOptionRef.current = option;
      }}
      onInputChange={(_, _inputValue, reason) => {
        if (reason === 'clear') onChange('', null);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Tab' || !highlightedOptionRef.current) return;
        commitOption(highlightedOptionRef.current);
        highlightedOptionRef.current = null;
        skipNextBlurRef.current = true;
      }}
      onBlur={(e) => {
        if (skipNextBlurRef.current) {
          skipNextBlurRef.current = false;
          return;
        }

        const typed = (e.target.value || '').trim();
        if (!typed) {
          if (value || newCategoryName) onChange('', null);
          return;
        }

        const match = options.find((o) => o.label.toLowerCase() === typed.toLowerCase());
        if (match) {
          if (match.uuid !== value) onChange(match.uuid, null);
        } else if (typed !== newCategoryName) {
          onChange(null, typed);
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
      isOptionEqualToValue={(opt, val) => {
        if (!val) return false;
        if (opt.isNew && val.isNew) return opt.label === val.label;
        return opt.uuid === val.uuid;
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          size="small"
          InputProps={{
            ...params.InputProps,
            startAdornment: pendingOption ? (
              <>
                <Tooltip title="You're about to create a new category. If this is not intentional, click on an existing category while inputting.">
                  <Chip
                    label="New"
                    size="small"
                    color="warning"
                    sx={{ mr: 0.5, height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                  />
                </Tooltip>
                {params.InputProps.startAdornment}
              </>
            ) : params.InputProps.startAdornment,
          }}
        />
      )}
      clearOnBlur={false}
      selectOnFocus
      handleHomeEndKeys
      freeSolo
    />
  );
}

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
