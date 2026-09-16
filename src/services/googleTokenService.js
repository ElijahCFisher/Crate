/**
 * In-memory Google Drive access token cache.
 *
 * The token itself never touches localStorage or a cookie — it lives only in
 * this module's closure for the lifetime of the page.  When a new token is
 * needed the Worker's /api/google/access-token endpoint is called; the Worker
 * uses the HttpOnly session cookie to verify identity and refreshes the Google
 * token via its stored refresh token if required.
 */

import { API_BASE } from '../config';

let accessToken = null;
let expiresAt   = 0;
let inflight    = null;   // deduplicates concurrent refresh calls
let lastError   = null;   // why the last refresh failed, for the UI to report

/**
 * What the Worker said the last time it couldn't mint an access token.
 * `invalid_grant` means Google threw the refresh token away — which is what
 * happens every 7 days while an OAuth app is still in Testing, and what being
 * asked to sign in again keeps meaning.
 */
export function getLastTokenError() {
  return lastError;
}

function isUsable() {
  return !!accessToken && Date.now() < expiresAt - 60_000; // 60 s buffer
}

/** Drop the cached token (e.g. on 401 from Drive or on sign-out). */
export function clearGoogleAccessToken() {
  accessToken = null;
  expiresAt   = 0;
  inflight    = null;
}

/**
 * Return a valid Google access token.
 * Fetches a fresh one from the Worker if the cached token is expired or
 * `forceRefresh` is true. Concurrent callers share a single in-flight request.
 */
export async function getGoogleAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && isUsable()) return accessToken;
  if (!forceRefresh && inflight)   return inflight;

  inflight = fetch(`${API_BASE}/api/google/access-token`, {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
  })
    .then(async (res) => {
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        clearGoogleAccessToken();
        lastError = data?.error ? `${data.error} (HTTP ${res.status})` : `HTTP ${res.status}`;
        console.warn('[auth] the Worker could not mint a Google access token:', lastError);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      accessToken = data.accessToken;
      expiresAt   = data.expiresAt || 0;
      lastError   = null;
      return accessToken;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
