import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';

export default function SettingsPage({ showAdvancedByDefault, onUpdateShowAdvancedByDefault }) {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>Settings</Typography>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>Entry Form</Typography>
      <FormControlLabel
        control={
          <Switch
            checked={!!showAdvancedByDefault}
            onChange={(e) => onUpdateShowAdvancedByDefault(e.target.checked)}
          />
        }
        label="Show advanced fields by default when adding entries"
      />
    </Box>
  );
}
