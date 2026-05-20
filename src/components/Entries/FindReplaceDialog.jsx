import React, { useState, useMemo } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ToggleButton from '@mui/material/ToggleButton';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import {
  LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_LOCATION, LABEL_NOTES,
} from '../../constants/fieldLabels';

const REPLACEABLE_FIELDS = [
  { value: 'restaurantName', label: LABEL_RESTAURANT },
  { value: 'specifier', label: LABEL_FOOD_NAME },
  { value: 'location', label: LABEL_LOCATION },
  { value: 'additionalInfo', label: LABEL_NOTES },
];

function isValidRegex(pattern) {
  if (!pattern) return true;
  try { new RegExp(pattern); return true; } catch { return false; }
}

function matchesFind(str, find, caseSensitive, useRegex) {
  if (!str || !find) return false;
  if (useRegex) {
    try { return new RegExp(find, caseSensitive ? '' : 'i').test(str); } catch { return false; }
  }
  const h = caseSensitive ? str : str.toLowerCase();
  const n = caseSensitive ? find : find.toLowerCase();
  return h.includes(n);
}

function replaceInString(str, find, replace, caseSensitive, useRegex) {
  if (!str || !find) return str;
  if (useRegex) {
    try { return str.replace(new RegExp(find, caseSensitive ? 'g' : 'gi'), replace); } catch { return str; }
  }
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return str.replace(new RegExp(escaped, caseSensitive ? 'g' : 'gi'), replace);
}

export default function FindReplaceDialog({ open, onClose, foodEntries, onReplaceAll }) {
  const [findValue, setFindValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [field, setField] = useState('restaurantName');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [lastReplaceCount, setLastReplaceCount] = useState(null);

  const regexError = useRegex && !!findValue && !isValidRegex(findValue);

  const matches = useMemo(() => {
    if (!findValue || regexError) return [];
    return foodEntries
      .filter((entry) => matchesFind(String(entry[field] ?? ''), findValue, caseSensitive, useRegex))
      .map((entry) => {
        const original = String(entry[field] ?? '');
        const replaced = replaceInString(original, findValue, replaceValue, caseSensitive, useRegex);
        return { entry, original, replaced };
      })
      .filter(({ original, replaced }) => original !== replaced);
  }, [foodEntries, findValue, replaceValue, field, caseSensitive, useRegex, regexError]);

  function handleReplaceAll() {
    if (!matches.length) return;
    const changes = matches.map(({ entry, replaced }) => ({
      uuid: entry.uuid,
      updates: { [field]: replaced },
    }));
    onReplaceAll(changes);
    setLastReplaceCount(matches.length);
  }

  const fieldLabel = REPLACEABLE_FIELDS.find((f) => f.value === field)?.label ?? field;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Find &amp; Replace</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* Field selector */}
          <FormControl size="small" sx={{ width: 220 }}>
            <InputLabel>Field</InputLabel>
            <Select
              value={field}
              label="Field"
              onChange={(e) => { setField(e.target.value); setLastReplaceCount(null); }}
            >
              {REPLACEABLE_FIELDS.map((f) => (
                <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Find row */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <TextField
              label="Find"
              value={findValue}
              onChange={(e) => { setFindValue(e.target.value); setLastReplaceCount(null); }}
              size="small"
              placeholder={useRegex ? 'regex…' : 'search text…'}
              error={regexError}
              helperText={regexError ? 'Invalid regex' : ' '}
              sx={{ flex: 1 }}
              autoFocus
            />
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
              <Tooltip title={caseSensitive ? 'Case sensitive (on)' : 'Case sensitive (off)'}>
                <ToggleButton
                  value="caseSensitive"
                  selected={caseSensitive}
                  onChange={() => { setCaseSensitive((v) => !v); setLastReplaceCount(null); }}
                  size="small"
                  sx={{ px: 1, py: 0.25, fontFamily: 'monospace', fontWeight: 700, fontSize: '0.75rem', lineHeight: 1.5 }}
                >
                  Aa
                </ToggleButton>
              </Tooltip>
              <Tooltip title={useRegex ? 'Regex (on)' : 'Regex (off)'}>
                <ToggleButton
                  value="useRegex"
                  selected={useRegex}
                  onChange={() => { setUseRegex((v) => !v); setLastReplaceCount(null); }}
                  size="small"
                  sx={{ px: 1, py: 0.25, fontFamily: 'monospace', fontWeight: 700, fontSize: '0.75rem', lineHeight: 1.5 }}
                >
                  .*
                </ToggleButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Replace row */}
          <TextField
            label="Replace with"
            value={replaceValue}
            onChange={(e) => { setReplaceValue(e.target.value); setLastReplaceCount(null); }}
            size="small"
            placeholder={useRegex ? 'replacement (use $1, $2 for groups)…' : 'replacement…'}
            sx={{ flex: 1 }}
          />

          {/* Results */}
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {lastReplaceCount != null
                ? `Replaced ${lastReplaceCount} entr${lastReplaceCount === 1 ? 'y' : 'ies'}`
                : findValue && !regexError
                  ? `${matches.length} entr${matches.length !== 1 ? 'ies' : 'y'} will change in ${fieldLabel}`
                  : 'Enter a search term above'}
            </Typography>

            {matches.length > 0 && (
              <Box sx={{ maxHeight: 280, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                {matches.map(({ entry, original, replaced }, idx) => (
                  <React.Fragment key={entry.uuid}>
                    {idx > 0 && <Divider />}
                    <Box sx={{ px: 1.5, py: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {entry.restaurantName && field !== 'restaurantName'
                          ? entry.restaurantName
                          : entry.specifier || entry.uuid}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography
                          variant="body2"
                          sx={{ flex: 1, fontFamily: 'monospace', color: 'error.main', wordBreak: 'break-all' }}
                        >
                          {original}
                        </Typography>
                        <ArrowForwardIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
                        <Typography
                          variant="body2"
                          sx={{ flex: 1, fontFamily: 'monospace', color: 'success.main', wordBreak: 'break-all' }}
                        >
                          {replaced}
                        </Typography>
                      </Box>
                    </Box>
                  </React.Fragment>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          onClick={handleReplaceAll}
          disabled={!matches.length || regexError}
        >
          Replace All ({matches.length})
        </Button>
      </DialogActions>
    </Dialog>
  );
}
