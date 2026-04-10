/**
 * Evaluate math expressions embedded in text using {expr} syntax.
 * Only allows safe characters: digits, decimal points, basic operators
 * (+, -, *, /, %, **), parentheses, and whitespace.
 * The raw string (with braces) is always what gets stored.
 * This function is only used for display.
 *
 * Example: "protein ratio was {20/200}" → "protein ratio was 0.1"
 */
export function evalAdditionalInfo(text) {
  if (!text) return text;
  return text.replace(/\{([^}]*)\}/g, (match, expr) => {
    const trimmed = expr.trim();
    if (!trimmed) return match;
    // Whitelist: digits, decimal point, basic operators, parens, spaces only
    if (!/^[\d\s+\-*/.()%]+$/.test(trimmed)) return match;
    try {
      // eslint-disable-next-line no-new-func
      const result = new Function('"use strict"; return (' + trimmed + ')')();
      if (typeof result !== 'number' || !isFinite(result)) return match;
      // Round to 2 decimal places; parseFloat strips trailing zeros
      // e.g. {1/3} → "0.33", {20/200} → "0.1", {1} → "1"
      return parseFloat(result.toFixed(2)).toString();
    } catch {
      return match;
    }
  });
}

/**
 * Returns true if the text contains at least one {expr} pattern.
 */
export function hasExpressions(text) {
  return /\{[^}]+\}/.test(text || '');
}
