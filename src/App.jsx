import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import LoginPage from './components/Auth/LoginPage';
import AppLayout from './components/Layout/AppLayout';

export default function App() {
  const auth = useAuth();
  const data = useData(auth.isAuthenticated);

  // While a silent re-auth attempt is in progress (e.g. page reload with expired token)
  // show a neutral loading screen so we don't flash the login page unnecessarily.
  if (!auth.isAuthenticated && auth.isSilentTrying) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          bgcolor: 'background.default',
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Restoring session…
        </Typography>
      </Box>
    );
  }

  if (!auth.isAuthenticated) {
    return <LoginPage signIn={auth.signIn} isSigningIn={auth.isSigningIn} authError={auth.authError} />;
  }

  /**
   * Called when the user presses "Re-sign in" in the header after a 401 error.
   * Clears the stale error and opens the interactive Google sign-in popup.
   */
  function handleReauthenticate() {
    data.setSyncError(null);
    auth.signIn();
  }

  return <AppLayout auth={auth} data={data} onReauthenticate={handleReauthenticate} />;
}
