/**
 * Turning whatever the filters currently show into something to paste or send:
 * plain text in the same shape text mode reads, tab-separated rows for a
 * spreadsheet, or a CSV file.
 */
import { generateText } from './textModeUtils';
import { msToDateInput } from './dateUtils';
import {
  LABEL_CATEGORY, LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_LOCATION,
  LABEL_RATING, LABEL_DATE, LABEL_NOTES,
} from '../constants/fieldLabels.js';

const HEADERS = [LABEL_CATEGORY, LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_LOCATION, LABEL_RATING, LABEL_DATE, LABEL_NOTES, 'UUID'];

function categoryNames(categories) {
  return new Map((categories || []).map((c) => [c.uuid, c.restaurantName || '']));
}

export function resultRows(entries, categories) {
  const names = categoryNames(categories);
  return entries.map((e) => [
    names.get(e.ratingCategory) || '',
    e.restaurantName || '',
    e.specifier || '',
    e.location || '',
    e.score != null ? String(e.score) : '',
    e.dateRated != null ? msToDateInput(e.dateRated) : '',
    e.additionalInfo || '',
    e.uuid || '',
  ]);
}

/** Tab-separated, header row first — pastes straight into Sheets or Excel as cells. */
export function toTsv(entries, categories) {
  // A tab or newline inside a value would split the cell, so they become spaces.
  const clean = (v) => String(v).replace(/[\t\r\n]+/g, ' ');
  return [HEADERS, ...resultRows(entries, categories)].map((row) => row.map(clean).join('\t')).join('\n');
}

export function toCsv(entries, categories) {
  const quote = (v) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [HEADERS, ...resultRows(entries, categories)].map((row) => row.map(quote).join(',')).join('\r\n');
}

/** Restaurant blocks with one rating per line — readable, and pasteable into text mode. */
export function toText(entries, categories, options) {
  const ratings = entries.map((e) => ({
    id: e.uuid,
    restaurantName: e.restaurantName || '',
    location: e.location || '',
    specifier: e.specifier || '',
    score: e.score != null ? String(e.score) : '',
    ratingCategory: e.ratingCategory || '',
    // One rating per line, so a note's own line breaks can't start new ones.
    additionalInfo: String(e.additionalInfo || '').replace(/\s*[\r\n]+\s*/g, ' '),
    dateRated: e.dateRated != null ? msToDateInput(e.dateRated) : '',
  }));
  return generateText(ratings, categories, options);
}
