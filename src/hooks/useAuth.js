import { useState, useCallback, useEffect, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { API_BASE, GOOGLE_AUTH_SCOPE } from '../config';
import { clearGoogleAccessToken } from '../services/googleTokenService';
import { getUserProfile } from '../services/driveService';

/** Thin wrapper around the Worker's JSON API. Throws on non-2xx. */
async function workerFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Start true so we show the loading screen while the session check runs.
  const [isSilentTrying, setIsSilentTrying]   = useState(true);
  const [isSigningIn,    setIsSigningIn]       = useState(false);
  const [authError,      setAuthError]         = useState(null);
  const [userProfile,    setUserProfile]       = useState(null); // { email, displayName }

  // Prevents concurrent silent session checks (mount + online event racing).
  const silentCheckInProgress = useRef(false);

  // Runs a silent session check; sets authenticated/loading state accordingly.
  // Returns true if the session is still valid.
  const checkSession = useCallback(async () => {
    if (silentCheckInProgress.current) return false;
    silentCheckInProgress.current = true;
    setIsSilentTrying(true);
    try {
      await workerFetch('/api/session', { method: 'GET' });
      clearGoogleAccessToken(); // will be lazily re-fetched on first Drive call
      setIsAuthenticated(true);
      setAuthError(null);
      getUserProfile()
        .then((p) => setUserProfile({ email: p.email, displayName: p.name || p.email }))
        .catch(() => {});
      return true;
    } catch {
      clearGoogleAccessToken();
      setIsAuthenticated(false);
      return false;
    } finally {
      silentCheckInProgress.current = false;
      setIsSilentTrying(false);
    }
  }, []);

  // On mount: ask the Worker if we have a valid session cookie.
  useEffect(() => {
    checkSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When the device comes back online and we're not authenticated, re-check
  // whether the session cookie is still valid (it usually is — the user just
  // lost connectivity briefly).  This avoids showing the red ! button and
  // forcing a manual re-login unnecessarily.
  useEffect(() => {
    function handleOnline() {
      if (!isAuthenticated) checkSession();
    }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [isAuthenticated, checkSession]);

  // Auth-code popup flow — the Worker exchanges the code for tokens.
  const login = useGoogleLogin({
    flow:    'auth-code',
    ux_mode: 'popup',
    scope:   GOOGLE_AUTH_SCOPE,

    onSuccess: async ({ code }) => {
      try {
        await workerFetch('/oauth/google/code', {
          method:  'POST',
          headers: { 'X-Requested-With': 'XmlHttpRequest' },
          body:    JSON.stringify({ code }),
        });

        clearGoogleAccessToken();   // fresh token will be fetched on first Drive call
        setIsAuthenticated(true);
        setIsSigningIn(false);
        setAuthError(null);
        getUserProfile()
          .then((p) => setUserProfile({ email: p.email, displayName: p.name || p.email }))
          .catch(() => {});
      } catch (err) {
        setIsSigningIn(false);
        setAuthError(err.message || 'Sign-in failed.');
      }
    },

    onError: () => {
      setIsSigningIn(false);
      setAuthError('Sign-in failed. Please try again.');
    },

    onNonOAuthError: () => {
      setIsSigningIn(false);
      setAuthError('Sign-in was cancelled or blocked.');
    },
  });

  const signIn = useCallback(() => {
    setIsSigningIn(true);
    setAuthError(null);
    login();
  }, [login]);

  const signOut = useCallback(async () => {
    try {
      await workerFetch('/logout', { method: 'POST' });
    } finally {
      clearGoogleAccessToken();
      setIsAuthenticated(false);
      setUserProfile(null);
    }
  }, []);

  return { isAuthenticated, isSilentTrying, isSigningIn, authError, signIn, signOut, userProfile };
}
