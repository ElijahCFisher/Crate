import React from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';

export default function NotesPanel({ notes, onChange }) {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>Notes</Typography>
      <Divider sx={{ mb: 2 }} />
      <TextField
        multiline
        fullWidth
        minRows={12}
        placeholder="Write anything here..."
        value={notes ?? ''}
        onChange={(e) => onChange(e.target.value)}
        variant="outlined"
      />
    </Box>
  );
}
