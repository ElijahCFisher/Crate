/**
 * Google Sheets storage for the data and changelog — the same rows the CSV
 * files held, one spreadsheet each. A change appends to the changelog and
 * touches only the cells it changed, instead of rewriting two whole files.
 *
 * Shared by the web app and the MCP server: every call goes through the
 * `request(url, options)` the store is created with — each side's authorized
 * Drive fetch, which throws "Drive API error <status>: …" when one fails.
 *
 * The CSV files are never deleted or written here. They're copied in once
 * (`resolveStorage`), and anything written to them afterwards — by an app or
 * MCP server that hasn't switched yet — is picked up with `csvChangesSince`.
 */
import * as csvService from './csvService.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API  = 'https://www.googleapis.com/drive/v3';
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

export const DATA_SHEET_NAME      = 'Food Ratings Data';
export const CHANGELOG_SHEET_NAME = 'Food Ratings Changelog';

// Rows per request when a whole table is written at once — keeps each body to
// a couple of megabytes.
const WRITE_CHUNK_ROWS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A string literal inside a Drive search query. */
function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** A sheet title as A1 notation wants it. */
function a1Title(title) {
  return `'${title.replace(/'/g, "''")}'`;
}

export function columnLetter(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

const text = (value) => (value == null ? '' : String(value));

// Every value goes in as a string, exactly as the CSV held it, so the sheet
// never turns "007" into 7 or a note starting with "=" into a formula. A blank
// cell is left empty rather than holding an empty string.
function cell(value) {
  const s = text(value);
  return s === '' ? {} : { userEnteredValue: { stringValue: s } };
}

function rowObjects({ header, rows }) {
  return rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i]])));
}

