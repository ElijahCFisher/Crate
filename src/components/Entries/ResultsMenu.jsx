import React, { useState } from 'react';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Snackbar from '@mui/material/Snackbar';
import IosShareIcon from '@mui/icons-material/IosShare';
import NotesIcon from '@mui/icons-material/Notes';
import TableChartIcon from '@mui/icons-material/TableChart';
import DownloadIcon from '@mui/icons-material/Download';
import ShareIcon from '@mui/icons-material/Share';
import { toCsv, toText, toTsv } from '../../utils/resultsExport';

/** Copy, download or share exactly the entries the filters are showing. */
export default function ResultsMenu({ entries, categories }) {
  const [anchor, setAnchor] = useState(null);
  const [message, setMessage] = useState('');
  const count = entries.length;
  const noun = `${count} entr${count === 1 ? 'y' : 'ies'}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy(text, what) {
    setAnchor(null);
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`Copied ${noun} ${what}`);
    } catch {
      setMessage("Couldn't reach the clipboard");
    }
  }

  function download() {
    setAnchor(null);
    const blob = new Blob([toCsv(entries, categories)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `food-ratings-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function share() {
    setAnchor(null);
    try {
      await navigator.share({ title: `Food ratings (${noun})`, text: toText(entries, categories) });
    } catch (err) {
      if (err?.name !== 'AbortError') setMessage("Couldn't open sharing");
    }
  }

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<IosShareIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        disabled={count === 0}
      >
        Results
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => copy(toText(entries, categories), 'as text')}>
          <ListItemIcon><NotesIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Copy as text" secondary="Restaurant blocks, like text mode" />
        </MenuItem>
        <MenuItem onClick={() => copy(toTsv(entries, categories), 'for a spreadsheet')}>
          <ListItemIcon><TableChartIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Copy for a spreadsheet" secondary="Pastes as rows and columns" />
        </MenuItem>
        <MenuItem onClick={download}>
          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Download CSV" secondary={noun} />
        </MenuItem>
        {canShare && (
          <MenuItem onClick={share}>
            <ListItemIcon><ShareIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Share…" secondary="Send as text" />
          </MenuItem>
        )}
      </Menu>
      <Snackbar
        open={!!message}
        autoHideDuration={3000}
        onClose={() => setMessage('')}
        message={message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
