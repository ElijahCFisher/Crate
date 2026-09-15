import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

/** 'system' follows the OS; 'light' and 'dark' pin it. */
export const THEME_MODES = ['system', 'light', 'dark'];

// A device preference, not an account one: it has to apply before sign-in, and
// a phone in dark mode and a laptop in light mode shouldn't fight over it. The
// key deliberately sits outside the `food_ratings_` prefix sign-out clears.
const THEME_MODE_KEY = 'crate_theme_mode';

function loadThemeMode() {
  try {
    const stored = localStorage.getItem(THEME_MODE_KEY);
    return THEME_MODES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function buildTheme(paletteMode) {
  const dark = paletteMode === 'dark';
  return createTheme({
    palette: {
      mode: paletteMode,
      primary: {
        main: dark ? '#64b5f6' : '#1976d2',
      },
      secondary: {
        main: dark ? '#ffb74d' : '#f57c00',
      },
      background: dark
        ? { default: '#121212', paper: '#1e1e1e' }
        : { default: '#f5f5f5' },
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    },
    components: {
      MuiTableCell: {
        styleOverrides: {
          head: ({ theme }) => ({
            fontWeight: 600,
            backgroundColor: theme.palette.background.default,
          }),
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            // Scrollbars in index.css read these, so they match the mode.
            '--scrollbar-track': dark ? '#1e1e1e' : '#f1f1f1',
            '--scrollbar-thumb': dark ? '#555' : '#bbb',
            '--scrollbar-thumb-hover': dark ? '#777' : '#999',
          },
        },
      },
    },
  });
}

const ThemeModeContext = createContext({ mode: 'system', paletteMode: 'light', setMode: () => {} });

/** The chosen mode ('system' | 'light' | 'dark'), what it resolved to, and a setter. */
export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export function AppThemeProvider({ children }) {
  const [mode, setModeState] = useState(loadThemeMode);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const paletteMode = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  const theme = useMemo(() => buildTheme(paletteMode), [paletteMode]);

  function setMode(next) {
    if (!THEME_MODES.includes(next)) return;
    setModeState(next);
    try { localStorage.setItem(THEME_MODE_KEY, next); } catch {}
  }

  // The browser chrome (address bar on mobile, the PWA title bar) follows along.
  useEffect(() => {
    document.documentElement.style.colorScheme = paletteMode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', paletteMode === 'dark' ? '#1e1e1e' : '#1565C0');
  }, [paletteMode]);

  const value = useMemo(() => ({ mode, paletteMode, setMode }), [mode, paletteMode]);

  return React.createElement(
    ThemeModeContext.Provider,
    { value },
    React.createElement(ThemeProvider, { theme }, children),
  );
}
