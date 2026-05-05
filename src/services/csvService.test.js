import { describe, it, expect } from 'vitest';
import {
  parseCombined,
  parseChangelog,
  generateCombined,
  generateChangelog,
  parse,
  generate,
} from './csvService';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTRY_UUID = 'aaaa-0000';
const CHANGE_UUID = 'bbbb-1111';
const DATE_MS = 1719360000000; // 2024-06-25T20:00:00.000Z (arbitrary stable value)

const sampleEntry = {
  uuid: ENTRY_UUID,
  entryType: 'food',
  identicals: ['x1', 'x2'],
  categories: ['cat1', 'cat2'],
  ratingCategory: 'rc1',
  restaurantName: 'Burger Place',
  specifier: 'Cheeseburger',
  location: 'NYC',
  score: '8',
  dateRated: DATE_MS,
  additionalInfo: 'crispy',
  picture: 'http://img',
};

const sampleCategoryEntry = {
  uuid: 'cccc-2222',
  entryType: 'category',
  identicals: [],
  categories: [],
  ratingCategory: '',
  restaurantName: 'Fast Food',
  specifier: '',
  location: '',
  score: null,
  dateRated: null,
  additionalInfo: '',
  picture: '',
};

const sampleChange = {
  entryUuid: ENTRY_UUID,
  changeUuid: CHANGE_UUID,
  changeType: 'addition',
  fieldName: '',
  value: '',
  identicals: ['x1'],
  categories: ['cat1'],
  ratingCategory: 'rc1',
  restaurantName: 'Burger Place',
  specifier: 'Cheeseburger',
  location: 'NYC',
  score: '8',
  dateRated: DATE_MS,
  additionalInfo: 'crispy',
  picture: 'http://img',
  entryType: 'food',
  changeMethod: 'manual, through the app',
  dateOfChange: DATE_MS,
};

// ── parseCombined ─────────────────────────────────────────────────────────────

describe('parseCombined', () => {
  it('returns empty Map for null', () => {
    expect(parseCombined(null).size).toBe(0);
  });

  it('returns empty Map for empty string', () => {
    expect(parseCombined('').size).toBe(0);
  });

  it('returns empty Map for whitespace-only string', () => {
    expect(parseCombined('   ').size).toBe(0);
  });

  it('parses a single entry row', () => {
    const csv = generateCombined({ combined: new Map([[ENTRY_UUID, sampleEntry]]) });
    const result = parseCombined(csv);
    expect(result.size).toBe(1);
    const e = result.get(ENTRY_UUID);
    expect(e.uuid).toBe(ENTRY_UUID);
    expect(e.entryType).toBe('food');
    expect(e.restaurantName).toBe('Burger Place');
    expect(e.specifier).toBe('Cheeseburger');
    expect(e.location).toBe('NYC');
    expect(e.score).toBe('8');
    expect(e.dateRated).toBe(DATE_MS);
    expect(e.identicals).toEqual(['x1', 'x2']);
    expect(e.categories).toEqual(['cat1', 'cat2']);
    expect(e.additionalInfo).toBe('crispy');
    expect(e.picture).toBe('http://img');
  });

  it('parses multiple entries keyed by UUID', () => {
    const combined = new Map([
      [ENTRY_UUID, sampleEntry],
      ['cccc-2222', sampleCategoryEntry],
    ]);
    const csv = generateCombined({ combined });
    const result = parseCombined(csv);
    expect(result.size).toBe(2);
    expect(result.has(ENTRY_UUID)).toBe(true);
    expect(result.has('cccc-2222')).toBe(true);
  });

  it('sets null for missing score', () => {
    const csv = generateCombined({ combined: new Map([['cccc-2222', sampleCategoryEntry]]) });
    const result = parseCombined(csv);
    expect(result.get('cccc-2222').score).toBeNull();
  });

  it('sets null for missing dateRated', () => {
    const csv = generateCombined({ combined: new Map([['cccc-2222', sampleCategoryEntry]]) });
    const result = parseCombined(csv);
    expect(result.get('cccc-2222').dateRated).toBeNull();
  });

  it('skips rows without a UUID', () => {
    const csv = `UUID,Entry Type,Identicals,Categories,Rating Category,Restaurant Name,Specifier,Location,Score,Date Rated,Additional Information,Picture
,food,,,,,,,,,,`;
    const result = parseCombined(csv);
    expect(result.size).toBe(0);
  });

  it('returns null dateRated for non-numeric value (parseNum isNaN branch)', () => {
    const badDateRow = `UUID,Entry Type,Identicals,Categories,Rating Category,Restaurant Name,Specifier,Location,Score,Date Rated,Additional Information,Picture\n${ENTRY_UUID},food,,,rc1,Burger Place,Spec,,8,not-a-number,,`;
    const result = parseCombined(badDateRow);
    expect(result.get(ENTRY_UUID).dateRated).toBeNull();
  });

  it('handles entry with empty restaurantName and empty entryType (defaults to food)', () => {
    const entry = { ...sampleCategoryEntry, restaurantName: '', entryType: '' };
    const csv = generateCombined({ combined: new Map([[sampleCategoryEntry.uuid, entry]]) });
    const parsed = parseCombined(csv);
    const e = parsed.get(sampleCategoryEntry.uuid);
    expect(e.restaurantName).toBe('');
    expect(e.entryType).toBe('food');
  });

  it('defaults entryType to food when Entry Type cell is empty in raw CSV', () => {
    const rawCsv = `UUID,Entry Type,Identicals,Categories,Rating Category,Restaurant Name,Specifier,Location,Score,Date Rated,Additional Information,Picture\n${ENTRY_UUID},,,,,,Spec,,,,, `;
    const result = parseCombined(rawCsv);
    expect(result.get(ENTRY_UUID).entryType).toBe('food');
  });
});

