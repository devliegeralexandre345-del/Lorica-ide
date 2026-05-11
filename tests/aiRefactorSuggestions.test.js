// tests/aiRefactorSuggestions.test.js
//
// Coverage for the Wave 48 refactor-suggester's JSON parser. The
// network round-trip in suggestRefactors() isn't tested — only the
// parser, which is what protects us from a malformed model reply
// causing the modal to apply nonsense to the editor.

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiRefactorSuggestions.js';

const { parseSuggestionsJson } = __testing__;

const ONE = {
  title: 'Extract helper',
  rationale: 'Splits the inline reducer into a named pure function.',
  replacement: 'const reduce = (acc, x) => acc + x;\nreturn arr.reduce(reduce, 0);',
};
const TWO = {
  title: 'Use Array.sum',
  rationale: 'Built-in sum is clearer than a manual reduce.',
  replacement: 'return arr.reduce((a, b) => a + b, 0);',
};
const THREE = {
  title: 'Add typed return',
  rationale: 'Explicit return type improves IDE inference.',
  replacement: 'function total(arr: number[]): number { return arr.reduce((a, b) => a + b, 0); }',
};

describe('parseSuggestionsJson', () => {
  it('parses a clean three-suggestion payload', () => {
    const out = parseSuggestionsJson(JSON.stringify({ suggestions: [ONE, TWO, THREE] }));
    expect(out?.suggestions).toHaveLength(3);
    expect(out.suggestions[0].title).toBe('Extract helper');
    expect(out.suggestions[2].replacement).toContain('number');
  });

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify({ suggestions: [ONE, TWO] }) + '\n```';
    const out = parseSuggestionsJson(raw);
    expect(out?.suggestions).toHaveLength(2);
  });

  it('extracts JSON from prose-wrapped output', () => {
    const raw = `Here are 3 angles:\n${JSON.stringify({ suggestions: [ONE, TWO, THREE] })}\nLet me know.`;
    const out = parseSuggestionsJson(raw);
    expect(out?.suggestions).toHaveLength(3);
  });

  it('returns null on non-string input', () => {
    expect(parseSuggestionsJson(null)).toBeNull();
    expect(parseSuggestionsJson(undefined)).toBeNull();
    expect(parseSuggestionsJson(42)).toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseSuggestionsJson('not json')).toBeNull();
    expect(parseSuggestionsJson('{ broken')).toBeNull();
    expect(parseSuggestionsJson('')).toBeNull();
  });

  it('returns null when suggestions array is missing', () => {
    expect(parseSuggestionsJson(JSON.stringify({}))).toBeNull();
    expect(parseSuggestionsJson(JSON.stringify({ suggestions: null }))).toBeNull();
    expect(parseSuggestionsJson(JSON.stringify({ suggestions: 'string' }))).toBeNull();
  });

  it('returns null when suggestions array is empty', () => {
    expect(parseSuggestionsJson(JSON.stringify({ suggestions: [] }))).toBeNull();
  });

  it('drops entries missing required fields but keeps valid ones', () => {
    const out = parseSuggestionsJson(JSON.stringify({
      suggestions: [
        ONE,
        { title: '', replacement: 'x' },           // empty title → drop
        { title: 'A', replacement: '' },           // empty replacement → drop
        { title: 'B' },                            // no replacement → drop
        TWO,
      ],
    }));
    expect(out?.suggestions).toHaveLength(2);
    expect(out.suggestions.map((s) => s.title)).toEqual(['Extract helper', 'Use Array.sum']);
  });

  it('returns null if all entries are invalid', () => {
    const out = parseSuggestionsJson(JSON.stringify({
      suggestions: [{ title: '', replacement: '' }, { title: 'x' }],
    }));
    expect(out).toBeNull();
  });

  it('treats missing rationale as empty string', () => {
    const noRationale = { title: 'X', replacement: 'foo();' };
    const out = parseSuggestionsJson(JSON.stringify({ suggestions: [noRationale] }));
    expect(out?.suggestions[0].rationale).toBe('');
  });

  it('trims whitespace from title and rationale', () => {
    const padded = { title: '  Refactor X  ', rationale: '  why  ', replacement: 'code' };
    const out = parseSuggestionsJson(JSON.stringify({ suggestions: [padded] }));
    expect(out.suggestions[0].title).toBe('Refactor X');
    expect(out.suggestions[0].rationale).toBe('why');
  });
});
