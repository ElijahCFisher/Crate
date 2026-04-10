import { getAccessToken } from './authService';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Returns true if the error represents an authentication failure:
 *   - 'Not authenticated'  — token was null when the request was made
 *   - 'Drive API error 401' — Drive rejected the token (expired / revoked)
 *   - 'Drive write failed 401' — same but from the write path
 */
export function isAuthError(err) {
  const msg = err?.message || '';
  return (
    msg === 'Not authenticated' ||
    msg.startsWith('Drive API error 401') ||
    msg.startsWith('Drive write failed 401')
  );
}

function authHeader() {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}` };
}

async function driveRequest(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeader(), ...(options.headers || {}) },
  });
  if (!res.ok && res.status !== 412) {
    const body = await res.text().catch(() => '');
    throw new Error(`Drive API error ${res.status}: ${body}`);
  }
  return res;
}

export async function findOrCreateFolder(name) {
  const query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const createRes = await driveRequest(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await createRes.json();
  return folder.id;
}

export async function findOrCreateFile(folderId, fileName) {
  const query = `name='${fileName}' and '${folderId}' in parents and trashed=false`;
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  // Create empty CSV file via multipart upload
  const boundary = 'init_boundary_xyz';
  const metadata = { name: fileName, parents: [folderId], mimeType: 'text/csv' };
  const body = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata) + '\r\n',
    `--${boundary}\r\n`,
    'Content-Type: text/csv\r\n\r\n',
    '\r\n',
    `--${boundary}--`,
  ].join('');

  const createRes = await driveRequest(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await createRes.json();
  return file.id;
}

/**
 * Read file content + version token from Drive.
 * Returns { content: string, etag: string }.
 *
 * Note: Drive API v3 removed the `etag` field. We use the `version` integer
 * (a strictly-increasing counter) as our concurrency token. The `If-Match`
 * HTTP header is also not accessible via CORS in browser fetch, so we do a
 * pre-write version check instead — same semantics, tiny race window.
 */
export async function readFile(fileId) {
  // Fetch metadata and content in parallel
  const [metaRes, contentRes] = await Promise.all([
    driveRequest(`${DRIVE_API}/files/${fileId}?fields=id,version`),
    driveRequest(`${DRIVE_API}/files/${fileId}?alt=media`),
  ]);
  const meta = await metaRes.json();
  const content = await contentRes.text();

  return { content, etag: String(meta.version ?? '') };
}

/**
 * Write file content to Drive with version-based concurrency check.
 * Returns { ok: true, etag } on success, { ok: false, status: 412 } on conflict.
 */
export async function writeFile(fileId, content, expectedVersion) {
  // Pre-write version check (replicates If-Match / 412 behaviour)
  if (expectedVersion) {
    const checkRes = await driveRequest(`${DRIVE_API}/files/${fileId}?fields=id,version`);
    const meta = await checkRes.json();
    if (String(meta.version) !== String(expectedVersion)) {
      return { ok: false, status: 412 };
    }
  }

  const boundary = 'upload_boundary_xyz';
  const uploadBody = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({ mimeType: 'text/csv' }) + '\r\n',
    `--${boundary}\r\n`,
    'Content-Type: text/csv\r\n\r\n',
    content + '\r\n',
    `--${boundary}--`,
  ].join('');

  const res = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=multipart&fields=id,version`, {
    method: 'PATCH',
    headers: {
      ...authHeader(),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: uploadBody,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Drive write failed ${res.status}: ${errBody}`);
  }

  const newMeta = await res.json();
  return { ok: true, etag: String(newMeta.version ?? '') };
}
