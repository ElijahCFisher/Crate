import React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

export default function DeleteConfirmDialog({ open, entry, categories, onConfirm, onCancel, loading }) {
  if (!entry) return null;

  const category = categories.find((c) => c.uuid === entry.ratingCategory);
  const display = [category?.restaurantName, entry.restaurantName, entry.specifier]
    .filter(Boolean)
    .join(' — ');

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Entry</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Are you sure you want to delete <strong>{display || 'this entry'}</strong>? This action will be
          recorded in the changelog but cannot be undone.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
