import {
  LABEL_RESTAURANT, LABEL_FOOD_NAME, LABEL_RATING,
  LABEL_CATEGORY, LABEL_LOCATION, LABEL_NOTES, LABEL_DATE,
} from '../constants/fieldLabels.js';

export const FIELDS = [
  { value: 'any', label: 'Any field' },
  { value: 'restaurantName', label: LABEL_RESTAURANT },
  { value: 'specifier', label: LABEL_FOOD_NAME },
  { value: 'location', label: LABEL_LOCATION },
  { value: 'score', label: LABEL_RATING },
  { value: 'additionalInfo', label: LABEL_NOTES },
  { value: 'ratingCategory', label: LABEL_CATEGORY },
  { value: 'dateRated', label: LABEL_DATE },
  { value: 'uuid', label: 'UUID' },
];

/**
 * The same engine over categories. A category is stored as an entry: its name
 * is restaurantName and its parent is ratingCategory, so those fields keep
 * their keys and just get honest labels — and Parent contains "Food" finds
 * everything anywhere under Food, same as Category does for entries.
 */
export const CATEGORY_FIELDS = [
  { value: 'any', label: 'Any field' },
  { value: 'restaurantName', label: 'Name' },
  { value: 'ratingCategory', label: 'Parent' },
  { value: 'score', label: 'Score' },
  { value: 'additionalInfo', label: LABEL_NOTES },
  { value: 'dateRated', label: LABEL_DATE },
  { value: 'uuid', label: 'UUID' },
];

