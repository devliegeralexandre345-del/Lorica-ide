// tests/aiNameSuggestions.test.js
//
// Coverage for the Wave 64 naming-suggestions JSON parser. The
// network round-trip isn't tested — only the parser, which is the
// thing protecting the editor from a malformed model reply being
// applied as an identifier.

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiNameSuggestions.js';

const { parseNameJson } = __testing__;

const ONE = { name: 'totalCount', rationale: 'Clearer intent than `c`.' };
const TWO = { name: 'productList', rationale: 'Plural matches the array semantic.' };
const THREE = { name: 'isReady', rationale: 'Boolean prefix per convention.' };

describe('parseNameJson', () => {
  it('parses a clean three-suggestion payload', () => {
    const out = parseNameJson(JSON.stringify({ suggestions: [ONE, TWO, THREE] }));
    expect(out?.suggestions).toHaveLength(3);
    expect(out.suggestions[0].name).toBe('totalCount');
    expect(out.suggestions[2].rationale).toMatch(/Boolean/);
  });

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify({ suggestions: [ONE] }) + '\n```';
    expect(parseNameJson(raw)?.suggestions[0].name).toBe('totalCount');
  });

  it('returns null on non-string input', () => {
    expect(parseNameJson(null)).toBeNull();
    expect(parseNameJson(undefined)).toBeNull();
    expect(parseNameJson(42)).toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseNameJson('not json')).toBeNull();
    expect(parseNameJson('')).toBeNull();
    expect(parseNameJson('{ unclosed')).toBeNull();
  });

  it('returns null when suggestions is missing or empty', () => {
    expect(parseNameJson(JSON.stringify({}))).toBeNull();
    expect(parseNameJson(JSON.stringify({ suggestions: [] }))).toBeNull();
    expect(parseNameJson(JSON.stringify({ suggestions: null }))).toBeNull();
  });

  it('drops entries with empty names', () => {
    const out = parseNameJson(JSON.stringify({
      suggestions: [ONE, { name: '', rationale: 'x' }, TWO],
    }));
    expect(out?.suggestions).toHaveLength(2);
    expect(out.suggestions.map((s) => s.name)).toEqual(['totalCount', 'productList']);
  });

  it('drops entries with whitespace in the name (would break the splice)', () => {
    const out = parseNameJson(JSON.stringify({
      suggestions: [
        ONE,
        { name: 'multi word name', rationale: 'no good' },
        { name: 'okName', rationale: 'fine' },
      ],
    }));
    expect(out?.suggestions.map((s) => s.name)).toEqual(['totalCount', 'okName']);
  });

  it('drops entries with non-string name', () => {
    const out = parseNameJson(JSON.stringify({
      suggestions: [ONE, { name: 42, rationale: 'bad' }],
    }));
    expect(out?.suggestions).toHaveLength(1);
  });

  it('treats missing rationale as empty string', () => {
    const noRationale = { name: 'foo' };
    const out = parseNameJson(JSON.stringify({ suggestions: [noRationale] }));
    expect(out?.suggestions[0].rationale).toBe('');
  });

  it('trims whitespace from name and rationale', () => {
    const padded = { name: '  foo  ', rationale: '  why  ' };
    const out = parseNameJson(JSON.stringify({ suggestions: [padded] }));
    expect(out.suggestions[0].name).toBe('foo');
    expect(out.suggestions[0].rationale).toBe('why');
  });

  it('returns null if every entry is invalid', () => {
    const out = parseNameJson(JSON.stringify({
      suggestions: [{ name: '' }, { name: 'a b' }],
    }));
    expect(out).toBeNull();
  });
});
