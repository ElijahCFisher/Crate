import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import TabIcon from '@mui/icons-material/Tab';
import { useThemeMode } from '../../theme';
import { useDevicePreference, TAB_POSITION_KEY, TAB_POSITIONS } from '../../hooks/useDevicePreference';

export default function SettingsPage({
  showAdvancedByDefault,
  onUpdateShowAdvancedByDefault,
  searchVocabulary = '',
  onUpdateSearchVocabulary,
}) {
  const { mode, setMode } = useThemeMode();
  const [tabPosition, setTabPosition] = useDevicePreference(TAB_POSITION_KEY, 'side', TAB_POSITIONS);

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
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        System follows your device's light/dark setting. Saved per device.
      </Typography>

      <ToggleButtonGroup
        value={tabPosition}
        exclusive
        size="small"
        onChange={(_, next) => { if (next) setTabPosition(next); }}
        aria-label="Tab position"
        sx={{ mb: 0.5 }}
      >
        <ToggleButton value="side"><ViewSidebarIcon fontSize="small" sx={{ mr: 0.75, transform: 'scaleX(-1)' }} />Tabs on side</ToggleButton>
        <ToggleButton value="top"><TabIcon fontSize="small" sx={{ mr: 0.75 }} />Tabs on top</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 3 }}>
        Side tabs apply on wide screens; narrow ones always keep them on top.
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

      {onUpdateSearchVocabulary && (
        <>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 3 }}>
            Search aliases &amp; places
          </Typography>
          <TextField
            value={searchVocabulary}
            onChange={(e) => onUpdateSearchVocabulary(e.target.value)}
            multiline
            minRows={4}
            fullWidth
            spellCheck={false}
            placeholder={'CS = Colorado Springs\nDenver > CO > US\nColorado Springs > CO'}
            InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
            sx={{ maxWidth: 560 }}
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, maxWidth: 560 }}>
            One rule per line. <Box component="span" sx={{ fontFamily: 'monospace' }}>A = B</Box> makes
            a search for either name find both.{' '}
            <Box component="span" sx={{ fontFamily: 'monospace' }}>Denver &gt; CO &gt; US</Box> says
            Denver is in CO, which is in US — so a Location or Any-field filter for CO also finds
            Denver. Regex filters are never widened.
          </Typography>
        </>
      )}
    </Box>
  );
}
