import React, { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

function encodeFollowRequest(data) {
  return btoa(JSON.stringify(data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export default function AskToFollowDialog({ open, onClose, userProfile, onRequested }) {
  const [recipientLabel, setRecipientLabel] = useState('');
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState('');

  function handleClose() {
    setRecipientLabel('');
    setCopied(false);
    setLink('');
    onClose();
  }

  function generateLink() {
    if (!userProfile) return;
    const encoded = encodeFollowRequest({
      email: userProfile.email,
      displayName: userProfile.displayName,
    });
    return `${window.location.origin}${window.location.pathname}?followRequest=${encoded}`;
  }

  function handleGenerate() {
    const generated = generateLink();
    setLink(generated);
    navigator.clipboard.writeText(generated).then(() => setCopied(true)).catch(() => {});
    if (onRequested && recipientLabel.trim()) {
      onRequested({ email: recipientLabel.trim(), displayName: recipientLabel.trim() });
    } else if (onRequested) {
      onRequested(null);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Ask Someone to Share Their Ratings</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This generates a link to send. When they open it, they can share their food ratings with you.
        </Typography>
        <TextField
          label="Their email or name (optional, for tracking)"
          value={recipientLabel}
          onChange={(e) => setRecipientLabel(e.target.value)}
          fullWidth
          autoFocus
          sx={{ mb: 2 }}
        />
        {link && (
          <Alert
            severity={copied ? 'success' : 'info'}
            icon={copied ? undefined : <ContentCopyIcon fontSize="inherit" />}
            sx={{ wordBreak: 'break-all' }}
          >
            {copied ? 'Link copied to clipboard!' : link}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
        <Button
          variant="contained"
          onClick={handleGenerate}
          disabled={!userProfile}
          startIcon={<ContentCopyIcon />}
        >
          {link ? 'Copy Again' : 'Generate & Copy Link'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
