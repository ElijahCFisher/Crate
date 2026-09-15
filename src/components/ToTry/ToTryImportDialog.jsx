import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import useMediaQuery from '@mui/material/useMediaQuery';
import { HEADER_KINDS, parseToTryDoc, toSavableItem } from '../../utils/toTryUtils';

const KIND_LABELS = {
  place: 'Place',
  area: 'Area in place',
  genre: 'Genre',
  brand: 'Brand / chain',
  sublist: 'List in brand',
  gone: 'Gone',
  section: 'Plain section',
  ignore: 'Ignore',
};

const KIND_HINTS = {
  place: 'a city or region',
  area: 'a neighborhood inside the place above',
  genre: 'a kind of food — becomes the category',
  brand: 'the lines under it are its menu',
  sublist: 'a list inside the brand above',
  gone: "everything under it can't be had anymore",
  section: 'ends the current genre or brand',
  ignore: 'just a label',
};

/**
 * Paste a hand-kept list; see what it becomes; correct what each section header
 * means and what prefix codes stand for; pick what to add.
 */
export default function ToTryImportDialog({ open, onClose, categories, foodEntries, toTryItems, onImport }) {
  const fullScreen = useMediaQuery((theme) => theme.breakpoints.down('md'));
  const [text, setText] = useState('');
  const [headerKinds, setHeaderKinds] = useState({});
  const [codeTags, setCodeTags] = useState({});
  const [included, setIncluded] = useState({}); // lineNumber → bool, overriding the default

  useEffect(() => {
    if (!open) return;
    setText('');
    setHeaderKinds({});
    setCodeTags({});
    setIncluded({});
  }, [open]);

  const deferredText = useDeferredValue(text);
  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.uuid, c.restaurantName])), [categories]);
  const parsed = useMemo(
    () => parseToTryDoc(deferredText, { categories, foodEntries, toTryItems }, { headerKinds, codeTags }),
    [deferredText, categories, foodEntries, toTryItems, headerKinds, codeTags]
  );

  // Duplicates start unticked; everything else starts ticked.
  const isIncluded = (item) => included[item.lineNumber] ?? !item.duplicateOf;
  const chosen = parsed.items.filter(isIncluded);
  const duplicateCount = parsed.items.filter((i) => i.duplicateOf).length;

  function handleImport() {
    if (chosen.length === 0) return;
    onImport(chosen.map(toSavableItem));
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="lg" fullWidth>
      <DialogTitle>Import a To Try list</DialogTitle>
      <DialogContent dividers>
        <TextField
          value={text}
          onChange={(e) => setText(e.target.value)}
          multiline
          minRows={6}
          maxRows={14}
          fullWidth
          autoFocus
          spellCheck={false}
          placeholder={'Paste your list here, e.g.\n\nDenver: (M = with Mom)\nBurgers:\nBig Sky Burger\nM Tag Burger Bar - try the fries\nTucson:\nD Casa Del Rio (best quesadillas)'}
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          A line ending in &quot;:&quot; is a section. &quot;Name - notes&quot; splits into the place and its
          notes. A short capital prefix (M, D…) becomes a tag. You can edit the text here too — add a
          section line to fix how things are grouped.
        </Typography>

        {parsed.items.length > 0 && (
          <>
            {parsed.headers.length > 0 && (
              <Box sx={{ mt: 2.5 }}>
                <Typography variant="subtitle2" gutterBottom>Sections — what does each header mean?</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1 }}>
                  {parsed.headers.map((h) => (
                    <Box key={h.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Select
                        size="small"
                        value={h.kind}
                        onChange={(e) => setHeaderKinds((k) => ({ ...k, [h.key]: e.target.value }))}
                        sx={{ width: 150, flexShrink: 0, fontSize: '0.8rem' }}
                        renderValue={(v) => KIND_LABELS[v]}
                      >
                        {HEADER_KINDS.map((kind) => (
                          <MenuItem key={kind} value={kind} dense>
                            <Box>
                              <Typography variant="body2">{KIND_LABELS[kind]}</Typography>
                              <Typography variant="caption" color="text.secondary">{KIND_HINTS[kind]}</Typography>
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                      <Typography variant="body2" noWrap title={h.name} sx={{ minWidth: 0 }}>
                        {h.name}
                        <Typography component="span" variant="caption" color="text.secondary"> ({h.count})</Typography>
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {parsed.codes.length > 0 && (
              <Box sx={{ mt: 2.5 }}>
                <Typography variant="subtitle2" gutterBottom>Prefix codes — what tag does each stand for?</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                  {parsed.codes.map((c) => (
                    <TextField
                      key={c.code}
                      size="small"
                      label={`${c.code} (${c.count}×)`}
                      value={codeTags[c.code] ?? c.meaning}
                      onChange={(e) => setCodeTags((t) => ({ ...t, [c.code]: e.target.value }))}
                      placeholder={`tag for "${c.code}"`}
                      sx={{ width: 200 }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            <Box sx={{ mt: 2.5, display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">Preview</Typography>
              <Typography variant="caption" color="text.secondary">
                {chosen.length} of {parsed.items.length} will be added
                {duplicateCount > 0 ? ` · ${duplicateCount} look like duplicates and start unticked` : ''}
              </Typography>
            </Box>
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 1, maxHeight: '45vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Place / brand</TableCell>
                    <TableCell>Food</TableCell>
                    <TableCell>Location</TableCell>
                    <TableCell>Genre</TableCell>
                    <TableCell>Tags</TableCell>
                    <TableCell>Notes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {parsed.items.map((item) => {
                    const on = isIncluded(item);
                    return (
                      <TableRow key={item.lineNumber} sx={{ opacity: on ? 1 : 0.5 }}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            checked={on}
                            onChange={(e) => setIncluded((m) => ({ ...m, [item.lineNumber]: e.target.checked }))}
                          />
                        </TableCell>
                        <TableCell>
                          {item.restaurantName || '—'}
                          {item.duplicateOf && (
                            <Chip
                              size="small"
                              color="warning"
                              variant="outlined"
                              label={item.duplicateOf === 'existing' ? 'already on list' : `same as ${item.duplicateOf}`}
                              sx={{ ml: 0.75 }}
                            />
                          )}
                          {item.status === 'gone' && <Chip size="small" label="gone" sx={{ ml: 0.75 }} />}
                        </TableCell>
                        <TableCell>{item.specifier || ''}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.location || ''}</TableCell>
                        <TableCell>{categoryNames.get(item.ratingCategory) || ''}</TableCell>
                        <TableCell>
                          {item.tags.map((t) => <Chip key={t} size="small" label={t} sx={{ mr: 0.5, mb: 0.25 }} />)}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.additionalInfo}>
                          {item.additionalInfo}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleImport} disabled={chosen.length === 0}>
          Add {chosen.length} item{chosen.length === 1 ? '' : 's'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
