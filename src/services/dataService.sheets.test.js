import { describe, expect, it, vi, beforeEach } from 'vitest';

// An in-memory Google: Drive files (CSV text or a one-tab spreadsheet) behind
// the same REST URLs the Sheets store calls. Only what the store uses is
// modelled, but cells, row deletion and appending behave like the real thing.
const google = vi.hoisted(() => {
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const SPREADSHEET = 'application/vnd.google-apps.spreadsheet';

  const state = { files: new Map(), nextId: 1, sheetsDisabled: false, onColumnRead: null };

  function reset() {
    state.files.clear();
    state.nextId = 1;
    state.sheetsDisabled = false;
    state.onColumnRead = null;
  }

  function addCsv(id, name, content, extra = {}) {
    state.files.set(id, { id, name, mimeType: 'text/csv', parents: ['folder'], content, version: 1, properties: {}, owners: ['me@x.com'], ...extra });
  }

  function respond(body) {
    return { ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  }

  const fail = (status, msg = '') => { throw new Error(`Drive API error ${status}: ${msg}`); };

  // Proto3 JSON: zeros are left out, as the real API does.
  const omitZero = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0));

  function lastDataRow(rows) {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].some((c) => c !== '')) return i;
    return -1;
  }

  function trimmed(rows) {
    return rows.slice(0, lastDataRow(rows) + 1).map((r) => {
      let end = r.length;
      while (end > 0 && r[end - 1] === '') end--;
      return r.slice(0, end);
    });
  }

  function setCell(rows, r, c, cell) {
    while (rows.length <= r) rows.push([]);
    while (rows[r].length <= c) rows[r].push('');
    rows[r][c] = cell?.userEnteredValue?.stringValue ?? '';
  }

  function matches(file, query) {
    if (/trashed=false/.test(query) && file.trashed) return false;
    const parent = query.match(/'([^']+)' in parents/);
    if (parent && !file.parents.includes(parent[1])) return false;
    const name = query.match(/name='([^']+)'/);
    if (name && !/ or properties/.test(query) && file.name !== name[1]) return false;
    const mime = query.match(/mimeType='([^']+)'/);
    if (mime && file.mimeType !== mime[1]) return false;
    for (const [, key, value] of query.matchAll(/properties has \{ key='(\w+)' and value='([^']+)' \}/g)) {
      if (name && / or properties/.test(query)) continue;
      if (file.properties[key] !== value) return false;
    }
    if (/sharedWithMe=true/.test(query) && !file.sharedWithMe) return false;
    const owner = query.match(/'([^']+)' in owners/);
    if (owner && !file.owners.includes(owner[1])) return false;
    return true;
  }

  function batchUpdate(file, requests) {
    const rows = file.rows;
    for (const req of requests) {
      if (req.updateCells) {
        const { range, rows: data } = req.updateCells;
        data.forEach((row, i) => row.values.forEach((cell, j) =>
          setCell(rows, range.startRowIndex + i, range.startColumnIndex + j, cell)));
      } else if (req.appendCells) {
        let at = lastDataRow(rows) + 1;
        for (const row of req.appendCells.rows) {
          row.values.forEach((cell, j) => setCell(rows, at, j, cell));
          at++;
        }
      } else if (req.deleteDimension) {
        const { startIndex, endIndex } = req.deleteDimension.range;
        rows.splice(startIndex, endIndex - startIndex);
      } else if (!req.appendDimension && !req.updateSheetProperties) {
        throw new Error(`fake: unsupported request ${Object.keys(req)}`);
      }
    }
    file.version++;
  }

  async function request(url, options = {}) {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const u = new URL(url);

    if (url.startsWith(SHEETS)) {
      if (state.sheetsDisabled) fail(403, 'SERVICE_DISABLED');
      const path = decodeURIComponent(u.pathname.replace('/v4/spreadsheets', ''));
      if (path === '' && method === 'POST') {
        const id = `sheet-${state.nextId++}`;
        state.files.set(id, { id, name: body.properties.title, mimeType: SPREADSHEET, parents: ['root'], title: 'Sheet1', rows: [], version: 1, properties: {}, owners: ['me@x.com'] });
        return respond({ spreadsheetId: id });
      }
      const [, id, rest = ''] = path.match(/^\/([^/:]+)(.*)$/);
      const file = state.files.get(id);
      if (!file?.rows) fail(404);
      if (rest === '' && method === 'GET') {
        return respond({ sheets: [{ properties: omitZero({ sheetId: 0, title: file.title, index: 0 }) }] });
      }
      if (rest === ':batchUpdate') { batchUpdate(file, body.requests); return respond({}); }
      if (rest === '/values:batchUpdate') {
        for (const { range, values } of body.data) {
          const start = Number(range.match(/!A(\d+)$/)[1]) - 1;
          values.forEach((row, i) => row.forEach((v, j) => setCell(file.rows, start + i, j, v === '' ? {} : { userEnteredValue: { stringValue: v } })));
        }
        file.version++;
        return respond({});
      }
      const values = rest.match(/^\/values\/'(.*)'(!([A-Z]+)2:\3)?(:clear)?$/);
      if (values) {
        if (values[4]) { file.rows = []; file.version++; return respond({}); }
        if (values[3]) {
          state.onColumnRead?.(file);
          const col = values[3].charCodeAt(0) - 65;
          return respond({ values: trimmed(file.rows).slice(1).map((r) => (r[col] ? [r[col]] : [])) });
        }
        return respond({ values: trimmed(file.rows) });
      }
      throw new Error(`fake: unhandled sheets call ${method} ${path}`);
    }

    if (url.startsWith(DRIVE)) {
      const path = u.pathname.replace('/drive/v3/files', '');
      if (path === '' && method === 'GET') {
        const query = u.searchParams.get('q');
        const files = [...state.files.values()].filter((f) => matches(f, query));
        return respond({ files: files.map((f) => ({ id: f.id, properties: f.properties })) });
      }
      const id = path.slice(1);
      const file = state.files.get(id);
      if (!file) fail(404);
      if (method === 'PATCH') {
        Object.assign(file.properties, body.properties || {});
        const add = u.searchParams.get('addParents');
        if (add) {
          const remove = (u.searchParams.get('removeParents') || '').split(',');
          file.parents = [...file.parents.filter((p) => !remove.includes(p)), add];
        }
        return respond({ id });
      }
      if (u.searchParams.get('alt') === 'media') {
        if (file.rows) fail(403, 'fileNotDownloadable');
        return respond(file.content);
      }
      return respond({ id, version: String(file.version), parents: file.parents, mimeType: file.mimeType });
    }
    throw new Error(`fake: unhandled ${url}`);
  }

  return { state, reset, addCsv, request, SPREADSHEET };
});

