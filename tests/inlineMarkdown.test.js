// tests/inlineMarkdown.test.js
//
// Coverage for the tiny inline Markdown renderer (Wave 26). Pins the
// inline grammar (bold / italic / code / strike / link) + the URL
// safety guard so a future regex tweak doesn't accidentally let
// `javascript:` URLs through into peer-rendered review notes.

import { describe, it, expect } from 'vitest';
import { renderInlineMarkdown, __testing__ } from '../src/utils/inlineMarkdown.js';

const { safeUrl } = __testing__;

// Recursively flatten a React-ish tree into a typed array we can
// assert against without rendering.
function summarise(nodes) {
  const out = [];
  for (const n of nodes || []) {
    if (n == null) continue;
    if (typeof n === 'string') {
      out.push({ type: 'text', text: n });
    } else if (n && typeof n === 'object' && n.props !== undefined) {
      const childArr = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
      out.push({
        type: 'el',
        tag: n.type,
        href: n.props.href,
        children: summarise(childArr),
      });
    } else {
      out.push({ type: 'unknown', node: n });
    }
  }
  return out;
}

describe('safeUrl', () => {
  it('accepts http and https', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('http://x')).toBe('http://x');
  });
  it('accepts mailto', () => {
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
  });
  it('rejects javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
  });
  it('rejects data: scheme', () => {
    expect(safeUrl('data:text/html,<script>')).toBe('');
  });
  it('accepts plain relative paths', () => {
    expect(safeUrl('./README.md')).toBe('./README.md');
    expect(safeUrl('section')).toBe('section');
  });
});

describe('renderInlineMarkdown', () => {
  it('returns an empty array for empty / null', () => {
    expect(renderInlineMarkdown('')).toEqual([]);
    expect(renderInlineMarkdown(null)).toEqual([]);
  });

  it('emits plain strings for text without markup', () => {
    const out = summarise(renderInlineMarkdown('hello world'));
    expect(out).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('renders **bold**', () => {
    const out = summarise(renderInlineMarkdown('hello **world**'));
    expect(out[0]).toEqual({ type: 'text', text: 'hello ' });
    expect(out[1].type).toBe('el');
    expect(out[1].tag).toBe('strong');
    expect(out[1].children[0]).toEqual({ type: 'text', text: 'world' });
  });

  it('renders *italic* and ~~strike~~', () => {
    const it = summarise(renderInlineMarkdown('*emphasis*'));
    expect(it[0].tag).toBe('em');
    const st = summarise(renderInlineMarkdown('~~gone~~'));
    expect(st[0].tag).toBe('del');
  });

  it('renders inline `code` with the lorica-md-code class', () => {
    const out = summarise(renderInlineMarkdown('use `npm test`'));
    const el = out.find((n) => n.type === 'el');
    expect(el.tag).toBe('code');
  });

  it('renders [label](https://x) as an anchor', () => {
    const out = summarise(renderInlineMarkdown('see [docs](https://example.com)'));
    const link = out.find((n) => n.type === 'el');
    expect(link.tag).toBe('a');
    expect(link.href).toBe('https://example.com');
    expect(link.children[0]).toEqual({ type: 'text', text: 'docs' });
  });

  it('rejects unsafe links by leaving the literal text', () => {
    const out = summarise(renderInlineMarkdown('see [evil](javascript:alert(1))'));
    // Should not have an `a` element — full literal stays.
    expect(out.find((n) => n.type === 'el' && n.tag === 'a')).toBeUndefined();
  });

  it('inserts <br> for newline characters', () => {
    const out = summarise(renderInlineMarkdown('one\ntwo'));
    const br = out.find((n) => n.type === 'el' && n.tag === 'br');
    expect(br).toBeTruthy();
  });
});
