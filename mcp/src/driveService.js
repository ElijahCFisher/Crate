/**
 * Fork of src/services/driveService.js for the Node MCP server.
 * Only the token-service import differs (Node cookie-based vs browser
 * credentials:'include') — keep this in sync with the original by hand if
 * the Drive API surface there changes.
 */
import { getGoogleAccessToken, clearGoogleAccessToken } from './googleTokenService.js';

const DRIVE_API  = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export function isAuthError(err) {
  const msg = err?.message || '';
  return (
    msg === 'Not authenticated' ||
    msg.startsWith('Drive API error 401') ||
    msg.startsWith('Drive write failed 401') ||
    msg.startsWith('Drive API error 403') ||
    msg.startsWith('Drive write failed 403')
  );
}

async function driveFetch(url, options = {}, retry = true) {
  let token;
  try {
    token = await getGoogleAccessToken();
  } catch (err) {
    if (err instanceof TypeError) throw err;
    throw new Error('Not authenticated');
  }

  let res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401 && retry) {
    clearGoogleAccessToken();
    try {
      token = await getGoogleAccessToken({ forceRefresh: true });
    } catch (err) {
      if (err instanceof TypeError) throw err;
      throw new Error('Not authenticated');
    }

    res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return res;
}

async function driveRequest(url, options = {}) {
  const res = await driveFetch(url, options);
  if (!res.ok && res.status !== 412) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && body.includes('insufficientPermissions')) {
      throw new Error('Not authenticated');
    }
    throw new Error(`Drive API error ${res.status}: ${body}`);
  }
  return res;
}

export async function findOrCreateFolder(name) {
  const query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res  = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const createRes = await driveRequest(`${DRIVE_API}/files`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await createRes.json();
  return folder.id;
}

export async function findOrCreateFile(folderId, fileName) {
  const query = `name='${fileName}' and '${folderId}' in parents and trashed=false`;
  const res  = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

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
    method:  'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await createRes.json();
  return file.id;
}

export async function findFileInFolder(folderId, name) {
  const query = `name='${name}' and '${folderId}' in parents and trashed=false`;
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

export async function getUserProfile() {
  const res = await driveFetch('https://www.googleapis.com/oauth2/v3/userinfo');
  if (!res.ok) throw new Error('Failed to fetch user profile');
  return res.json();
}

/**
 * Read file content + version token from Drive.
 * Drive API v3 doesn't expose ETag over CORS, so we use the `version`
 * integer (a strictly-increasing counter) as our concurrency token.
 */
export async function readFile(fileId) {
  const [metaRes, contentRes] = await Promise.all([
    driveRequest(`${DRIVE_API}/files/${fileId}?fields=id,version`),
    driveRequest(`${DRIVE_API}/files/${fileId}?alt=media`),
  ]);
  const meta    = await metaRes.json();
  const content = await contentRes.text();
  return { content, etag: String(meta.version ?? '') };
}

/**
 * Write file content to Drive with version-based concurrency check.
 * Returns { ok: true, etag } on success, { ok: false, status: 412 } on conflict.
 */
export async function writeFile(fileId, content, expectedVersion) {
  if (expectedVersion) {
    const checkRes = await driveRequest(`${DRIVE_API}/files/${fileId}?fields=id,version`);
    const meta     = await checkRes.json();
    if (String(meta.version) !== String(expectedVersion)) {
      return { ok: false, status: 412 };
    }
  }

  const boundary  = 'upload_boundary_xyz';
  const uploadBody = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({ mimeType: 'text/csv' }) + '\r\n',
    `--${boundary}\r\n`,
    'Content-Type: text/csv\r\n\r\n',
    content + '\r\n',
    `--${boundary}--`,
  ].join('');

  const res = await driveFetch(
    `${UPLOAD_API}/files/${fileId}?uploadType=multipart&fields=id,version`,
    {
      method:  'PATCH',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body:    uploadBody,
    }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (res.status === 403 && errBody.includes('insufficientPermissions')) {
      throw new Error('Not authenticated');
    }
    throw new Error(`Drive write failed ${res.status}: ${errBody}`);
  }

  const newMeta = await res.json();
  return { ok: true, etag: String(newMeta.version ?? '') };
}
