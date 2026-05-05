import { describe, it, expect } from 'vitest';
import { parseLegacyDate, formatDate, msToDateInput, dateInputToMs } from './dateUtils';

describe('parseLegacyDate', () => {
  it('parses M/D/YY format', () => {
    const ms = parseLegacyDate('6/26/21');
    expect(ms).toBe(new Date(2021, 5, 26).getTime());
  });

  it('parses M/D/YYYY format', () => {
    const ms = parseLegacyDate('6/26/2021');
    expect(ms).toBe(new Date(2021, 5, 26).getTime());
  });

  it('parses single-digit month and day', () => {
    const ms = parseLegacyDate('1/5/23');
    expect(ms).toBe(new Date(2023, 0, 5).getTime());
  });

  it('parses double-digit month and day', () => {
    const ms = parseLegacyDate('12/31/99');
    expect(ms).toBe(new Date(2099, 11, 31).getTime());
  });

  it('interprets 2-digit year as 2000+', () => {
    const ms = parseLegacyDate('1/1/00');
    expect(ms).toBe(new Date(2000, 0, 1).getTime());
  });

  it('returns null for empty string', () => {
    expect(parseLegacyDate('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseLegacyDate('   ')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseLegacyDate(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseLegacyDate(undefined)).toBeNull();
  });

  it('returns null for wrong number of parts', () => {
    expect(parseLegacyDate('6/26')).toBeNull();
    expect(parseLegacyDate('6/26/21/extra')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    const ms = parseLegacyDate('  6/26/21  ');
    expect(ms).toBe(new Date(2021, 5, 26).getTime());
  });

  it('returns null when parts are non-numeric (NaN date)', () => {
    expect(parseLegacyDate('abc/def/ghi')).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats a known timestamp', () => {
    const ms = new Date(2021, 5, 26).getTime(); // Jun 26, 2021
    expect(formatDate(ms)).toBe('Jun 26, 2021');
  });

  it('returns em dash for null', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('returns em dash for undefined', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('formats January 1st correctly', () => {
    const ms = new Date(2000, 0, 1).getTime();
    expect(formatDate(ms)).toBe('Jan 1, 2000');
  });

  it('formats December 31st correctly', () => {
    const ms = new Date(1999, 11, 31).getTime();
    expect(formatDate(ms)).toBe('Dec 31, 1999');
  });
});

describe('msToDateInput', () => {
  it('formats timestamp as YYYY-MM-DD', () => {
    const ms = new Date(2024, 5, 26).getTime(); // Jun 26 2024
    expect(msToDateInput(ms)).toBe('2024-06-26');
  });

  it('zero-pads month and day', () => {
    const ms = new Date(2024, 0, 5).getTime(); // Jan 5 2024
    expect(msToDateInput(ms)).toBe('2024-01-05');
  });

  it('returns empty string for null', () => {
    expect(msToDateInput(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(msToDateInput(undefined)).toBe('');
  });
});

describe('dateInputToMs', () => {
  it('parses YYYY-MM-DD to ms timestamp', () => {
    const ms = dateInputToMs('2024-06-26');
    expect(ms).toBe(new Date('2024-06-26T00:00:00').getTime());
  });

  it('returns null for empty string', () => {
    expect(dateInputToMs('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(dateInputToMs(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(dateInputToMs(undefined)).toBeNull();
  });

  it('returns null for invalid date string', () => {
    expect(dateInputToMs('not-a-date')).toBeNull();
  });

  it('round-trips with msToDateInput', () => {
    const original = new Date(2023, 8, 15).getTime(); // Sep 15 2023
    const str = msToDateInput(original);
    const back = dateInputToMs(str);
    expect(back).toBe(original);
  });
});
