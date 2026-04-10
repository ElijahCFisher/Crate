import { useState, useCallback, useEffect, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import * as authService from '../services/authService';
import { DRIVE_SCOPE } from '../config';

/** Start a proactive silent refresh this many ms before the token expires. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000; // 5 minutes

export function useAuth() {
  // isAuthenticated: true if there is currently a valid token
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isTokenValid());
  // isSilentTrying: true while we are attempting a silent re-auth on startup
  const [isSilentTrying, setIsSilentTrying] = useState(!authService.isTokenValid());
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState(null);

  const refreshTimerRef = useRef(null);
  // Keep a ref to silentLogin so the proactive refresh timer can always call the latest version
  const silentLoginRef  = useRef(null);

  /** Schedule a proactive silent token refresh before the current token expires. */
  function scheduleRefresh(expiresIn) {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // expiresIn is in seconds; fire REFRESH_BEFORE_MS before the effective expiry
    const delayMs = Math.max(0, (expiresIn - 300) * 1000); // 300 s = 5 min
    refreshTimerRef.current = setTimeout(() => silentLoginRef.current?.(), delayMs);
  }

  // ── Silent (prompt: none) login ────────────────────────────────────────────
  // Used on startup and for proactive token refresh.
  // Does NOT open a popup — silently obtains a fresh token if the user is
  // still signed into Google in their browser.

  const silentLogin = useGoogleLogin({
    scope: DRIVE_SCOPE,
    prompt: 'none',
    onSuccess: (tokenResponse) => {
      authService.setAccessToken(tokenResponse.access_token, tokenResponse.expires_in);
      setIsAuthenticated(true);
      setIsSilentTrying(false);
      setAuthError(null);
      scheduleRefresh(tokenResponse.expires_in ?? 3600);
    },
    onError: () => {
      // Silent auth failed (user not signed into Google, revoked access, etc.)
      setIsSilentTrying(false);
      // Only clear isAuthenticated if there is no longer a valid token
      // (avoids flicker when a proactive refresh fails but the token is still usable)
      if (!authService.isTokenValid()) setIsAuthenticated(false);
    },
    onNonOAuthError: () => {
      setIsSilentTrying(false);
      if (!authService.isTokenValid()) setIsAuthenticated(false);
    },
  });

  // Keep ref in sync with the latest silentLogin function
  useEffect(() => { silentLoginRef.current = silentLogin; }, [silentLogin]);

  // On mount: attempt silent auth if token is missing/expired; else schedule proactive refresh
  useEffect(() => {
    let silentFallbackTimer = null;

    if (!authService.isTokenValid()) {
      // Token expired or never set — try to silently recover the session.
      // GIS's prompt:'none' token flow may not fire any callbacks in all browsers,
      // so add a 3-second safety fallback that falls through to the login page.
      silentLogin();
      silentFallbackTimer = setTimeout(() => setIsSilentTrying(false), 3000);
    } else {
      // Token is valid — nothing to do right now; schedule proactive refresh
      setIsSilentTrying(false);
      const msUntilRefresh = authService.getTokenExpiry() - Date.now() - REFRESH_BEFORE_MS;
      if (msUntilRefresh > 0) {
        refreshTimerRef.current = setTimeout(() => silentLoginRef.current?.(), msUntilRefresh);
      }
      // If < 5 min remain the token will stay valid long enough; when it eventually
      // expires the user will see the "Re-sign in" prompt in the header.
    }
    return () => {
      if (silentFallbackTimer) clearTimeout(silentFallbackTimer);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ silentLogin intentionally omitted — we only want this to run once at mount

  // ── Interactive login ──────────────────────────────────────────────────────

  const login = useGoogleLogin({
    scope: DRIVE_SCOPE,
    onSuccess: (tokenResponse) => {
      authService.setAccessToken(tokenResponse.access_token, tokenResponse.expires_in);
      setIsAuthenticated(true);
      setIsSigningIn(false);
      setAuthError(null);
      scheduleRefresh(tokenResponse.expires_in ?? 3600);
    },
    onError: (error) => {
      console.error('Google login error:', error);
      setAuthError('Sign-in failed. Please try again.');
      setIsSigningIn(false);
    },
    onNonOAuthError: (error) => {
      console.error('Non-OAuth error:', error);
      setAuthError('Sign-in was cancelled or blocked.');
      setIsSigningIn(false);
    },
  });

  const signIn = useCallback(() => {
    setIsSigningIn(true);
    setAuthError(null);
    login();
  }, [login]);

  const signOut = useCallback(() => {
    authService.clearAccessToken();
    setIsAuthenticated(false);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  return { isAuthenticated, isSilentTrying, isSigningIn, authError, signIn, signOut };
}