vi.mock('./driveService', () => ({
  driveRequest: (url, options) => google.request(url, options),
  readFile: async (fileId) => {
    const f = google.state.files.get(fileId);
    return { content: f?.content ?? '', etag: String(f?.version ?? '') };
  },
  writeFile: async (fileId, content) => {
    const f = google.state.files.get(fileId);
    f.content = content;
    f.version++;
    return { ok: true, etag: String(f.version) };
  },
  findOrCreateFile: async (folderId, name) =>
    [...google.state.files.values()].find((f) => f.name === name)?.id,
}));

const dataService = await import('./dataService');
const csvService = await import('./csvService');

const DATA_CSV = [
  'UUID,Entry Type,Restaurant Name,Specifier,Score,Additional Information',
  'a,food,Pizza Hut,Pasta,7,',
  'b,food,Taco Bell,007,8,"=1+1, fine"',
  'c,food,Wendy\'s,Frosty,6,',
].join('\n');
const LOG_CSV = [
  'Entry UUID,Change UUID,Change Type,Field Name,Value,Date of Change',
  'a,ch-a,addition,,,1',
  'b,ch-b,addition,,,2',
  'c,ch-c,addition,,,3',
].join('\n');

function sheetOf(kind) {
  return [...google.state.files.values()].find((f) => f.properties.crate === kind);
}

function column(file, name) {
  const header = file.rows[0];
  return file.rows.slice(1).map((r) => r[header.indexOf(name)] ?? '');
}

function rowFor(file, uuid) {
  const header = file.rows[0];
  const row = file.rows.find((r) => r[header.indexOf('UUID')] === uuid);
  return row && Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']));
}

