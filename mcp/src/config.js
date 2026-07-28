import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

/** Minimal KEY=VALUE .env parser — no need for a dotenv dependency. */
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

// Reuse the same client ID / API base as the web app so the MCP server talks
// to the exact same Worker + Google OAuth client (single source of truth).
const rootEnv = loadEnvFile(path.join(REPO_ROOT, '.env'));

export const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID || rootEnv.VITE_GOOGLE_CLIENT_ID;
export const API_BASE = process.env.VITE_API_BASE || rootEnv.VITE_API_BASE;
export const GOOGLE_AUTH_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive';

// Must be an origin already authorized for GOOGLE_CLIENT_ID and whitelisted
// in the Worker's FRONTEND_ORIGINS — http://localhost:3000 is the app's own
// local-dev origin, so it's already both. Stop `npm run dev` before logging in.
export const LOGIN_PORT = Number(process.env.CRATE_MCP_LOGIN_PORT) || 3000;
export const LOGIN_ORIGIN = `http://localhost:${LOGIN_PORT}`;

export const DRIVE_FOLDER_NAME = 'Food Ratings';
export const DRIVE_FILE_NAME = 'food-ratings-data.csv';
export const DRIVE_CHANGELOG_FILE_NAME = 'food-ratings-changelog.csv';
export const SETTINGS_FILE_NAME = 'SettingsEtc.json';

export const SESSION_FILE = path.join(os.homedir(), '.crate-mcp', 'session.json');

if (!GOOGLE_CLIENT_ID || !API_BASE) {
  throw new Error(
    `Missing Google client ID / API base. Set VITE_GOOGLE_CLIENT_ID and VITE_API_BASE in ${path.join(REPO_ROOT, '.env')} or as env vars.`
  );
}
