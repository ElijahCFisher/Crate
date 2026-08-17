import Papa from 'papaparse';

const COMBINED_MARKER = 'SECTION,COMBINED';
const CHANGELOG_MARKER = 'SECTION,CHANGELOG';

const COMBINED_FIELDS = [
  'UUID', 'Entry Type', 'Identicals', 'Categories', 'Rating Category',
  'Restaurant Name', 'Specifier', 'Location', 'Score', 'Date Rated',
  'Additional Information', 'Picture', 'Linked Fields',
];

const CHANGELOG_FIELDS = [
  'Entry UUID', 'Change UUID', 'Change Type', 'Field Name', 'Value',
  'Identicals', 'Categories', 'Rating Category', 'Restaurant Name',
  'Specifier', 'Location', 'Score', 'Date Rated', 'Additional Information',
  'Picture', 'Entry Type', 'Change Method', 'Date of Change', 'Linked Fields',
];

// ── Split-file parse / generate (two separate Drive files) ───────────────────

export function parseCombined(csvText) {
  const combined = new Map();
  if (!csvText || csvText.trim() === '') return combined;
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  for (const row of data) {
    const entry = rowToEntry(row);
    if (entry.uuid) combined.set(entry.uuid, entry);
  }
  return combined;
}

export function parseChangelog(csvText) {
  const changelog = [];
  if (!csvText || csvText.trim() === '') return changelog;
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  for (const row of data) {
    const change = rowToChange(row);
    if (change.changeUuid) changelog.push(change);
  }
  return changelog;
}

export function generateCombined({ combined }) {
  const rows = Array.from(combined.values()).map(entryToRow);
  return Papa.unparse({ fields: COMBINED_FIELDS, data: rows });
}

export function generateChangelog({ changelog }) {
  const rows = changelog.map(changeToRow);
  return Papa.unparse({ fields: CHANGELOG_FIELDS, data: rows });
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export function parse(csvText) {
  if (!csvText || csvText.trim() === '') {
    return { combined: new Map(), changelog: [] };
  }

  const lines = csvText.split('\n');
  let section = null;
  const combinedLines = [];
  const changelogLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === COMBINED_MARKER) { section = 'combined'; continue; }
    if (trimmed === CHANGELOG_MARKER) { section = 'changelog'; continue; }
    if (section === 'combined') combinedLines.push(line);
    else if (section === 'changelog') changelogLines.push(line);
  }

  const combined = new Map();
  if (combinedLines.length > 1) {
    const { data } = Papa.parse(combinedLines.join('\n'), { header: true, skipEmptyLines: true });
    for (const row of data) {
      const entry = rowToEntry(row);
      if (entry.uuid) combined.set(entry.uuid, entry);
    }
  }

  const changelog = [];
  if (changelogLines.length > 1) {
    const { data } = Papa.parse(changelogLines.join('\n'), { header: true, skipEmptyLines: true });
    for (const row of data) {
      const change = rowToChange(row);
      if (change.changeUuid) changelog.push(change);
    }
  }

  return { combined, changelog };
}

// ── Generation ────────────────────────────────────────────────────────────────

export function generate({ combined, changelog }) {
  const combinedRows = Array.from(combined.values()).map(entryToRow);
  const changelogRows = changelog.map(changeToRow);

  const combinedCsv = Papa.unparse({ fields: COMBINED_FIELDS, data: combinedRows });
  const changelogCsv = Papa.unparse({ fields: CHANGELOG_FIELDS, data: changelogRows });

  return `${COMBINED_MARKER}\n${combinedCsv}\n${CHANGELOG_MARKER}\n${changelogCsv}`;
}

// ── Row ↔ Object helpers ──────────────────────────────────────────────────────

function parseList(str) {
  if (!str || str.trim() === '') return [];
  return str.split('|').map((s) => s.trim()).filter(Boolean);
}

function serializeList(arr) {
  return (arr || []).join('|');
}

/**
 * `linkedFields` records, on a *leader* entry, which of its fields are still
 * mirrored onto which follower entries — the "keep this uncertain restaurant
 * name changeable across all of them" link. Stored as one CSV cell:
 *
 *   restaurantName:uuid1;uuid2|location:uuid3
 *
 * Field *names* (not column indices) are the keys, so reordering
 * COMBINED_FIELDS can never silently repoint a link at the wrong field.
 */
