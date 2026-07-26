/**
 * One-time (well, ~monthly) interactive login for the MCP server.
 *
 * Mirrors exactly what the web app's useAuth.js does: Google Identity
 * Services "auth-code" flow in popup mode, then hand the resulting code to
 * the Worker's /oauth/google/code endpoint, which mints a session cookie.
 * We persist that cookie to disk so the MCP server can act as this
 * "browser" on every future run without a human in the loop.
 *
 * Runs on http://localhost:3000 because that origin is already authorized
 * for the app's Google OAuth client and already whitelisted in the Worker's
 * CORS config — using any other port would likely fail with
 * redirect_uri_mismatch / a CORS rejection. Stop `npm run dev` first if it's
 * using that port.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { API_BASE, GOOGLE_CLIENT_ID, GOOGLE_AUTH_SCOPE, LOGIN_PORT, LOGIN_ORIGIN } from './config.js';
import { saveSession, extractCookiePair } from './session.js';

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Crate MCP — Sign in</title>
<script src="https://accounts.google.com/gsi/client"></script>
<style>
  body { font: 16px system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #111; color: #eee; }
  button { font: inherit; padding: 0.75em 1.5em; border-radius: 8px; border: none; background: #4285f4; color: white; cursor: pointer; }
  button:hover { background: #3367d6; }
  #status { margin-top: 1em; color: #aaa; }
</style>
</head>
<body>
  <div style="text-align:center">
    <button id="btn">Sign in to Crate (Google)</button>
    <div id="status"></div>
  </div>
<script>
  const statusEl = document.getElementById('status');
  const client = google.accounts.oauth2.initCodeClient({
    client_id: ${JSON.stringify(GOOGLE_CLIENT_ID)},
    scope: ${JSON.stringify(GOOGLE_AUTH_SCOPE)},
    ux_mode: 'popup',
    callback: async (resp) => {
      if (resp.error) {
        statusEl.textContent = 'Error: ' + resp.error;
        return;
      }
      statusEl.textContent = 'Finishing sign-in...';
      const res = await fetch('/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: resp.code }),
      });
      if (res.ok) {
        statusEl.textContent = 'Signed in! You can close this tab.';
      } else {
        const data = await res.json().catch(() => ({}));
        statusEl.textContent = 'Failed: ' + (data.error || res.status);
      }
    },
  });
  document.getElementById('btn').addEventListener('click', () => client.requestCode());
</script>
</body>
</html>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function exchangeCodeForSession(code) {
  const res = await fetch(`${API_BASE}/oauth/google/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XmlHttpRequest',
      Origin: LOGIN_ORIGIN,
    },
    body: JSON.stringify({ code }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Worker returned HTTP ${res.status}`);
  }

  const setCookie = res.headers.get('set-cookie');
  const cookie = extractCookiePair(setCookie);
  if (!cookie) throw new Error('Worker did not return a session cookie');

  return { cookie, email: data.email || null };
}

export function runLogin() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(PAGE);
        return;
      }

      if (req.method === 'POST' && req.url === '/complete') {
        try {
          const { code } = JSON.parse(await readBody(req));
          const session = await exchangeCodeForSession(code);
          saveSession({ ...session, savedAt: Date.now() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          console.log(`Signed in as ${session.email || '(unknown email)'}. Session saved.`);
          setTimeout(() => { server.close(); resolve(session); }, 500);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          server.close();
          reject(err);
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${LOGIN_PORT} is already in use — stop \`npm run dev\` (or whatever else is on that port) and try again.`
        ));
      } else {
        reject(err);
      }
    });

    server.listen(LOGIN_PORT, () => {
      console.log(`Open http://localhost:${LOGIN_PORT} in your browser and sign in.`);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLogin().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