beforeEach(() => {
  google.reset();
  google.addCsv('csv-data', 'food-ratings-data.csv', DATA_CSV);
  google.addCsv('csv-log', 'food-ratings-changelog.csv', LOG_CSV);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('moving to Google Sheets', () => {
  it('copies both CSVs into two sheets in the folder and leaves the CSVs alone', async () => {
    const storage = await dataService.openStorage('folder');

    expect(storage.backend).toBe('sheets');
    const data = sheetOf('data');
    const log = sheetOf('changelog');
    expect(data.parents).toEqual(['folder']);
    expect(data.name).toBe('Food Ratings Data');
    expect(log.name).toBe('Food Ratings Changelog');
    expect(storage).toMatchObject({ combinedFileId: data.id, changelogFileId: log.id });
    expect(data.properties.migrated).toBe('true');

    expect(column(data, 'UUID')).toEqual(['a', 'b', 'c']);
    expect(column(log, 'Change UUID')).toEqual(['ch-a', 'ch-b', 'ch-c']);
    expect(google.state.files.get('csv-data').content).toBe(DATA_CSV);
    expect(google.state.files.get('csv-log').content).toBe(LOG_CSV);
  });

  it('makes one pair of sheets when two loads start at once', async () => {
    const [a, b] = await Promise.all([dataService.openStorage('folder'), dataService.openStorage('folder')]);
    expect(a.combinedFileId).toBe(b.combinedFileId);
    expect([...google.state.files.values()].filter((f) => f.rows)).toHaveLength(2);
  });

  it('copies only once', async () => {
    const first = await dataService.openStorage('folder');
    await dataService.modifyEntry(first, 'a', { score: '9' });
    const second = await dataService.openStorage('folder');

    expect(second).toMatchObject({ combinedFileId: first.combinedFileId, changelogFileId: first.changelogFileId });
    expect(rowFor(sheetOf('data'), 'a').Score).toBe('9');
  });

  it('keeps values that look like numbers or formulas exactly as written', async () => {
    const storage = await dataService.openStorage('folder');
    const { combined } = await dataService.readData(storage);
    expect(combined.get('b').specifier).toBe('007');
    expect(combined.get('b').additionalInfo).toBe('=1+1, fine');
  });

  it('stays on the CSVs, and makes nothing, when Sheets is unavailable', async () => {
    google.state.sheetsDisabled = true;
    const storage = await dataService.openStorage('folder');

    expect(storage).toEqual({ backend: 'csv', combinedFileId: 'csv-data', changelogFileId: 'csv-log' });
    expect(sheetOf('data')).toBeUndefined();

    await dataService.modifyEntry(storage, 'a', { score: '9' });
    expect(csvService.parseCombined(google.state.files.get('csv-data').content).get('a').score).toBe('9');
  });

  it('finishes a copy that was cut short before it was marked done', async () => {
    google.state.sheetsDisabled = true;
    await dataService.openStorage('folder');
    google.state.sheetsDisabled = false;
    // A sheet made on an earlier try, never filled in.
    await google.request('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: JSON.stringify({ properties: { title: 'Food Ratings Data' } }) });
    const stray = [...google.state.files.values()].find((f) => f.rows);
    Object.assign(stray, { parents: ['folder'], properties: { crate: 'data' } });

    const storage = await dataService.openStorage('folder');
    expect(storage.combinedFileId).toBe(stray.id);
    expect(column(stray, 'UUID')).toEqual(['a', 'b', 'c']);
    expect(stray.properties.migrated).toBe('true');
  });
});

describe('writing to the sheets', () => {
  let storage;
  beforeEach(async () => { storage = await dataService.openStorage('folder'); });

  it('appends an added entry and its change', async () => {
    const { entries } = await dataService.addEntry(storage, { restaurantName: 'Chipotle', score: '8' });

    const data = sheetOf('data');
    expect(column(data, 'UUID')).toEqual(['a', 'b', 'c', entries[0].uuid]);
    expect(rowFor(data, entries[0].uuid)['Restaurant Name']).toBe('Chipotle');
    const log = sheetOf('changelog');
    expect(column(log, 'Entry UUID').at(-1)).toBe(entries[0].uuid);
    expect(column(log, 'Change Type').at(-1)).toBe('addition');
  });

  it('changes only the edited cell, so edits made in the sheet meanwhile survive', async () => {
    const data = sheetOf('data');
    const header = data.rows[0];
    // Someone edits another field of the same row straight in the sheet.
    data.rows[1][header.indexOf('Specifier')] = 'Lasagna';
    // And adds a column of their own.
    data.rows[0].push('My Column');
    data.rows[1][data.rows[0].length - 1] = 'keep me';

    await dataService.modifyEntry(storage, 'a', { score: '9' });

    const row = rowFor(data, 'a');
    expect(row.Score).toBe('9');
    expect(row.Specifier).toBe('Lasagna');
    expect(row['My Column']).toBe('keep me');
    expect(column(sheetOf('changelog'), 'Value').at(-1)).toBe('9');
  });

  it('removes a deleted entry\'s row and nothing else', async () => {
    await dataService.deleteEntry(storage, 'b');

    const data = sheetOf('data');
    expect(column(data, 'UUID')).toEqual(['a', 'c']);
    expect(rowFor(data, 'c')['Restaurant Name']).toBe("Wendy's");
    expect(column(sheetOf('changelog'), 'Change Type').at(-1)).toBe('deletion');
  });

  it('finds rows by UUID at write time, so a row deleted elsewhere doesn\'t misdirect an edit', async () => {
    // Another device deletes row "a" after this write read the sheet.
    google.state.onColumnRead = (file) => {
      if (file.properties.crate === 'data') {
        file.rows.splice(1, 1);
        google.state.onColumnRead = null;
      }
    };
    await dataService.modifyEntry(storage, 'c', { score: '1' });

    const data = sheetOf('data');
    expect(column(data, 'UUID')).toEqual(['b', 'c']);
    expect(rowFor(data, 'b').Score).toBe('8');
    expect(rowFor(data, 'c').Score).toBe('1');
  });

  it('adds a schema column the sheet lacks instead of misplacing values', async () => {
    const data = sheetOf('data');
    const at = data.rows[0].indexOf('Coordinates');
    for (const row of data.rows) row.splice(at, 1);

    await dataService.modifyEntry(storage, 'a', { coordinates: '1,2' });

    expect(data.rows[0].at(-1)).toBe('Coordinates');
    expect(rowFor(data, 'a').Coordinates).toBe('1,2');
  });

  it('writes nothing when nothing changed', async () => {
    const before = sheetOf('data').version;
    await dataService.importChangelog(storage, csvService.parseChangelog(LOG_CSV));
    expect(sheetOf('data').version).toBe(before);
  });

  it('seeds both sheets wholesale', async () => {
    const { combined } = await dataService.readData(storage);
    combined.delete('c');
    expect(await dataService.replaceData(storage, { combined, changelog: [] })).toBe(true);
    expect(column(sheetOf('data'), 'UUID')).toEqual(['a', 'b']);
    expect(sheetOf('changelog').rows).toHaveLength(1);
  });
});

describe('catching up with the old CSVs', () => {
  it('brings over changes written to the changelog CSV after the copy, once', async () => {
    const storage = await dataService.openStorage('folder');
    const csvLog = google.state.files.get('csv-log');
    csvLog.content = `${LOG_CSV}\na,ch-late,modification,score,2,4`;
    csvLog.version++;

    const result = await dataService.catchUpFromCsv(storage, 'folder');
    expect(result.importedChanges).toBe(1);
    expect(rowFor(sheetOf('data'), 'a').Score).toBe('2');
    expect(column(sheetOf('changelog'), 'Change UUID')).toContain('ch-late');

    const reopened = await dataService.openStorage('folder');
    expect(await dataService.catchUpFromCsv(reopened, 'folder')).toBeNull();
    expect(column(sheetOf('changelog'), 'Change UUID').filter((c) => c === 'ch-late')).toHaveLength(1);
  });

  it('does nothing when the CSV hasn\'t changed', async () => {
    const storage = await dataService.openStorage('folder');
    expect(await dataService.catchUpFromCsv(storage, 'folder')).toBeNull();
  });
});

describe('friends', () => {
  it('reads a friend\'s shared sheet in preference to the CSV they first shared', async () => {
    await dataService.openStorage('folder');
    const data = sheetOf('data');
    Object.assign(data, { sharedWithMe: true, owners: ['friend@x.com'] });
    google.addCsv('friend-csv', 'food-ratings-data.csv', 'UUID,Entry Type,Restaurant Name\nold,food,Stale', { sharedWithMe: true, owners: ['friend@x.com'] });

    const combined = await dataService.readFriendRatings({ fileId: 'friend-csv', email: 'friend@x.com' });
    expect([...combined.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('still reads a friend who is on the CSV', async () => {
    google.addCsv('friend-csv', 'food-ratings-data.csv', 'UUID,Entry Type,Restaurant Name\nf1,food,Diner', { sharedWithMe: true, owners: ['friend@x.com'] });
    const combined = await dataService.readFriendRatings({ fileId: 'friend-csv', email: 'friend@x.com' });
    expect(combined.get('f1').restaurantName).toBe('Diner');
  });
});
