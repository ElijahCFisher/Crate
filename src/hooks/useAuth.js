import { useState, useCallback, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { API_BASE, GOOGLE_AUTH_SCOPE } from '../config';
import { clearGoogleAccessToken } from '../services/googleTokenService';

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

  // On mount: ask the Worker if we have a valid session cookie.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await workerFetch('/api/session', { method: 'GET' });
        if (!cancelled) setIsAuthenticated(true);
      } catch {
        clearGoogleAccessToken();
        if (!cancelled) setIsAuthenticated(false);
      } finally {
        if (!cancelled) setIsSilentTrying(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

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
    }
  }, []);

  return { isAuthenticated, isSilentTrying, isSigningIn, authError, signIn, signOut };
}
