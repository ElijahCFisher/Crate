import { describe, it, expect } from 'vitest';
import { toCsv, toText, toTsv } from './resultsExport';

const categories = [{ uuid: 'c-greek', restaurantName: 'greek', ratingCategory: '' }];
const day = (y, m, d) => new Date(y, m - 1, d).getTime();

const entries = [
  { uuid: 'u1', restaurantName: "Zorba's", location: 'Denver', specifier: 'Gyro', score: 8, ratingCategory: 'c-greek', additionalInfo: 'tender', dateRated: day(2026, 9, 1) },
  { uuid: 'u2', restaurantName: "Zorba's", location: 'Denver', specifier: 'Fries', score: 5, ratingCategory: '', additionalInfo: 'too salty,\nlimp', dateRated: day(2026, 9, 1) },
];

describe('results export', () => {
  it('writes spreadsheet rows with a header, keeping each value in one cell', () => {
    const lines = toTsv(entries, categories).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].split('\t')[0]).toBe('Category');
    expect(lines[1].split('\t')).toEqual(['greek', "Zorba's", 'Gyro', 'Denver', '8', '2026-09-01', 'tender', 'u1']);
    expect(lines[2].split('\t')[6]).toBe('too salty, limp');
  });

  it('quotes CSV values that need it', () => {
    const rows = toCsv(entries, categories).split('\r\n');
    expect(rows[1]).toBe("greek,Zorba's,Gyro,Denver,8,2026-09-01,tender,u1");
    expect(toCsv(entries, categories)).toContain('"too salty,\nlimp"');
  });

  it('writes text in the shape text mode reads', () => {
    expect(toText(entries, categories, { now: new Date(2026, 8, 15) }))
      .toBe("Zorba's\nDenver\nGyro 8 greek tender\nFries 5 too salty, limp\n9/1");
  });
});
