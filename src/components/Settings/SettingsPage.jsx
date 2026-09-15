import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useThemeMode } from '../../theme';

export default function SettingsPage({ showAdvancedByDefault, onUpdateShowAdvancedByDefault }) {
  const { mode, setMode } = useThemeMode();

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Settings</Typography>
      <Divider sx={{ mb: 2 }} />

      <Typography variant="subtitle2" color="text.secondary" gutterBottom>Appearance</Typography>
      <ToggleButtonGroup
        value={mode}
        exclusive
        size="small"
        onChange={(_, next) => { if (next) setMode(next); }}
        aria-label="Theme"
        sx={{ mb: 0.5 }}
      >
        <ToggleButton value="system"><SettingsBrightnessIcon fontSize="small" sx={{ mr: 0.75 }} />System</ToggleButton>
        <ToggleButton value="light"><LightModeIcon fontSize="small" sx={{ mr: 0.75 }} />Light</ToggleButton>
        <ToggleButton value="dark"><DarkModeIcon fontSize="small" sx={{ mr: 0.75 }} />Dark</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 3 }}>
        System follows your device's light/dark setting. Saved per device.
      </Typography>

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
