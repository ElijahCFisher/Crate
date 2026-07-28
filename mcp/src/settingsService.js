/**
 * Fork of src/services/settingsService.js for the Node MCP server — only the
 * driveService import differs (local Node fork vs browser one), otherwise
 * identical.
 */
import { findOrCreateJsonFile, readFile, writeJsonFile } from './driveService.js';
import { SETTINGS_FILE_NAME } from './config.js';

const DEFAULT_SETTINGS = {
  bulkAdds: [],
  following: [],
  requestedToFollow: [],
  sharedWith: [],
  showAdvancedByDefault: false,
  notes: '',
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
