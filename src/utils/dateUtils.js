/**
 * Parse a date string in M/D/YY or M/D/YYYY format to a ms timestamp.
 */
export function parseLegacyDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;
  let year = parseInt(parts[2], 10);
  if (year < 100) year += 2000;
  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  const d = new Date(year, month, day);
  if (isNaN(d.getTime())) return null;
  return d.getTime();
}

/**
 * Format a ms timestamp as a human-readable date string (e.g. "Jun 26, 2021").
 */
export function formatDate(ms) {
  if (ms == null) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a ms timestamp as an input[type=date] value (YYYY-MM-DD).
 */
export function msToDateInput(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse an input[type=date] value (YYYY-MM-DD) to a ms timestamp.
 */
export function dateInputToMs(str) {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return d.getTime();
}
