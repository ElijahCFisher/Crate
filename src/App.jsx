import React from 'react';
import { useAuth } from './hooks/useAuth';
import { useData } from './hooks/useData';
import AppLayout from './components/Layout/AppLayout';

export default function App() {
  const auth = useAuth();
  const data = useData(auth.isAuthenticated);

  function handleReauthenticate() {
    data.setSyncError(null);
    auth.signIn();
  }

  return <AppLayout auth={auth} data={data} onReauthenticate={handleReauthenticate} />;
}
