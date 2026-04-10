import React, { useState, useRef } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';

export default function ExportImportDialog({ open, onClose, exportCsv, onImportCsv, syncing }) {
  const [tab, setTab] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  function handleExport() {
    const csv = exportCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'food-ratings-data.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e) {
    setSelectedFile(e.target.files[0] || null);
    setImportError('');
    setImportSuccess('');
  }

  async function handleImport() {
    if (!selectedFile) return;
    setImportError('');
    setImportSuccess('');
    setImporting(true);
    try {
      const text = await selectedFile.text();
      // Format is auto-detected: app format (two-section CSV) vs. legacy spreadsheet
      await onImportCsv(text);
      setImportSuccess('Import successful!');
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setImportError(err.message || 'Import failed. Check the file format and try again.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Export / Import</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Export" />
          <Tab label="Import" />
        </Tabs>

        {tab === 0 && (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Download your entire data file (Combined + Changelog) as a CSV.
            </Typography>
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
            >
              Download CSV
            </Button>
          </Box>
        )}

        {tab === 1 && (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Import a CSV file. Both the app's own export format and the original spreadsheet
              format are supported — the format is detected automatically.
              Existing entries with the same UUID will be skipped.
            </Typography>

            <Button
              variant="outlined"
              component="label"
              startIcon={<UploadIcon />}
              sx={{ mr: 2 }}
            >
              Choose File
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={handleFileChange}
              />
            </Button>
            {selectedFile && (
              <Typography variant="body2" display="inline">
                {selectedFile.name}
              </Typography>
            )}

            {importError && <Alert severity="error" sx={{ mt: 2 }}>{importError}</Alert>}
            {importSuccess && <Alert severity="success" sx={{ mt: 2 }}>{importSuccess}</Alert>}

            <Box sx={{ mt: 2 }}>
              <Button
                variant="contained"
                onClick={handleImport}
                disabled={!selectedFile || importing || syncing}
                startIcon={importing ? <CircularProgress size={16} color="inherit" /> : null}
              >
                {importing ? 'Importing…' : 'Import'}
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