// ── parseChangelog ────────────────────────────────────────────────────────────

describe('parseChangelog', () => {
  it('returns empty array for null', () => {
    expect(parseChangelog(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseChangelog('')).toEqual([]);
  });

  it('parses a single change row', () => {
    const csv = generateChangelog({ changelog: [sampleChange] });
    const result = parseChangelog(csv);
    expect(result.length).toBe(1);
    const c = result[0];
    expect(c.changeUuid).toBe(CHANGE_UUID);
    expect(c.entryUuid).toBe(ENTRY_UUID);
    expect(c.changeType).toBe('addition');
    expect(c.changeMethod).toBe('manual, through the app');
    expect(c.dateOfChange).toBe(DATE_MS);
  });

  it('parses identicals and categories as arrays', () => {
    const csv = generateChangelog({ changelog: [sampleChange] });
    const result = parseChangelog(csv);
    expect(result[0].identicals).toEqual(['x1']);
    expect(result[0].categories).toEqual(['cat1']);
  });

  it('defaults empty string fields in rowToChange to empty string', () => {
    // Craft a raw CSV where entryUuid, changeType, entryType, changeMethod are empty
    const header = 'Entry UUID,Change UUID,Change Type,Field Name,Value,Identicals,Categories,Rating Category,Restaurant Name,Specifier,Location,Score,Date Rated,Additional Information,Picture,Entry Type,Change Method,Date of Change';
    const row = `,,addition,,,,,,,,,,,,,food,manual,${DATE_MS}`;
    const csv = `${header}\n${row}`;
    const result = parseChangelog(csv);
    // changeUuid empty → skipped
    expect(result.length).toBe(0);
  });

  it('handles missing Value column (rowToChange value ?? null branch)', () => {
    // No Value column in header → row['Value'] is undefined → ?? '' returns ''
    const header = 'Entry UUID,Change UUID,Change Type,Field Name,Identicals,Categories,Rating Category,Restaurant Name,Specifier,Location,Score,Date Rated,Additional Information,Picture,Entry Type,Change Method,Date of Change';
    const row = `${ENTRY_UUID},${CHANGE_UUID},addition,,,,,,,,,,,,,food,manual,${DATE_MS}`;
    const csv = `${header}\n${row}`;
    const result = parseChangelog(csv);
    expect(result.length).toBe(1);
    expect(result[0].value).toBe('');
  });

  it('defaults entryType, changeMethod, and changeType to empty string when cells are empty', () => {
    const header = 'Entry UUID,Change UUID,Change Type,Field Name,Value,Identicals,Categories,Rating Category,Restaurant Name,Specifier,Location,Score,Date Rated,Additional Information,Picture,Entry Type,Change Method,Date of Change';
    const row = `${ENTRY_UUID},${CHANGE_UUID},,,value,,,,,,,,,,,,, `;
    const csv = `${header}\n${row}`;
    const result = parseChangelog(csv);
    expect(result[0].changeType).toBe('');
    expect(result[0].entryType).toBe('');
    expect(result[0].changeMethod).toBe('');
  });

  it('skips rows without a Change UUID', () => {
    const csv = `Entry UUID,Change UUID,Change Type,Field Name,Value,Identicals,Categories,Rating Category,Restaurant Name,Specifier,Location,Score,Date Rated,Additional Information,Picture,Entry Type,Change Method,Date of Change
uuid1,,addition,,,,,,,,,,,,,food,manual,1000`;
    const result = parseChangelog(csv);
    expect(result.length).toBe(0);
  });

  it('parses multiple changes in order', () => {
    const c1 = { ...sampleChange, changeUuid: 'c1', dateOfChange: 1000 };
    const c2 = { ...sampleChange, changeUuid: 'c2', dateOfChange: 2000 };
    const csv = generateChangelog({ changelog: [c1, c2] });
    const result = parseChangelog(csv);
    expect(result.length).toBe(2);
    expect(result[0].changeUuid).toBe('c1');
    expect(result[1].changeUuid).toBe('c2');
  });
});

// ── generateCombined ──────────────────────────────────────────────────────────

describe('generateCombined', () => {
  it('produces a CSV string with the correct header', () => {
    const csv = generateCombined({ combined: new Map() });
    expect(csv).toContain('UUID');
    expect(csv).toContain('Entry Type');
    expect(csv).toContain('Restaurant Name');
  });

  it('round-trips an entry through generate then parse', () => {
    const original = new Map([[ENTRY_UUID, sampleEntry]]);
    const csv = generateCombined({ combined: original });
    const parsed = parseCombined(csv);
    expect(parsed.get(ENTRY_UUID)).toEqual(sampleEntry);
  });

  it('serializes list fields with pipe separator', () => {
    const csv = generateCombined({ combined: new Map([[ENTRY_UUID, sampleEntry]]) });
    expect(csv).toContain('x1|x2');
    expect(csv).toContain('cat1|cat2');
  });

  it('serializes null score as empty string', () => {
    const csv = generateCombined({ combined: new Map([['c', sampleCategoryEntry]]) });
    // score column should be empty (not "null")
    expect(csv).not.toContain('null');
  });

  it('handles null identicals and categories (serializeList null branch)', () => {
    const entry = { ...sampleEntry, identicals: null, categories: null };
    const csv = generateCombined({ combined: new Map([[ENTRY_UUID, entry]]) });
    const parsed = parseCombined(csv);
    expect(parsed.get(ENTRY_UUID).identicals).toEqual([]);
    expect(parsed.get(ENTRY_UUID).categories).toEqual([]);
  });
});

// ── generateChangelog ─────────────────────────────────────────────────────────

describe('generateChangelog', () => {
  it('produces a CSV string with the changelog header', () => {
    const csv = generateChangelog({ changelog: [] });
    expect(csv).toContain('Change UUID');
    expect(csv).toContain('Entry UUID');
    expect(csv).toContain('Change Type');
  });

  it('round-trips a change through generate then parse', () => {
    const csv = generateChangelog({ changelog: [sampleChange] });
    const parsed = parseChangelog(csv);
    expect(parsed[0]).toEqual(sampleChange);
  });

  it('serializes null score, dateRated, and dateOfChange as empty string', () => {
    const change = { ...sampleChange, score: null, dateRated: null, dateOfChange: null };
    const csv = generateChangelog({ changelog: [change] });
    const parsed = parseChangelog(csv);
    expect(parsed[0].score).toBeNull();
    expect(parsed[0].dateRated).toBeNull();
    expect(parsed[0].dateOfChange).toBeNull();
    expect(csv).not.toContain('null');
  });

  it('handles a change with a non-empty value field', () => {
    const change = { ...sampleChange, changeType: 'edit', fieldName: 'score', value: '9' };
    const csv = generateChangelog({ changelog: [change] });
    const parsed = parseChangelog(csv);
    expect(parsed[0].value).toBe('9');
    expect(parsed[0].fieldName).toBe('score');
  });

  it('serializes a change with all empty optional string fields', () => {
    const sparse = {
      ...sampleChange,
      entryUuid: '',
      changeUuid: '',
      changeType: '',
      value: null,
      ratingCategory: '',
      restaurantName: '',
      specifier: '',
      location: '',
      additionalInfo: '',
      picture: '',
      entryType: '',
      changeMethod: '',
    };
    const csv = generateChangelog({ changelog: [sparse] });
    expect(csv).not.toContain('null');
  });
});

// ── parse (legacy single-file format) ────────────────────────────────────────

describe('parse', () => {
  it('returns empty structures for null', () => {
    const { combined, changelog } = parse(null);
    expect(combined.size).toBe(0);
    expect(changelog.length).toBe(0);
  });

  it('returns empty structures for empty string', () => {
    const { combined, changelog } = parse('');
    expect(combined.size).toBe(0);
    expect(changelog.length).toBe(0);
  });

  it('parses a full two-section document', () => {
    const combined = new Map([[ENTRY_UUID, sampleEntry]]);
    const changelog = [sampleChange];
    const csv = generate({ combined, changelog });
    const result = parse(csv);
    expect(result.combined.size).toBe(1);
    expect(result.changelog.length).toBe(1);
    expect(result.combined.get(ENTRY_UUID)).toEqual(sampleEntry);
    expect(result.changelog[0].changeUuid).toBe(CHANGE_UUID);
  });

  it('ignores lines before the first section marker', () => {
    const csv = `some random header\nSECTION,COMBINED\nUUID,Entry Type,Identicals,Categories,Rating Category,Restaurant Name,Specifier,Location,Score,Date Rated,Additional Information,Picture`;
    const { combined } = parse(csv);
    expect(combined.size).toBe(0);
  });

  it('handles a document with only the combined section', () => {
    const onlyCombined = `SECTION,COMBINED\n${generateCombined({ combined: new Map([[ENTRY_UUID, sampleEntry]]) })}`;
    const { combined, changelog } = parse(onlyCombined);
    expect(combined.size).toBe(1);
    expect(changelog.length).toBe(0);
  });

  it('handles a document with only the changelog section', () => {
    const onlyChangelog = `SECTION,CHANGELOG\n${generateChangelog({ changelog: [sampleChange] })}`;
    const { combined, changelog } = parse(onlyChangelog);
    expect(combined.size).toBe(0);
    expect(changelog.length).toBe(1);
  });
});

// ── generate (legacy single-file format) ─────────────────────────────────────

describe('generate', () => {
  it('includes both section markers', () => {
    const csv = generate({ combined: new Map(), changelog: [] });
    expect(csv).toContain('SECTION,COMBINED');
    expect(csv).toContain('SECTION,CHANGELOG');
  });

  it('round-trips combined + changelog', () => {
    const combined = new Map([[ENTRY_UUID, sampleEntry]]);
    const changelog = [sampleChange];
    const csv = generate({ combined, changelog });
    const result = parse(csv);
    expect(result.combined.get(ENTRY_UUID)).toEqual(sampleEntry);
    expect(result.changelog[0]).toEqual(sampleChange);
  });

  it('places COMBINED marker before CHANGELOG marker', () => {
    const csv = generate({ combined: new Map(), changelog: [] });
    expect(csv.indexOf('SECTION,COMBINED')).toBeLessThan(csv.indexOf('SECTION,CHANGELOG'));
  });
});
