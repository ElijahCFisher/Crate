import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

/**
 * Returns true if the syncError string indicates an authentication failure
 * (token missing or rejected by Drive API).
 */
function isAuthErrorMessage(msg) {
  return (
    msg === 'Not authenticated' ||
    /^Drive (API error|write failed) 401/.test(msg)
  );
}

export default function SyncStatus({
  syncing,
  syncError,
  onClearError,
  onReauthenticate,
  isOffline,
  pendingCount,
}) {
  // Offline takes visual priority over the syncing spinner
  if (isOffline) {
    const queued = pendingCount || 0;
    const tip = queued > 0
      ? `Offline — ${queued} unsaved change${queued !== 1 ? 's' : ''} will sync when back online`
      : 'Offline — working from cache';
    return (
      <Tooltip title={tip}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'warning.light' }}>
          <WifiOffIcon fontSize="small" />
          {queued > 0 && (
            <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1 }}>
              {queued}
            </Typography>
          )}
        </Box>
      </Tooltip>
    );
  }

  if (syncing) {
    return (
      <Tooltip title="Syncing to Google Drive…">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'primary.light' }}>
          <CircularProgress size={18} color="inherit" />
        </Box>
      </Tooltip>
    );
  }

  if (syncError) {
    const isAuth = isAuthErrorMessage(syncError);
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', color: 'error.light' }}>
        <Tooltip title={isAuth ? 'Session expired' : syncError}>
          <ErrorIcon fontSize="small" />
        </Tooltip>
        {isAuth && onReauthenticate ? (
          // Auth error: show a "Re-sign in" button instead of the dismiss X
          <Button
            size="small"
            onClick={onReauthenticate}
            sx={{
              color: 'inherit',
              ml: 0.5,
              textTransform: 'none',
              fontSize: '0.75rem',
              py: '2px',
              px: '6px',
              minWidth: 'unset',
              lineHeight: 1.4,
            }}
          >
            Re-sign in
          </Button>
        ) : (
          // Non-auth error: dismissible with X
          onClearError && (
            <IconButton size="small" onClick={onClearError} sx={{ color: 'inherit', p: 0.25 }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )
        )}
      </Box>
    );
  }

  return (
    <Tooltip title="Synced">
      <CheckCircleIcon fontSize="small" sx={{ color: 'success.light' }} />
    </Tooltip>
  );
}
