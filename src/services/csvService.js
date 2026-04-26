import Papa from 'papaparse';

const COMBINED_MARKER = 'SECTION,COMBINED';
const CHANGELOG_MARKER = 'SECTION,CHANGELOG';

const COMBINED_FIELDS = [
  'UUID', 'Entry Type', 'Identicals', 'Categories', 'Rating Category',
  'Restaurant Name', 'Specifier', 'Location', 'Score', 'Date Rated',
  'Additional Information', 'Picture',
];

const CHANGELOG_FIELDS = [
  'Entry UUID', 'Change UUID', 'Change Type', 'Field Name', 'Value',
  'Identicals', 'Categories', 'Rating Category', 'Restaurant Name',
  'Specifier', 'Location', 'Score', 'Date Rated', 'Additional Information',
  'Picture', 'Entry Type', 'Change Method', 'Date of Change',
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
  };
}
