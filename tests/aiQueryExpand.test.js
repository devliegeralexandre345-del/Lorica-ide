// tests/aiQueryExpand.test.js
//
// Coverage for the Wave 41 query-expansion parser. The network call
// is integration-only; here we pin the JSON parse defensiveness so a
// hostile model output can't break semantic search.

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiQueryExpand.js';

const { parseQueriesJson } = __testing__;

describe('parseQueriesJson', () => {
  it('returns null for non-string input', () => {
    expect(parseQueriesJson(null)).toBeNull();
    expect(parseQueriesJson(undefined)).toBeNull();
    expect(parseQueriesJson(42)).toBeNull();
  });

  it('parses a clean JSON array', () => {
    expect(parseQueriesJson('["jwt validation", "session decode"]'))
      .toEqual(['jwt validation', 'session decode']);
  });

  it('strips ```json fences', () => {
    const raw = '```json\n["one", "two"]\n```';
    expect(parseQueriesJson(raw)).toEqual(['one', 'two']);
  });

  it('extracts the first array from prose-wrapped output', () => {
    const raw = 'Sure, here are 3:\n["a", "b", "c"]\nLet me know!';
    expect(parseQueriesJson(raw)).toEqual(['a', 'b', 'c']);
  });

  it('drops non-string entries silently', () => {
    expect(parseQueriesJson('["ok", 42, null, "fine"]'))
      .toEqual(['ok', 'fine']);
  });

  it('returns null when the array would be empty after filtering', () => {
    expect(parseQueriesJson('[42, null, true]')).toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseQueriesJson('totally not json')).toBeNull();
    expect(parseQueriesJson('{"not":"an array"}')).toBeNull();
  });

  it('trims whitespace inside entries', () => {
    expect(parseQueriesJson('["  hi  ", "  bye"]'))
      .toEqual(['hi', 'bye']);
  });
});
