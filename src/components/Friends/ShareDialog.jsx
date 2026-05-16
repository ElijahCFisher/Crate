import React, { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { shareFile } from '../../services/driveService';

export default function ShareDialog({ open, onClose, dataFileId, picturesFolderId, onShared }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  function handleClose() {
    setEmail('');
    setError(null);
    setSuccess(false);
    onClose();
  }

  async function handleShare() {
    if (!email.trim() || !dataFileId) return;
    setLoading(true);
    setError(null);
    try {
      await shareFile(dataFileId, email.trim());
      if (picturesFolderId) await shareFile(picturesFolderId, email.trim());
      setSuccess(true);
      if (onShared) onShared(email.trim());
      setTimeout(handleClose, 1200);
    } catch (err) {
      setError(err.message || 'Failed to share. Check the email and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Share My Ratings</DialogTitle>
      <DialogContent>
        {success ? (
          <Alert severity="success">Shared successfully!</Alert>
        ) : (
          <>
            <TextField
              label="Their email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleShare()}
              fullWidth
              autoFocus
              sx={{ mt: 1 }}
              disabled={loading}
            />
            {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          </>
        )}
      </DialogContent>
      {!success && (
        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleShare}
            disabled={loading || !email.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            Share
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
