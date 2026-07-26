/**
 * Node equivalent of src/services/googleTokenService.js.
 *
 * The browser version relies on `credentials: 'include'` to send its HttpOnly
 * session cookie automatically. Node's fetch has no cookie jar, so we persist
 * the cookie to disk (session.js) and attach it explicitly, along with the
 * Origin header the Worker's CORS/session checks require.
 */
import { API_BASE, LOGIN_ORIGIN } from './config.js';
import { loadSession } from './session.js';

let accessToken = null;
let expiresAt = 0;
let inflight = null;

function isUsable() {
  return !!accessToken && Date.now() < expiresAt - 60_000;
}

export function clearGoogleAccessToken() {
  accessToken = null;
  expiresAt = 0;
  inflight = null;
}

export async function getGoogleAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && isUsable()) return accessToken;
  if (!forceRefresh && inflight) return inflight;

  const session = loadSession();
  if (!session?.cookie) {
    throw new Error('Not authenticated. Run `npm run login` in the mcp/ folder first.');
  }

  inflight = fetch(`${API_BASE}/api/google/access-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: LOGIN_ORIGIN,
      Cookie: session.cookie,
    },
  })
    .then(async (res) => {
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        clearGoogleAccessToken();
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      accessToken = data.accessToken;
      expiresAt = data.expiresAt || 0;
      return accessToken;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
