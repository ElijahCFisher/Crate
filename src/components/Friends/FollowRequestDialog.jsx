import React, { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import PeopleIcon from '@mui/icons-material/People';
import Box from '@mui/material/Box';
import { shareFile } from '../../services/driveService';

export default function FollowRequestDialog({
  open,
  requester,   // { email, displayName }
  dataFileId,
  picturesFolderId,
  onAccept,    // (requester) => void — called after share succeeds
  onDecline,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleAccept() {
    if (!dataFileId || !requester) return;
    setLoading(true);
    setError(null);
    try {
      await shareFile(dataFileId, requester.email);
      if (picturesFolderId) await shareFile(picturesFolderId, requester.email);
      onAccept(requester);
    } catch (err) {
      setError(err.message || 'Failed to share. Try again.');
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PeopleIcon />
          Follow Request
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography>
          <strong>{requester?.displayName || requester?.email}</strong>
          {requester?.displayName && requester.displayName !== requester.email && (
            <Typography component="span" variant="body2" color="text.secondary"> ({requester.email})</Typography>
          )}{' '}
          wants to follow your food ratings.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Accepting will share your ratings and photos with them (read-only).
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onDecline} disabled={loading}>Decline</Button>
        <Button
          variant="contained"
          onClick={handleAccept}
          disabled={loading || !dataFileId}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          Share My Ratings
        </Button>
      </DialogActions>
    </Dialog>
  );
}