export function parseLinkedFields(str) {
  const map = {};
  if (!str || typeof str !== 'string' || str.trim() === '') return map;
  for (const group of str.split('|')) {
    const sep = group.indexOf(':');
    if (sep <= 0) continue;
    const field = group.slice(0, sep).trim();
    const uuids = group.slice(sep + 1).split(';').map((u) => u.trim()).filter(Boolean);
    if (field && uuids.length > 0) map[field] = [...new Set([...(map[field] || []), ...uuids])];
  }
  return map;
}

export function serializeLinkedFields(map) {
  if (!map) return '';
  if (typeof map === 'string') return map;
  return Object.entries(map)
    .filter(([field, uuids]) => field && Array.isArray(uuids) && uuids.length > 0)
    .map(([field, uuids]) => `${field}:${uuids.join(';')}`)
    .join('|');
}

function parseNum(val, parser) {
  if (val === '' || val == null) return null;
  const n = parser(val);
  return isNaN(n) ? null : n;
}

function rowToEntry(row) {
  return {
    uuid: row['UUID'] || '',
    entryType: row['Entry Type'] || 'food',
    identicals: parseList(row['Identicals']),
    categories: parseList(row['Categories']),
    ratingCategory: row['Rating Category'] || '',
    restaurantName: row['Restaurant Name'] || '',
    specifier: row['Specifier'] || '',
    location: row['Location'] || '',
    score: row['Score'] != null && row['Score'] !== '' ? row['Score'] : null,
    dateRated: parseNum(row['Date Rated'], parseInt),
    additionalInfo: row['Additional Information'] || '',
    picture: row['Picture'] || '',
    linkedFields: parseLinkedFields(row['Linked Fields']),
  };
}

function entryToRow(entry) {
  return {
    'UUID': entry.uuid,
    'Entry Type': entry.entryType || 'food',
    'Identicals': serializeList(entry.identicals),
    'Categories': serializeList(entry.categories),
    'Rating Category': entry.ratingCategory || '',
    'Restaurant Name': entry.restaurantName || '',
    'Specifier': entry.specifier || '',
    'Location': entry.location || '',
    'Score': entry.score != null ? entry.score : '',
    'Date Rated': entry.dateRated != null ? entry.dateRated : '',
    'Additional Information': entry.additionalInfo || '',
    'Picture': entry.picture || '',
    'Linked Fields': serializeLinkedFields(entry.linkedFields),
  };
}

function rowToChange(row) {
  return {
    entryUuid: row['Entry UUID'] || '',
    changeUuid: row['Change UUID'] || '',
    changeType: row['Change Type'] || '',
    fieldName: row['Field Name'] || '',
    value: row['Value'] ?? '',
    identicals: parseList(row['Identicals']),
    categories: parseList(row['Categories']),
    ratingCategory: row['Rating Category'] || '',
    restaurantName: row['Restaurant Name'] || '',
    specifier: row['Specifier'] || '',
    location: row['Location'] || '',
    score: row['Score'] != null && row['Score'] !== '' ? row['Score'] : null,
    dateRated: parseNum(row['Date Rated'], parseInt),
    additionalInfo: row['Additional Information'] || '',
    picture: row['Picture'] || '',
    entryType: row['Entry Type'] || '',
    changeMethod: row['Change Method'] || '',
    dateOfChange: parseNum(row['Date of Change'], parseInt),
    linkedFields: parseLinkedFields(row['Linked Fields']),
  };
}

function changeToRow(change) {
  return {
    'Entry UUID': change.entryUuid || '',
    'Change UUID': change.changeUuid || '',
    'Change Type': change.changeType || '',
    'Field Name': change.fieldName || '',
    'Value': change.value ?? '',
    'Identicals': serializeList(change.identicals),
    'Categories': serializeList(change.categories),
    'Rating Category': change.ratingCategory || '',
    'Restaurant Name': change.restaurantName || '',
    'Specifier': change.specifier || '',
    'Location': change.location || '',
    'Score': change.score != null ? change.score : '',
    'Date Rated': change.dateRated != null ? change.dateRated : '',
    'Additional Information': change.additionalInfo || '',
    'Picture': change.picture || '',
    'Entry Type': change.entryType || '',
    'Change Method': change.changeMethod || '',
    'Date of Change': change.dateOfChange != null ? change.dateOfChange : '',
    'Linked Fields': serializeLinkedFields(change.linkedFields),
  };
}
