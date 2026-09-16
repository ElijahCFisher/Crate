import React from 'react';
import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import AppLayout from './components/Layout/AppLayout';

export default function App() {
  const auth = useAuth();
  const data = useData(auth.isAuthenticated);

  function handleReauthenticate() {
    data.setSyncError(null);
    auth.signIn({ forceConsent: true });
  }

  // Local data goes first: auth flipping to signed-out makes useData fall back
  // to whatever cache is left, and there shouldn't be any.
  async function handleSignOut() {
    data.clearLocalData();
    await auth.signOut();
  }

  return (
    <AppLayout
      auth={auth}
      data={data}
      onReauthenticate={handleReauthenticate}
      onSignOut={handleSignOut}
    />
  );
}