export function createSheetStore(rawRequest) {
  async function request(url, options) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await rawRequest(url, options);
      } catch (err) {
        // Rate limited or briefly unavailable: nothing was applied, so the
        // same request is safe to send again.
        if (attempt >= 4 || !/^Drive API error (429|503)\b/.test(err?.message || '')) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  const getJson = async (url) => (await request(url)).json();
  const sendJson = async (method, url, body) => (await request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json();

  // ── Spreadsheet basics ──────────────────────────────────────────────────────

  // Each spreadsheet's first tab, looked up once. Dropped on any failure, so a
  // tab renamed while the app is open is found again on the next try.
  const firstSheets = new Map();

  function firstSheet(spreadsheetId) {
    if (!firstSheets.has(spreadsheetId)) {
      const lookup = getJson(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties(sheetId,title,index)`)
        .then(({ sheets = [] }) => {
          // The API leaves out fields that are zero, and the first tab's id
          // and index usually are.
          const tabs = sheets.map(({ properties: p }) => ({ sheetId: p.sheetId ?? 0, index: p.index ?? 0, title: p.title }));
          tabs.sort((a, b) => a.index - b.index);
          if (!tabs.length) throw new Error('Spreadsheet has no sheets.');
          return tabs[0];
        });
      lookup.catch(() => firstSheets.delete(spreadsheetId));
      firstSheets.set(spreadsheetId, lookup);
    }
    return firstSheets.get(spreadsheetId);
  }

  async function withSheet(spreadsheetId, fn) {
    try {
      return await fn(await firstSheet(spreadsheetId));
    } catch (err) {
      firstSheets.delete(spreadsheetId);
      throw err;
    }
  }

  async function batchUpdate(spreadsheetId, requests) {
    if (!requests.length) return;
    await sendJson('POST', `${SHEETS_API}/${spreadsheetId}:batchUpdate`, { requests });
  }

  /** The first tab as { sheet, header, rows }, every value a string. */
  function readTable(spreadsheetId) {
    return withSheet(spreadsheetId, async (sheet) => {
      const range = encodeURIComponent(a1Title(sheet.title));
      const { values = [] } = await getJson(
        `${SHEETS_API}/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`
      );
      const header = (values[0] || []).map(text);
      const rows = values.slice(1).map((row) => header.map((_, i) => text(row[i])));
      return { sheet, header, rows };
    });
  }

  /**
   * The header with any of `fields` it lacks added at the end, plus the
   * requests that add them — for a column added to the schema after the
   * sheet was made. Columns are always found by header name, so ones you add
   * or move by hand in the sheet are left alone.
   */
  function extendHeader(table, fields) {
    const missing = fields.filter((f) => !table.header.includes(f));
    if (!missing.length) return { header: table.header, requests: [] };
    const { sheetId } = table.sheet;
    const start = table.header.length;
    return {
      header: [...table.header, ...missing],
      requests: [
        { appendDimension: { sheetId, dimension: 'COLUMNS', length: missing.length } },
        {
          updateCells: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: start, endColumnIndex: start + missing.length },
            rows: [{ values: missing.map(cell) }],
            fields: 'userEnteredValue',
          },
        },
      ],
    };
  }

  /** Replace a whole tab with `fields` as the header and `rows` under it. */
  function writeTable(spreadsheetId, fields, rows) {
    return withSheet(spreadsheetId, async (sheet) => {
      const title = a1Title(sheet.title);
      await sendJson('POST', `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(title)}:clear`, {});
      await batchUpdate(spreadsheetId, [{
        updateSheetProperties: {
          properties: {
            sheetId: sheet.sheetId,
            // A frozen header needs at least one row under it.
            gridProperties: { rowCount: Math.max(rows.length + 1, 2), columnCount: fields.length, frozenRowCount: 1 },
          },
          fields: 'gridProperties(rowCount,columnCount,frozenRowCount)',
        },
      }]);
      const values = [fields, ...rows.map((row) => fields.map((f) => text(row[f])))];
      for (let start = 0; start < values.length; start += WRITE_CHUNK_ROWS) {
        await sendJson('POST', `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`, {
          valueInputOption: 'RAW',
          data: [{ range: `${title}!A${start + 1}`, values: values.slice(start, start + WRITE_CHUNK_ROWS) }],
        });
      }
    });
  }

  // ── Data + changelog ────────────────────────────────────────────────────────

  async function readData({ combinedFileId, changelogFileId }) {
    const [dataTable, logTable] = await Promise.all([readTable(combinedFileId), readTable(changelogFileId)]);
    const combined = new Map();
    for (const row of rowObjects(dataTable)) {
      const entry = csvService.rowToEntry(row);
      if (entry.uuid) combined.set(entry.uuid, entry);
    }
    const changelog = [];
    for (const row of rowObjects(logTable)) {
      const change = csvService.rowToChange(row);
      if (change.changeUuid) changelog.push(change);
    }
    return { data: { combined, changelog }, dataTable, logTable };
  }

  async function readCombined(spreadsheetId) {
    const combined = new Map();
    for (const row of rowObjects(await readTable(spreadsheetId))) {
      const entry = csvService.rowToEntry(row);
      if (entry.uuid) combined.set(entry.uuid, entry);
    }
    return combined;
  }

  async function appendChanges(spreadsheetId, logTable, changes) {
    if (!changes.length) return;
    const { header, requests } = extendHeader(logTable, csvService.CHANGELOG_FIELDS);
    const rows = changes.map((change) => {
      const row = csvService.changeToRow(change);
      return { values: header.map((name) => cell(row[name])) };
    });
    requests.push({ appendCells: { sheetId: logTable.sheet.sheetId, rows, fields: 'userEnteredValue' } });
    await batchUpdate(spreadsheetId, requests);
  }

  /** uuid → the grid rows (0 is the header) holding it, read fresh. */
  async function uuidRows(spreadsheetId, sheet, column) {
    const letter = columnLetter(column);
    const range = encodeURIComponent(`${a1Title(sheet.title)}!${letter}2:${letter}`);
    const { values = [] } = await getJson(
      `${SHEETS_API}/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`
    );
    const positions = new Map();
    values.forEach((row, i) => {
      const uuid = text(row?.[0]);
      if (!uuid) return;
      if (!positions.has(uuid)) positions.set(uuid, []);
      positions.get(uuid).push(i + 1);
    });
    return positions;
  }

  /**
   * Write the difference between `before` (uuid → row as read) and `combined`
   * (entries after the change): changed cells are updated one by one, new
   * entries appended, removed ones' rows deleted. Rows are located by UUID
   * just before writing, so rows another device added or deleted in the
   * meantime don't send an edit to the wrong row.
   */
  async function writeEntries(spreadsheetId, dataTable, before, combined) {
    const fields = csvService.COMBINED_FIELDS;
    const edits = [];
    for (const [uuid, entry] of combined) {
      const row = csvService.entryToRow(entry);
      const prev = before.get(uuid);
      const changed = prev ? fields.filter((f) => text(prev[f]) !== text(row[f])) : fields;
      if (changed.length) edits.push({ uuid, row, changed, isNew: !prev });
    }
    const removed = [...before.keys()].filter((uuid) => !combined.has(uuid));
    if (!edits.length && !removed.length) return;

    const { header, requests } = extendHeader(dataTable, fields);
    const { sheet } = dataTable;
    const positions = await uuidRows(spreadsheetId, sheet, header.indexOf('UUID'));

    const appended = [];
    for (const { uuid, row, changed, isNew } of edits) {
      const at = positions.get(uuid);
      if (!at) {
        // Not in the sheet. A new entry goes in; an edit to one that another
        // device deleted since it was read doesn't bring it back.
        if (isNew) appended.push({ values: header.map((name) => cell(row[name])) });
        continue;
      }
      for (const r of at) {
        for (const field of changed) {
          const c = header.indexOf(field);
          requests.push({
            updateCells: {
              range: { sheetId: sheet.sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 },
              rows: [{ values: [cell(row[field])] }],
              fields: 'userEnteredValue',
            },
          });
        }
      }
    }
    if (appended.length) {
      requests.push({ appendCells: { sheetId: sheet.sheetId, rows: appended, fields: 'userEnteredValue' } });
    }
    // Last, and bottom-up, so no deletion moves a row an earlier request
    // in this batch pointed at.
    const doomed = removed.flatMap((uuid) => positions.get(uuid) || []).sort((a, b) => b - a);
    for (const r of doomed) {
      requests.push({ deleteDimension: { range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 } } });
    }
    await batchUpdate(spreadsheetId, requests);
  }

  /**
   * The Sheets counterpart of dataService's read → apply → write loop. Same
   * contract: `changes` join the changelog, `applyFn(data)` updates
   * data.combined (and may add more changes), and { data, ...extra } comes
   * back. Changes whose UUID is already logged aren't logged twice.
   */
  async function applyChanges(fileIds, changes, applyFn) {
    const { data, dataTable, logTable } = await readData(fileIds);
    const logged = new Set(data.changelog.map((c) => c.changeUuid));
    const baseLength = data.changelog.length;
    for (const change of changes) {
      if (!logged.has(change.changeUuid)) data.changelog.push(change);
    }
    const before = new Map();
    for (const [uuid, entry] of data.combined) before.set(uuid, csvService.entryToRow(entry));

    const extra = applyFn(data) ?? {};

    const newChanges = data.changelog.slice(baseLength).filter((c) => !logged.has(c.changeUuid));
    await Promise.all([
      appendChanges(fileIds.changelogFileId, logTable, newChanges),
      writeEntries(fileIds.combinedFileId, dataTable, before, data.combined),
    ]);
    return { data, ...extra };
  }

  /** Overwrite both sheets with `data` — for the first copy, and seeding from a device's cache. */
  async function replaceData({ combinedFileId, changelogFileId }, data) {
    await writeTable(changelogFileId, csvService.CHANGELOG_FIELDS, data.changelog.map(csvService.changeToRow));
    await writeTable(combinedFileId, csvService.COMBINED_FIELDS, Array.from(data.combined.values()).map(csvService.entryToRow));
  }

  // ── Finding (or making) the sheets ──────────────────────────────────────────

  async function findCrateSheet(folderId, kind) {
    const query = `${quote(folderId)} in parents and mimeType=${quote(SPREADSHEET_MIME)} and trashed=false`
      + ` and properties has { key='crate' and value=${quote(kind)} }`;
    const { files = [] } = await getJson(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&orderBy=createdTime&fields=files(id,properties)&spaces=drive`
    );
    return files[0] ?? null;
  }

  async function createCrateSheet(folderId, name, kind) {
    // Made through the Sheets API rather than Drive: if that API isn't
    // enabled this fails before anything exists, instead of leaving an empty
    // spreadsheet behind on every load.
    const { spreadsheetId } = await sendJson('POST', SHEETS_API, { properties: { title: name } });
    const { parents = [] } = await getJson(`${DRIVE_API}/files/${spreadsheetId}?fields=parents`);
    await sendJson(
      'PATCH',
      `${DRIVE_API}/files/${spreadsheetId}?addParents=${folderId}&removeParents=${parents.join(',')}&fields=id`,
      { properties: { crate: kind } },
    );
    // Two devices copying at the same moment each make one; both then settle
    // on the oldest.
    return (await findCrateSheet(folderId, kind)) ?? { id: spreadsheetId, properties: { crate: kind } };
  }

  async function findFile(folderId, name) {
    const query = `name=${quote(name)} and ${quote(folderId)} in parents and trashed=false`;
    const { files = [] } = await getJson(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`
    );
    return files[0]?.id ?? null;
  }

  async function readCsv(fileId) {
    if (!fileId) return { content: '', version: '' };
    const [{ version }, content] = await Promise.all([
      getJson(`${DRIVE_API}/files/${fileId}?fields=version`),
      request(`${DRIVE_API}/files/${fileId}?alt=media`).then((res) => res.text()),
    ]);
    return { content, version: text(version) };
  }

  async function setProperties(fileId, properties) {
    await sendJson('PATCH', `${DRIVE_API}/files/${fileId}?fields=id`, { properties });
  }

  function sheetsStorage(dataSheet, logSheet, csvChangelogVersion) {
    return {
      backend: 'sheets',
      combinedFileId: dataSheet.id,
      changelogFileId: logSheet.id,
      csvChangelogVersion,
    };
  }

  async function migrate(folderId, csvNames, foundData, foundLog) {
    const [dataSheet, logSheet] = await Promise.all([
      foundData ?? createCrateSheet(folderId, DATA_SHEET_NAME, 'data'),
      foundLog ?? createCrateSheet(folderId, CHANGELOG_SHEET_NAME, 'changelog'),
    ]);
    const [csvDataId, csvLogId] = await Promise.all([
      findFile(folderId, csvNames.data),
      findFile(folderId, csvNames.changelog),
    ]);
    const [csvData, csvLog] = await Promise.all([readCsv(csvDataId), readCsv(csvLogId)]);
    // Older still: one file holding both sections.
    const data = csvData.content.includes('SECTION,COMBINED')
      ? csvService.parse(csvData.content)
      : { combined: csvService.parseCombined(csvData.content), changelog: csvService.parseChangelog(csvLog.content) };

    const storage = sheetsStorage(dataSheet, logSheet, csvLog.version);
    await replaceData(storage, data);
    // Marked last, so a copy cut short is simply redone on the next load.
    await setProperties(dataSheet.id, { migrated: 'true', csvChangelogVersion: csvLog.version });
    return storage;
  }

  /**
   * Where the data lives: the two crate sheets in `folderId`, copied from the
   * CSV files first if that hasn't happened yet. Null when the copy can't be
   * made (say the Sheets API isn't enabled) — the caller stays on the CSVs and
   * it's tried again next time. Once the sheets exist and are marked copied
   * they're always used; failing to reach them is an ordinary error then, not
   * a reason to go back to the CSVs.
   *
   * Calls made while one is still running share it — React runs the app's
   * load twice at once in development, and two copies at once would each make
   * their own pair of sheets.
   */
  const resolving = new Map();
  function resolveStorage(folderId, csvNames) {
    if (!resolving.has(folderId)) {
      const pending = findOrMigrate(folderId, csvNames).finally(() => resolving.delete(folderId));
      resolving.set(folderId, pending);
    }
    // Each caller gets its own copy: markCsvRead updates the one it's given.
    return resolving.get(folderId).then((storage) => storage && { ...storage });
  }

  async function findOrMigrate(folderId, csvNames) {
    const [dataSheet, logSheet] = await Promise.all([
      findCrateSheet(folderId, 'data'),
      findCrateSheet(folderId, 'changelog'),
    ]);
    if (dataSheet?.properties?.migrated === 'true' && logSheet) {
      return sheetsStorage(dataSheet, logSheet, dataSheet.properties.csvChangelogVersion ?? '');
    }
    try {
      return await migrate(folderId, csvNames, dataSheet, logSheet);
    } catch (err) {
      console.warn('Staying on the CSV files; copying them to Google Sheets failed:', err);
      return null;
    }
  }

  /**
   * Whatever is in the changelog CSV, if it changed since it was last read
   * into the sheets — something still on the old files wrote to it. Null
   * when it hasn't.
   */
  async function csvChangesSince(storage, folderId, csvChangelogName) {
    const fileId = await findFile(folderId, csvChangelogName);
    if (!fileId) return null;
    const { version } = await getJson(`${DRIVE_API}/files/${fileId}?fields=version`);
    if (text(version) === text(storage.csvChangelogVersion)) return null;
    const csv = await readCsv(fileId);
    return { changes: csvService.parseChangelog(csv.content), version: csv.version };
  }

  async function markCsvRead(storage, version) {
    await setProperties(storage.combinedFileId, { csvChangelogVersion: version });
    storage.csvChangelogVersion = version;
  }

  // ── Friends ─────────────────────────────────────────────────────────────────

  /** A friend's copied data sheet that's been shared with you, if there is one. */
  async function findSharedDataSheet(ownerEmail) {
    const query = `sharedWithMe=true and trashed=false and mimeType=${quote(SPREADSHEET_MIME)}`
      + ` and properties has { key='crate' and value='data' }`
      + ` and properties has { key='migrated' and value='true' }`
      + ` and ${quote(ownerEmail)} in owners`;
    const { files = [] } = await getJson(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&orderBy=createdTime&fields=files(id)&spaces=drive`
    );
    return files[0]?.id ?? null;
  }

  async function isSpreadsheet(fileId) {
    const { mimeType } = await getJson(`${DRIVE_API}/files/${fileId}?fields=mimeType`);
    return mimeType === SPREADSHEET_MIME;
  }

  return {
    readData,
    readCombined,
    applyChanges,
    replaceData,
    resolveStorage,
    csvChangesSince,
    markCsvRead,
    findSharedDataSheet,
    isSpreadsheet,
  };
}
