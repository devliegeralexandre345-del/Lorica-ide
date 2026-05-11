// tests/aiConflictResolve.test.js
//
// Coverage for the Wave 61 conflict-resolver JSON parser. The
// network round-trip isn't tested — only the parser, which protects
// the editor from a malformed model reply being spliced into the file.

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiConflictResolve.js';

const { parseResolveJson } = __testing__;

const VALID = {
  replacement: 'const total = (a, b) => a + b;\nexport default total;',
  rationale: 'Both sides export the same function; kept the typed version.',
};

describe('parseResolveJson', () => {
  it('parses a clean payload', () => {
    const out = parseResolveJson(JSON.stringify(VALID));
    expect(out?.replacement).toContain('const total');
    expect(out?.rationale).toContain('typed');
  });

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify(VALID) + '\n```';
    expect(parseResolveJson(raw)?.replacement).toContain('const total');
  });

  it('extracts JSON from prose-wrapped output', () => {
    const raw = `Here's the merge:\n${JSON.stringify(VALID)}\nLet me know.`;
    expect(parseResolveJson(raw)?.replacement).toContain('const total');
  });

  it('returns null on non-string input', () => {
    expect(parseResolveJson(null)).toBeNull();
    expect(parseResolveJson(undefined)).toBeNull();
    expect(parseResolveJson(42)).toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseResolveJson('not json')).toBeNull();
    expect(parseResolveJson('{ broken')).toBeNull();
    expect(parseResolveJson('')).toBeNull();
  });

  it('returns null when replacement is missing or empty', () => {
    expect(parseResolveJson(JSON.stringify({ rationale: 'x' }))).toBeNull();
    expect(parseResolveJson(JSON.stringify({ replacement: '', rationale: 'x' }))).toBeNull();
  });

  it('returns null when replacement is not a string', () => {
    expect(parseResolveJson(JSON.stringify({ replacement: 42, rationale: 'x' }))).toBeNull();
    expect(parseResolveJson(JSON.stringify({ replacement: ['a', 'b'], rationale: 'x' }))).toBeNull();
  });

  it('treats missing rationale as empty string', () => {
    const noRationale = { replacement: 'foo' };
    expect(parseResolveJson(JSON.stringify(noRationale))?.rationale).toBe('');
  });

  it('trims whitespace from rationale but preserves replacement byte-for-byte', () => {
    const padded = { replacement: '  indent\n  body\n', rationale: '  why  ' };
    const out = parseResolveJson(JSON.stringify(padded));
    expect(out.rationale).toBe('why');
    // Replacement is spliced verbatim — preserving whitespace matters
    // for indentation-sensitive languages.
    expect(out.replacement).toBe('  indent\n  body\n');
  });
});
