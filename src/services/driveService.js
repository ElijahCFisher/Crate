import { getGoogleAccessToken, clearGoogleAccessToken } from './googleTokenService';

const DRIVE_API  = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Returns true if the error represents an authentication failure:
 *   - 'Not authenticated'  — token fetch from Worker failed (session expired)
 *   - 'Drive API error 401' — Drive rejected the token
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

/**
 * Fetch wrapper that adds a Bearer token from the Worker.
 * On 401 it clears the cached token and retries once with a forced refresh.
 */
async function driveFetch(url, options = {}, retry = true) {
  let token;
  try {
    token = await getGoogleAccessToken();
  } catch (err) {
    // Preserve TypeErrors (network failures) so callers can distinguish
    // "device is offline" from "session expired". Wrapping a TypeError as a
    // plain Error here would cause isNetworkError() to return false, silently
    // dropping queued offline operations instead of re-trying them later.
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
    method:  'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await createRes.json();
  return file.id;
}

export async function findOrCreateJsonFile(folderId, fileName, defaultContent = '{}') {
  const query = `name='${fileName}' and '${folderId}' in parents and trashed=false`;
  const res  = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const boundary = 'init_boundary_json';
  const metadata = { name: fileName, parents: [folderId], mimeType: 'application/json' };
  const body = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata) + '\r\n',
    `--${boundary}\r\n`,
    'Content-Type: application/json\r\n\r\n',
    defaultContent + '\r\n',
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

export async function getUserProfile() {
  const res = await driveFetch('https://www.googleapis.com/oauth2/v3/userinfo');
  if (!res.ok) throw new Error('Failed to fetch user profile');
  return res.json(); // { email, name, picture, sub, ... }
}

export async function shareFile(fileId, email) {
  const res = await driveRequest(
    `${DRIVE_API}/files/${fileId}/permissions?sendNotificationEmail=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email }),
    }
  );
  return res.json();
}

export async function listSharedFoodRatingFiles(fileName) {
  const q = `name='${fileName}' and sharedWithMe=true and trashed=false`;
  const res = await driveRequest(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,sharingUser)&spaces=drive`
  );
  const data = await res.json();
  return data.files || [];
}

export async function writeJsonFile(fileId, jsonString) {
  const boundary = 'upload_boundary_json';
  const uploadBody = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify({ mimeType: 'application/json' }) + '\r\n',
    `--${boundary}\r\n`,
    'Content-Type: application/json\r\n\r\n',
    jsonString + '\r\n',
    `--${boundary}--`,
  ].join('');

  const res = await driveFetch(
    `${UPLOAD_API}/files/${fileId}?uploadType=multipart`,
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
}

/**
 * Read file content + version token from Drive.
 * Returns { content: string, etag: string }.
 *
 * Drive API v3 doesn't expose ETag over CORS, so we use the `version` integer
 * (a strictly-increasing counter) as our concurrency token.
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
  // Pre-write version check (replicates If-Match / 412 behaviour)
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
