/**
 * Manages the Google OAuth access token.
 * Called by useAuth when GIS returns a token.
 * Token is persisted to localStorage so page reloads don't require re-login.
 * Tokens expire after ~1 hour; the user will be prompted again once expired.
 */

const STORAGE_KEY = 'food_ratings_auth_v1';

let _accessToken = null;
let _tokenExpiry = 0;

// Restore on module load so isTokenValid() works immediately
(function restoreFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { token, expiry } = JSON.parse(stored);
      if (token && expiry && Date.now() < expiry) {
        _accessToken = token;
        _tokenExpiry = expiry;
      }
    }
  } catch {
    // Ignore parse errors
  }
})();

export function setAccessToken(token, expiresIn = 3600) {
  _accessToken = token;
  _tokenExpiry = Date.now() + (expiresIn - 60) * 1000; // 60s buffer
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: _accessToken, expiry: _tokenExpiry }));
  } catch {
    // Ignore storage errors (e.g. private browsing quota)
  }
}

export function clearAccessToken() {
  _accessToken = null;
  _tokenExpiry = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry) {
    return _accessToken;
  }
  return null;
}

export function isTokenValid() {
  return !!getAccessToken();
}

/** Returns the absolute ms timestamp when the current token expires (0 if none). */
export function getTokenExpiry() {
  return _tokenExpiry;
}
