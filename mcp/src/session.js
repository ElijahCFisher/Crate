import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { SESSION_FILE } from './config.js';

/** { cookie: "__Host-crate_session=...", email: "...", savedAt: 1234 } */
export function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function saveSession(session) {
  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
  try { chmodSync(SESSION_FILE, 0o600); } catch { /* best-effort on non-POSIX filesystems */ }
}

/** Pulls just the "name=value" pair out of a Set-Cookie header (drops attrs). */
export function extractCookiePair(setCookieHeader) {
  if (!setCookieHeader) return null;
  return setCookieHeader.split(';')[0].trim();
}
