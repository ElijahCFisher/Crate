import { describe, it, expect } from 'vitest';
import { evalAdditionalInfo, hasExpressions } from './mathUtils';

describe('evalAdditionalInfo', () => {
  it('evaluates a simple division', () => {
    expect(evalAdditionalInfo('ratio {20/200}')).toBe('ratio 0.1');
  });

  it('evaluates a simple multiplication', () => {
    expect(evalAdditionalInfo('{5*4}')).toBe('20');
  });

  it('evaluates addition', () => {
    expect(evalAdditionalInfo('{100+50}')).toBe('150');
  });

  it('evaluates subtraction', () => {
    expect(evalAdditionalInfo('{10-3}')).toBe('7');
  });

  it('evaluates exponentiation (**)', () => {
    expect(evalAdditionalInfo('{2**8}')).toBe('256');
  });

  it('evaluates modulo (%)', () => {
    expect(evalAdditionalInfo('{10%3}')).toBe('1');
  });

  it('evaluates parenthesized expressions', () => {
    expect(evalAdditionalInfo('{(2+3)*4}')).toBe('20');
  });

  it('rounds to 2 decimal places', () => {
    expect(evalAdditionalInfo('{1/3}')).toBe('0.33');
  });

  it('strips trailing zeros after decimal', () => {
    expect(evalAdditionalInfo('{1/4}')).toBe('0.25');
    expect(evalAdditionalInfo('{1/2}')).toBe('0.5');
  });

  it('evaluates integer result without decimals', () => {
    expect(evalAdditionalInfo('{4/2}')).toBe('2');
  });

  it('replaces multiple expressions in one string', () => {
    expect(evalAdditionalInfo('{1+1} and {2*3}')).toBe('2 and 6');
  });

  it('leaves text outside braces unchanged', () => {
    expect(evalAdditionalInfo('protein: {20/200}, total: 200g')).toBe('protein: 0.1, total: 200g');
  });

  it('leaves expression unchanged when it contains unsafe characters', () => {
    expect(evalAdditionalInfo('{alert(1)}')).toBe('{alert(1)}');
  });

  it('leaves expression unchanged when it contains letters', () => {
    expect(evalAdditionalInfo('{Math.PI}')).toBe('{Math.PI}');
  });

  it('leaves empty braces unchanged', () => {
    expect(evalAdditionalInfo('{}')).toBe('{}');
  });

  it('leaves division by zero unchanged (Infinity is not finite)', () => {
    expect(evalAdditionalInfo('{1/0}')).toBe('{1/0}');
  });

  it('leaves expression unchanged when evaluation throws (e.g. syntax error in expr)', () => {
    // {.} passes the whitelist but `return (.)` is a SyntaxError → hits catch block
    expect(evalAdditionalInfo('{.}')).toBe('{.}');
  });

  it('leaves NaN-producing expressions unchanged', () => {
    expect(evalAdditionalInfo('{0/0}')).toBe('{0/0}');
  });

  it('returns null as-is', () => {
    expect(evalAdditionalInfo(null)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(evalAdditionalInfo(undefined)).toBeUndefined();
  });

  it('returns empty string unchanged', () => {
    expect(evalAdditionalInfo('')).toBe('');
  });

  it('handles whitespace inside braces', () => {
    expect(evalAdditionalInfo('{ 20 / 200 }')).toBe('0.1');
  });

  it('handles decimal numbers', () => {
    expect(evalAdditionalInfo('{0.5 + 0.5}')).toBe('1');
  });
});

describe('hasExpressions', () => {
  it('returns true when text contains a {expr}', () => {
    expect(hasExpressions('ratio {20/200}')).toBe(true);
  });

  it('returns true for multiple expressions', () => {
    expect(hasExpressions('{1} and {2}')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(hasExpressions('no expression here')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasExpressions('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(hasExpressions(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasExpressions(undefined)).toBe(false);
  });

  it('returns false for empty braces {}', () => {
    // {} has no content between braces so /\{[^}]+\}/ does not match
    expect(hasExpressions('{}')).toBe(false);
  });

  it('returns true for braces with at least one character', () => {
    expect(hasExpressions('{x}')).toBe(true);
  });
});
