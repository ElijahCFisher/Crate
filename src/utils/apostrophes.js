/**
 * Curly apostrophes (’ ‘) — from a phone keyboard's smart punctuation or text
 * pasted out of a doc — become straight ones as you type, so "Zaidy’s" and
 * "Zaidy's" are the same name everywhere: search, matching, suggestions. A
 * backslash in front keeps one curly on purpose ("\’").
 */
const CURLY = /(?<!\\)[‘’]/g;

export function straightenApostrophes(text) {
  return String(text ?? '').replace(CURLY, "'");
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel']);

function isTextField(el) {
  if (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) return true;
  return typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}

function handleInput(e) {
  const el = e.target;
  if (e.isComposing || !isTextField(el)) return;
  const fixed = straightenApostrophes(el.value);
  if (fixed === el.value) return;
  const { selectionStart, selectionEnd } = el;
  // Through the prototype's setter, not `el.value =`: React watches the
  // element's own value property to tell whether it changed, and setting it
  // that way would make this input look like no change at all.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, fixed);
  // One character for one, so the cursor stays where it was.
  try { el.setSelectionRange(selectionStart, selectionEnd); } catch { /* not every input type has a selection */ }
}

/**
 * Straighten apostrophes in every text field in the app. Listens in the
 * capture phase on the document, so the field's value is fixed before React's
 * own listener (on the app root) reads it into state. Returns an uninstaller.
 */
export function installApostropheStraightener(target = document) {
  target.addEventListener('input', handleInput, true);
  return () => target.removeEventListener('input', handleInput, true);
}
