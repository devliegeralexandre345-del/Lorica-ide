// tests/aiCodebaseAnswer.test.js
//
// Coverage for the Wave 56 "Ask the codebase" snippet formatter. The
// real network call (`answerCodebaseQuestion`) isn't tested — only the
// pure `formatHits` helper that decides how snippets are chunked /
// budget-capped before they go into the model's user message.

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiCodebaseAnswer.js';

const { formatHits, MAX_TOTAL_CHARS, MAX_SNIPPET_LINES } = __testing__;

const baseHit = (path, start, snippet) => ({ path, start_line: start, snippet });

describe('formatHits', () => {
  it('formats one hit with a "--- path:line" header', () => {
    const out = formatHits([baseHit('a/b.js', 12, 'const x = 1;\nconst y = 2;')]);
    expect(out).toContain('--- a/b.js:12');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('const y = 2;');
  });

  it('joins multiple hits with a blank line between blocks', () => {
    const out = formatHits([
      baseHit('a.js', 1, 'A'),
      baseHit('b.js', 2, 'B'),
    ]);
    const aIdx = out.indexOf('--- a.js:1');
    const bIdx = out.indexOf('--- b.js:2');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('falls back to <unknown> when path is missing', () => {
    expect(formatHits([{ snippet: 'foo' }])).toContain('--- <unknown>:1');
  });

  it('uses h.relative when h.path is missing', () => {
    expect(formatHits([{ relative: 'src/foo.js', start_line: 5, snippet: 'x' }]))
      .toContain('--- src/foo.js:5');
  });

  it('clips each snippet to MAX_SNIPPET_LINES lines', () => {
    const big = Array.from({ length: MAX_SNIPPET_LINES + 50 }, (_, i) => `line ${i}`).join('\n');
    const out = formatHits([baseHit('big.js', 1, big)]);
    // The MAX_SNIPPET_LINES line is "line {MAX-1}"; anything beyond
    // should not appear.
    expect(out).toContain(`line ${MAX_SNIPPET_LINES - 1}`);
    expect(out).not.toContain(`line ${MAX_SNIPPET_LINES + 10}`);
  });

  it('drops later hits once MAX_TOTAL_CHARS is reached', () => {
    // 9 hits at ~5k chars each → first two fit, third pushes past 12k.
    const fatSnippet = 'x'.repeat(5000);
    const hits = Array.from({ length: 9 }, (_, i) => baseHit(`f${i}.js`, 1, fatSnippet));
    const out = formatHits(hits);
    expect(out).toContain('--- f0.js:1');
    expect(out).toContain('--- f1.js:1');
    expect(out).not.toContain('--- f5.js:1');
    expect(out.length).toBeLessThanOrEqual(MAX_TOTAL_CHARS + 200); // small slack
  });

  it('handles empty / null inputs without crashing', () => {
    expect(formatHits([])).toBe('');
    expect(formatHits(null)).toBe('');
    expect(formatHits(undefined)).toBe('');
  });

  it('falls back to "text" / "content" fields when snippet is missing', () => {
    expect(formatHits([{ path: 'a.js', start_line: 1, text: 'TEXT FIELD' }])).toContain('TEXT FIELD');
    expect(formatHits([{ path: 'b.js', start_line: 2, content: 'CONTENT FIELD' }])).toContain('CONTENT FIELD');
  });

  it('defaults missing start_line to 1', () => {
    expect(formatHits([{ path: 'a.js', snippet: 'foo' }])).toContain('--- a.js:1');
  });
});
