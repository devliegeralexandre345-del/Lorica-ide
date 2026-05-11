// tests/aiDocGenerator.test.js
//
// Coverage for the Wave 45 doc-generator's output cleaner. The
// network round-trip itself isn't tested — we only verify that a
// model wrapping its whole reply in a stray code fence gets unwrapped
// (and that legitimate inner fences are preserved).

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiDocGenerator.js';

const { cleanOutput } = __testing__;

describe('cleanOutput', () => {
  it('passes a clean markdown reply through unchanged', () => {
    const md = '# Module\n\nDoes things.\n\n## Public API\n\nNo public API yet.';
    expect(cleanOutput(md)).toBe(md);
  });

  it('strips a ```markdown wrapper that envelopes the whole reply', () => {
    const md = '# Module\n\nDoes things.';
    const wrapped = '```markdown\n' + md + '\n```';
    expect(cleanOutput(wrapped)).toBe(md);
  });

  it('strips a ```md wrapper that envelopes the whole reply', () => {
    const md = '# Module\n\nDoes things.';
    const wrapped = '```md\n' + md + '\n```';
    expect(cleanOutput(wrapped)).toBe(md);
  });

  it('strips a bare ``` wrapper that envelopes the whole reply', () => {
    const md = '# Module\n\nDoes things.';
    const wrapped = '```\n' + md + '\n```';
    expect(cleanOutput(wrapped)).toBe(md);
  });

  it('preserves inner code fences (legitimate example blocks)', () => {
    const md = [
      '# Module',
      '',
      '## Examples',
      '',
      '```js',
      'foo(1)',
      '```',
      '',
      'And another:',
      '',
      '```python',
      'foo(2)',
      '```',
    ].join('\n');
    const out = cleanOutput(md);
    expect(out).toContain('```js');
    expect(out).toContain('```python');
    expect(out).toContain('foo(1)');
    expect(out).toContain('foo(2)');
  });

  it('strips outer fence even when inner fences are present', () => {
    const inner = [
      '# Module',
      '',
      '```js',
      'foo()',
      '```',
    ].join('\n');
    const wrapped = '```markdown\n' + inner + '\n```';
    const out = cleanOutput(wrapped);
    // Outer fence is gone — text starts with `# Module`, not "```markdown".
    expect(out.startsWith('# Module')).toBe(true);
    // Inner JS fence is preserved.
    expect(out).toContain('```js\nfoo()');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanOutput('\n\n  # Hello  \n\n')).toBe('# Hello');
  });

  it('returns empty string on null/undefined input', () => {
    expect(cleanOutput(null)).toBe('');
    expect(cleanOutput(undefined)).toBe('');
    expect(cleanOutput('')).toBe('');
  });

  it('coerces non-string input to string', () => {
    expect(cleanOutput(42)).toBe('42');
  });

  it('does NOT strip when only the opening fence is present', () => {
    // Asymmetric wrap → leave it alone, the model output is unusual
    // but the inner content might still be useful as-is.
    const half = '```markdown\n# Module\nNo closing fence here.';
    expect(cleanOutput(half)).toBe(half);
  });
});
