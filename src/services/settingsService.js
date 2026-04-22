import { findOrCreateJsonFile, readFile, writeJsonFile } from './driveService';
import { SETTINGS_FILE_NAME } from '../config';

const DEFAULT_SETTINGS = {
  bulkAdds: [],
  following: [],         // [{ email, displayName, fileId }]
  requestedToFollow: [], // [{ email, displayName }]
  sharedWith: [],        // [{ email, displayName }]
};

export async function getOrCreateSettingsFile(folderId) {
  return findOrCreateJsonFile(folderId, SETTINGS_FILE_NAME, JSON.stringify(DEFAULT_SETTINGS));
}

export async function readSettings(fileId) {
  const { content } = await readFile(fileId);
  if (!content || content.trim() === '') return { ...DEFAULT_SETTINGS };
  try {
    return JSON.parse(content);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(fileId, settings) {
  await writeJsonFile(fileId, JSON.stringify(settings));
}