export const TEXT_OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: '=' },
  { value: 'notContains', label: 'not contains' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

export const DATE_OPS = [
  { value: 'dateOn', label: 'on' },
  { value: 'dateBefore', label: 'before' },
  { value: 'dateAfter', label: 'after' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

export const RATING_OPS = [
  { value: 'ratingEquals', label: '=' },
  { value: 'ratingNotEquals', label: '≠' },
  { value: 'ratingGreater', label: '>' },
  { value: 'ratingGreaterOrEqual', label: '≥' },
  { value: 'ratingLess', label: '<' },
  { value: 'ratingLessOrEqual', label: '≤' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];

// ── Search vocabulary: aliases and places ─────────────────────────────────────
//
// One rule per line, written in Settings:
//
//   CS = Colorado Springs          two names for the same thing
//   Denver > CO > US               Denver is in CO, which is in US
//   Colorado Springs = CS > CO     both at once
//
// A search for any name in an alias group also finds the others. A search for a
// place (in Location or Any field) also finds everything declared inside it, so
// Location = "CO" finds entries at "16th, Denver".

function normalizeTerm(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Parse the rules text into something `expandSearchTerm` can use quickly. */
export function parseSearchVocabulary(text) {
  const parent = new Map(); // union-find over normalized terms
  const find = (t) => {
    let root = t;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(t, root);
    return root;
  };
  const add = (t) => { if (!parent.has(t)) parent.set(t, t); return find(t); };
  const union = (a, b) => { const ra = add(a); const rb = add(b); if (ra !== rb) parent.set(rb, ra); };

  const containment = []; // [innerTerm, outerTerm] — resolved to groups after all unions
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const levels = line.split('>')
      .map((level) => level.split('=').map(normalizeTerm).filter(Boolean))
      .filter((names) => names.length > 0);
    for (const names of levels) {
      add(names[0]);
      for (const name of names.slice(1)) union(names[0], name);
    }
    for (let i = 0; i + 1 < levels.length; i++) containment.push([levels[i][0], levels[i + 1][0]]);
  }

  const members = new Map(); // root → every name in the group
  for (const term of parent.keys()) {
    const root = find(term);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(term);
  }
  const children = new Map(); // root → roots declared directly inside it
  for (const [inner, outer] of containment) {
    const innerRoot = find(inner);
    const outerRoot = find(outer);
    if (innerRoot === outerRoot) continue;
    if (!children.has(outerRoot)) children.set(outerRoot, new Set());
    children.get(outerRoot).add(innerRoot);
  }
  return { find: (t) => (parent.has(t) ? find(t) : null), members, children };
}

const PLACE_FIELDS = new Set(['location', 'any']);

/**
 * The other names a search for `needle` in `field` should also find: its
 * aliases, plus — for Location and Any field — everything inside it. Never
 * includes the needle itself.
 */
export function expandSearchTerm(vocabulary, needle, field) {
  if (!vocabulary) return [];
  const key = normalizeTerm(needle);
  const root = key ? vocabulary.find(key) : null;
  if (!root) return [];

  const roots = [root];
  if (PLACE_FIELDS.has(field)) {
    const seen = new Set(roots);
    for (let i = 0; i < roots.length; i++) {
      for (const child of vocabulary.children.get(roots[i]) || []) {
        if (!seen.has(child)) { seen.add(child); roots.push(child); }
      }
    }
  }
  const terms = new Set();
  for (const r of roots) for (const name of vocabulary.members.get(r) || []) terms.add(name);
  terms.delete(key);
  return [...terms];
}

export function getOps(field) {
  if (field === 'dateRated') return DATE_OPS;
  if (field === 'score') return RATING_OPS;
  return TEXT_OPS;
}

export function needsValue(f) {
  return !['isEmpty', 'isNotEmpty'].includes(f.op);
}

function isActiveFilter(f) {
  return !needsValue(f) || f.value.trim();
}

export function makeDefaultFilter() {
  return { id: Date.now() + Math.random(), field: 'any', op: 'contains', value: '', caseSensitive: false, useRegex: false, connector: 'AND' };
}

export function getActiveFilters(filters) {
  return filters.filter(isActiveFilter);
}

export function buildDefaultFilterLogic(filters, fields = FIELDS) {
  const parts = [];
  filters.forEach((filter) => {
    if (!isActiveFilter(filter)) return;
    if (parts.length > 0) parts.push(filter.connector || 'AND');
    parts.push(describeFilter(filter, fields));
  });
  return parts.join(' ');
}

export function splitFiltersIntoOrGroups(filters) {
  const active = getActiveFilters(filters);
  const groups = [];
  let current = [];

  for (let i = 0; i < active.length; i++) {
    if (i > 0 && active[i].connector === 'OR' && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(active[i]);
  }

  if (current.length) groups.push(current);
  return groups;
}

export function applyFilterGroup(entries, group, categories, { vocabulary = null } = {}) {
  if (!group.length) return entries;
  const catMap = makeCategoryMap(categories);
  return entries.filter((entry) => group.every((filter) => matchFilter(entry, filter, catMap, vocabulary)));
}

/**
 * `fields` is the field list the filter rows offer — FIELDS for entries, or
 * another list (CATEGORY_FIELDS) that names the same underlying fields
 * differently. Everything that turns filters into text takes it.
 */
export function describeFilter(filter, fields = FIELDS) {
  const fieldLabel = fields.find((field) => field.value === filter.field)?.label || filter.field;
  const allOps = [...TEXT_OPS, ...DATE_OPS, ...RATING_OPS];
  const opLabel = allOps.find((op) => op.value === filter.op)?.label || filter.op;
  const value = needsValue(filter) ? ` "${filter.value}"` : '';
  return `${fieldLabel} ${opLabel}${value}`;
}

export function describeFilterGroup(group, fields = FIELDS) {
  return group.map((filter, idx) => {
    const prefix = idx > 0 ? ' AND ' : '';
    return `${prefix}${describeFilter(filter, fields)}`;
  }).join('');
}

function tokenizeLogic(logic, filters, fields = FIELDS) {
  const tokens = [];
  const operands = getActiveFilters(filters)
    .map((filter) => ({ filter, text: describeFilter(filter, fields) }))
    .sort((a, b) => b.text.length - a.text.length);
  let i = 0;

  while (i < logic.length) {
    const char = logic[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ type: char, value: char });
      i++;
      continue;
    }
    const wordMatch = logic.slice(i).match(/^(AND|OR)\b/i);
    if (wordMatch) {
      const word = wordMatch[0].toUpperCase();
      tokens.push({ type: word, value: word });
      i += wordMatch[0].length;
      continue;
    }
    const operand = operands.find(({ text }) => logic.startsWith(text, i));
    if (operand) {
      tokens.push({ type: 'FILTER', value: operand.text, filterId: operand.filter.id });
      i += operand.text.length;
      continue;
    }
    return { tokens: [], error: `Expected filter text near "${logic.slice(i, i + 30)}"` };
  }

  return { tokens, error: null };
}

function parseFilterLogic(logic, filters, fields = FIELDS) {
  const normalized = (logic || buildDefaultFilterLogic(filters, fields)).trim();
  if (!normalized) return { valid: true, ast: null, logic: normalized };

  const { tokens, error } = tokenizeLogic(normalized, filters, fields);
  if (error) return { valid: false, error, ast: null, logic: normalized };

  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume(type) {
    if (peek()?.type !== type) return null;
    return tokens[pos++];
  }

  function parsePrimary() {
    const token = peek();
    if (!token) return { error: 'Expected filter text or parentheses' };

    if (consume('(')) {
      const inner = parseOr();
      if (inner.error) return inner;
      if (!consume(')')) return { error: 'Missing closing parenthesis' };
      return inner;
    }

    const filter = consume('FILTER');
    if (!filter) return { error: 'Expected filter text' };
    return { node: { type: 'filter', filterId: filter.filterId } };
  }

  function parseAnd() {
    let left = parsePrimary();
    if (left.error) return left;

    while (consume('AND')) {
      const right = parsePrimary();
      if (right.error) return right;
      left = { node: { type: 'AND', left: left.node, right: right.node } };
    }

    return left;
  }

  function parseOr() {
    let left = parseAnd();
    if (left.error) return left;

    while (consume('OR')) {
      const right = parseAnd();
      if (right.error) return right;
      left = { node: { type: 'OR', left: left.node, right: right.node } };
    }

    return left;
  }

  const parsed = parseOr();
  if (parsed.error) return { valid: false, error: parsed.error, ast: null, logic: normalized };
  if (pos < tokens.length) return { valid: false, error: `Unexpected "${tokens[pos].value}"`, ast: null, logic: normalized };

  return { valid: true, ast: parsed.node, logic: normalized };
}

function evalFilterAstWithCatMap(ast, entry, filters, catMap, vocabulary = null) {
  if (!ast) return true;
  if (ast.type === 'AND') return evalFilterAstWithCatMap(ast.left, entry, filters, catMap, vocabulary) && evalFilterAstWithCatMap(ast.right, entry, filters, catMap, vocabulary);
  if (ast.type === 'OR') return evalFilterAstWithCatMap(ast.left, entry, filters, catMap, vocabulary) || evalFilterAstWithCatMap(ast.right, entry, filters, catMap, vocabulary);

  const filter = filters.find((f) => f.id === ast.filterId);
  if (!filter || !isActiveFilter(filter)) return false;
  return matchFilter(entry, filter, catMap, vocabulary);
}

function collectTopLevelOrGroups(ast) {
  if (!ast) return [];
  if (ast.type === 'OR') return [...collectTopLevelOrGroups(ast.left), ...collectTopLevelOrGroups(ast.right)];
  return [ast];
}

function collectFilterIds(ast, ids = new Set()) {
  if (!ast) return ids;
  if (ast.type === 'filter') ids.add(ast.filterId);
  else {
    collectFilterIds(ast.left, ids);
    collectFilterIds(ast.right, ids);
  }
  return ids;
}

export function getFilterLogicState(filters, logic, fields = FIELDS) {
  return parseFilterLogic(logic, filters, fields);
}

export function applyFilterLogicGroup(entries, filters, categories, ast, { vocabulary = null } = {}) {
  const catMap = makeCategoryMap(categories);
  return entries.filter((entry) => evalFilterAstWithCatMap(ast, entry, filters, catMap, vocabulary));
}

export function getFilterLogicGroups(filters, logic, fields = FIELDS) {
  const parsed = parseFilterLogic(logic, filters, fields);
  if (!parsed.valid || !parsed.ast) return [];

  return collectTopLevelOrGroups(parsed.ast).map((ast) => {
    const ids = collectFilterIds(ast);
    const groupFilters = filters.filter((filter) => ids.has(filter.id));
    return {
      ast,
      filters: groupFilters,
      lastFilterId: groupFilters[groupFilters.length - 1]?.id,
    };
  });
}

// ── Copying and pasting filters ───────────────────────────────────────────────
//
// The copied form is the same text Edit Logic shows —
//   (Restaurant/Brand contains "Pizza Hut" OR Location = "Denver") AND Rating ≥ "8"
// — plus a [case] / [regex] tag on any filter that has those switched on, since
// the plain description can't carry them.

function flagTag(filter) {
  const flags = [filter.caseSensitive && 'case', filter.useRegex && 'regex'].filter(Boolean);
  return flags.length ? ` [${flags.join(' ')}]` : '';
}

export function serializeFilters(filters, logic = '', fields = FIELDS) {
  let text = (logic || '').trim() || buildDefaultFilterLogic(filters, fields);
  for (const filter of getActiveFilters(filters)) {
    const tag = flagTag(filter);
    const description = describeFilter(filter, fields);
    if (tag) text = text.split(description).join(description + tag);
  }
  return text;
}

/**
 * Read copied filter text back into filter rows. A flat chain of ANDs and ORs
 * becomes rows with those connectors; anything with parentheses keeps the rows
 * plain and carries the grouping as custom logic, exactly like Edit Logic.
 * Returns { filters, logic } or { error }.
 */
export function parseFilterText(text, fields = FIELDS) {
  const source = String(text ?? '').trim();
  if (!source) return { error: 'Nothing to paste.' };

  const fieldsByLength = [...fields].sort((a, b) => b.label.length - a.label.length);
  const tokens = [];
  let i = 0;

  const startsWithWord = (word) => {
    const slice = source.slice(i, i + word.length);
    if (slice.toUpperCase() !== word) return false;
    const next = source[i + word.length];
    return next === undefined || /[\s(]/.test(next);
  };

  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source[i] === '(' || source[i] === ')') { tokens.push({ type: source[i] }); i++; continue; }
    if (startsWithWord('AND') || startsWithWord('OR')) {
      const word = startsWithWord('AND') ? 'AND' : 'OR';
      tokens.push({ type: word });
      i += word.length;
      continue;
    }

    const field = fieldsByLength.find((f) => source.slice(i, i + f.label.length).toLowerCase() === f.label.toLowerCase());
    if (!field) return { error: `Expected a field name near "${source.slice(i, i + 30)}"` };
    i += field.label.length;
    while (/\s/.test(source[i] ?? '')) i++;

    const ops = [...getOps(field.value)].sort((a, b) => b.label.length - a.label.length);
    const op = ops.find((o) => source.slice(i, i + o.label.length).toLowerCase() === o.label.toLowerCase());
    if (!op) return { error: `Expected an operator after "${field.label}"` };
    i += op.label.length;

    const filter = {
      id: Date.now() + Math.random(),
      field: field.value,
      op: op.value,
      value: '',
      caseSensitive: false,
      useRegex: false,
      connector: 'AND',
    };

    if (needsValue(filter)) {
      while (/\s/.test(source[i] ?? '')) i++;
      if (source[i] !== '"') return { error: `Expected a quoted value after "${field.label} ${op.label}"` };
      // The value runs to the quote that the text after it says is the end —
      // a closing paren, AND/OR, a [flags] tag, or the end — so quotes inside
      // a value survive.
      const rest = source.slice(i + 1);
      const close = /"(?=\s*(?:$|\)|\[|AND\b|OR\b))/i.exec(rest);
      if (!close) return { error: `Missing the closing quote after "${field.label} ${op.label}"` };
      filter.value = rest.slice(0, close.index);
      i += 1 + close.index + 1;
    }

    const tag = /^\s*\[([a-z ]*)\]/i.exec(source.slice(i));
    if (tag) {
      const flags = tag[1].toLowerCase().split(/\s+/);
      filter.caseSensitive = flags.includes('case');
      filter.useRegex = flags.includes('regex');
      i += tag[0].length;
    }
    tokens.push({ type: 'FILTER', filter });
  }

  const filters = tokens.filter((t) => t.type === 'FILTER').map((t) => t.filter);
  if (filters.length === 0) return { error: 'No filters found in that text.' };

  const grouped = tokens.some((t) => t.type === '(' || t.type === ')');
  if (!grouped) {
    let expectFilter = true;
    for (const token of tokens) {
      if (expectFilter !== (token.type === 'FILTER')) return { error: 'Filters and AND/OR must alternate.' };
      expectFilter = !expectFilter;
    }
    if (expectFilter) return { error: 'The text ends with AND/OR.' };
    tokens.forEach((token, idx) => {
      if (token.type === 'FILTER' && idx > 0) token.filter.connector = tokens[idx - 1].type;
    });
    return { filters, logic: '' };
  }

  const logic = tokens.map((t) => (t.type === 'FILTER' ? describeFilter(t.filter, fields) : t.type))
    .join(' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');
  const state = parseFilterLogic(logic, filters, fields);
  if (!state.valid) return { error: state.error };
  return { filters, logic };
}

export function remapFilterLogic(logic, oldFilters, nextFilters, fields = FIELDS) {
  if (!logic?.trim()) return logic;

  let nextLogic = logic;
  for (const oldFilter of oldFilters) {
    const nextFilter = nextFilters.find((filter) => filter.id === oldFilter.id);
    if (!nextFilter) continue;
    const oldText = describeFilter(oldFilter, fields);
    const nextText = describeFilter(nextFilter, fields);
    if (oldText === nextText) continue;
    nextLogic = nextLogic.split(oldText).join(nextText);
  }
  return nextLogic;
}

// ── Filter matching ───────────────────────────────────────────────────────────

/**
 * `options.vocabulary` (from parseSearchVocabulary) widens text searches to
 * aliases and, for places, to what's inside them. `options.fields` is the field
 * list the logic text was written against (FIELDS unless said otherwise).
 */
export function applyFilters(entries, filters, categories, logic = '', options = {}) {
  // Ignore filters whose value is empty and the op needs one
  const parsed = parseFilterLogic(logic, filters, options.fields || FIELDS);
  if (!parsed.valid) return applyFilters(entries, filters, categories, '', options);
  if (!parsed.ast) return entries;

  const catMap = makeCategoryMap(categories);
  const vocabulary = options.vocabulary || null;
  return entries.filter((entry) => evalFilterAstWithCatMap(parsed.ast, entry, filters, catMap, vocabulary));
}

/**
 * Returns a space-joined string of ALL ancestor category names for an entry,
 * including the direct parent. Uses entry.categories (precomputed ancestor UUID list).
 */
function allCatNamesStr(entry, catMap) {
  return categoryNames(entry, catMap).join(' ');
}

function categoryNameForUuid(uuid, catMap) {
  if (!uuid) return '';
  const category = catMap.get(uuid);
  return typeof category === 'string' ? category : category?.restaurantName || '';
}

function categoryNames(entry, catMap) {
  const names = [];
  const seenUuids = new Set();

  function addName(category) {
    const name = typeof category === 'string' ? category : category?.restaurantName;
    if (name) names.push(name);
  }

  function addCategoryPath(uuid) {
    let current = uuid;
    while (current && !seenUuids.has(current)) {
      seenUuids.add(current);
      const category = catMap.get(current);
      if (!category) break;
      addName(category);
      current = typeof category === 'string' ? '' : category.ratingCategory;
    }
  }

  addCategoryPath(entry.ratingCategory);
  for (const uuid of Array.isArray(entry.categories) ? entry.categories : []) {
    addCategoryPath(uuid);
  }

  return names;
}

function makeCategoryMap(categories) {
  return categories instanceof Map
    ? categories
    : new Map(categories.map((c) => [c.uuid, c]));
}

function matchFilter(entry, filter, catMap, vocabulary = null) {
  const { field, op, value, caseSensitive, useRegex } = filter;
  // Regex is you saying exactly what you mean, so it's never widened.
  const extras = useRegex ? [] : expandSearchTerm(vocabulary, value, field);

  // Date field: compare ms timestamps against a YYYY-MM-DD date input
  if (field === 'dateRated') {
    const ms = entry.dateRated;
    if (op === 'isEmpty') return ms == null;
    if (op === 'isNotEmpty') return ms != null;
    if (!value) return false;
    // Compare by date only (strip time from the entry's timestamp)
    const entryDate = new Date(ms);
    const entryStr = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`;
    if (op === 'dateOn') return entryStr === value;
    if (op === 'dateBefore') return entryStr < value;
    if (op === 'dateAfter') return entryStr > value;
    return false;
  }

  // Rating field: numeric comparison against entry.score
  if (field === 'score') {
    const score = entry.score != null ? parseFloat(entry.score) : NaN;
    if (op === 'isEmpty') return !Number.isFinite(score);
    if (op === 'isNotEmpty') return Number.isFinite(score);
    if (!Number.isFinite(score)) return false;
    const target = parseFloat(value);
    if (!Number.isFinite(target)) return false;
    if (op === 'ratingEquals') return score === target;
    if (op === 'ratingNotEquals') return score !== target;
    if (op === 'ratingGreater') return score > target;
    if (op === 'ratingGreaterOrEqual') return score >= target;
    if (op === 'ratingLess') return score < target;
    if (op === 'ratingLessOrEqual') return score <= target;
    return false;
  }

  // UUID field: exact match only (no partial substring matching)
  if (field === 'uuid') {
    const uuid = String(entry.uuid ?? '');
    if (op === 'isEmpty') return !uuid.trim();
    if (op === 'isNotEmpty') return !!uuid.trim();
    const h = caseSensitive ? uuid : uuid.toLowerCase();
    const n = caseSensitive ? value : value.toLowerCase();
    if (op === 'notContains') return h !== n;
    return h === n;
  }

  if (field === 'any') {
    if (op === 'isEmpty' || op === 'isNotEmpty') {
      const rawStr = [entry.restaurantName, entry.specifier, entry.location, entry.additionalInfo,
        allCatNamesStr(entry, catMap), entry.score != null ? String(entry.score) : ''].join(' ');
      return op === 'isEmpty' ? !rawStr.trim() : !!rawStr.trim();
    }
    // Check all normal fields first
    const dataStr = [entry.restaurantName, entry.specifier, entry.location, entry.additionalInfo,
      allCatNamesStr(entry, catMap), entry.score != null ? String(entry.score) : ''].join(' ');
    const dataMatch = testText(dataStr, op, value, caseSensitive, useRegex, extras);
    // UUID: exact match only in normal mode, regex match in regex mode
    const uuid = String(entry.uuid ?? '');
    const uuidMatch = useRegex
      ? testString(uuid, op, value, caseSensitive, useRegex)
      : (caseSensitive ? uuid : uuid.toLowerCase()) === (caseSensitive ? value : value.toLowerCase());
    if (op === 'notContains') return dataMatch && !uuidMatch;
    return dataMatch || uuidMatch;
  }

  if (field === 'ratingCategory') {
    const names = categoryNames(entry, catMap);
    if (op === 'isEmpty') return names.length === 0;
    if (op === 'isNotEmpty') return names.length > 0;
    if (op === 'equals') {
      return testText(categoryNameForUuid(entry.ratingCategory, catMap), op, value, caseSensitive, useRegex, extras);
    }
    if (op === 'notContains') {
      return names.every((name) => testText(name, op, value, caseSensitive, useRegex, extras));
    }
    return testText(names.join(' '), op, value, caseSensitive, useRegex, extras);
  }

  const rawStr = String(entry[field] ?? '');

  if (op === 'isEmpty') return !rawStr.trim();
  if (op === 'isNotEmpty') return !!rawStr.trim();

  // A location is usually a list, most specific first — "16th, Denver" — so
  // Location = "Denver" means any one of its parts is Denver, not the whole.
  if (field === 'location' && op === 'equals' && !useRegex) {
    return locationParts(rawStr).some((part) => testText(part, op, value, caseSensitive, false, extras));
  }

  return testText(rawStr, op, value, caseSensitive, useRegex, extras);
}

function locationParts(location) {
  const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
  return [location, ...parts];
}

/** testString, widened to the vocabulary's extra names (matched as whole words). */
function testText(haystack, op, needle, caseSensitive, useRegex, extraTerms = []) {
  if (useRegex || extraTerms.length === 0) return testString(haystack, op, needle, caseSensitive, useRegex);
  const positiveOp = op === 'notContains' ? 'contains' : op;
  const hit = testString(haystack, positiveOp, needle, caseSensitive, false)
    || extraTerms.some((term) => matchesTerm(haystack, positiveOp, term));
  return op === 'notContains' ? !hit : hit;
}

function matchesTerm(haystack, op, term) {
  const h = normalizeTerm(haystack);
  if (op === 'equals') return h === term;
  // Whole words only: a short alias like "CS" must not turn up inside "Pecs".
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(h);
}

function testString(haystack, op, needle, caseSensitive, useRegex) {
  if (useRegex) {
    let re;
    try {
      re = new RegExp(needle, caseSensitive ? '' : 'i');
    } catch {
      return false; // invalid regex → no match
    }
    if (op === 'notContains') return !re.test(haystack);
    return re.test(haystack);
  }

  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  if (op === 'contains') return h.includes(n);
  if (op === 'equals') return h === n;
  if (op === 'notContains') return !h.includes(n);
  return true;
}

// ── Value suggestions ─────────────────────────────────────────────────────────

const SUGGESTIBLE_FIELDS = new Set(['any', 'restaurantName', 'specifier', 'location', 'additionalInfo', 'ratingCategory']);

function suggestionValues(entry, field, catMap) {
  if (field === 'ratingCategory') return categoryNames(entry, catMap);
  if (field === 'any') {
    return [entry.restaurantName, entry.specifier, entry.location, ...categoryNames(entry, catMap)];
  }
  const value = String(entry[field] ?? '').trim();
  if (field === 'location' && value.includes(',')) return [value, ...locationParts(value).slice(1)];
  return [value];
}

/**
 * What's worth typing into a filter: the values of its field among the entries
 * every *other* filter still lets through, most common first. So with
 * Restaurant contains "In-N-Out" set, a Food Name filter suggests In-N-Out's
 * foods rather than every food ever rated.
 *
 * Counting is the expensive part and doesn't depend on what's typed, so it's
 * split out: build once per filter set, then narrow as you type.
 */
export function countFilterSuggestions(entries, filters, categories, filterId, options = {}) {
  const target = filters.find((f) => f.id === filterId);
  if (!target || !SUGGESTIBLE_FIELDS.has(target.field)) return [];
  const others = filters.filter((f) => f.id !== filterId);
  // Custom logic names the filter being edited, so it can't apply without it;
  // the others' plain AND/OR chain is the closest honest stand-in.
  const pool = applyFilters(entries, others, categories, '', options);
  const catMap = makeCategoryMap(categories);

  const counts = new Map(); // lowercased → { value, count }
  for (const entry of pool) {
    const seen = new Set();
    for (const raw of suggestionValues(entry, target.field, catMap)) {
      const value = String(raw ?? '').trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      const hit = counts.get(key);
      if (hit) hit.count++;
      else counts.set(key, { value, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function narrowFilterSuggestions(counted, typed, limit = 30) {
  const needle = String(typed ?? '').trim().toLowerCase();
  const matches = needle
    ? counted.filter((s) => s.value.toLowerCase().includes(needle) && s.value.toLowerCase() !== needle)
    : counted;
  return matches.slice(0, limit);
}
