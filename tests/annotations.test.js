// tests/annotations.test.js
//
// Coverage for the annotation pure helpers (Wave 11.4). Persistence
// goes through window.lorica.fs which we don't mock here — only the
// pure data layer.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ANNOTATION_COLORS,
  newAnnotationId,
  makeAnnotation,
  normalizeFilePath,
  groupByFile,
} from '../src/utils/annotations.js';

describe('ANNOTATION_COLORS', () => {
  it('exposes 5 named variants', () => {
    expect(ANNOTATION_COLORS).toEqual(['amber', 'blue', 'rose', 'emerald', 'violet']);
  });
});

describe('newAnnotationId', () => {
  it('produces a string starting with a_ and a usable suffix', () => {
    const id = newAnnotationId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('a_')).toBe(true);
    expect(id.length).toBeGreaterThan(8);
  });

  it('returns distinct ids on consecutive calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(newAnnotationId());
    expect(ids.size).toBe(50);
  });
});

describe('makeAnnotation', () => {
  it('fills sensible defaults', () => {
    const a = makeAnnotation({ file: 'src/foo.js', line: 10 });
    expect(a.file).toBe('src/foo.js');
    expect(a.line).toBe(10);
    expect(a.text).toBe('');
    expect(a.color).toBe('amber');
    expect(a.author).toBe('');
    expect(a.pinned).toBe(false);
    expect(a.id).toMatch(/^a_/);
    expect(typeof a.createdAt).toBe('number');
    expect(a.createdAt).toBe(a.updatedAt);
  });

  it('clamps line to a minimum of 1', () => {
    expect(makeAnnotation({ file: 'a', line: 0 }).line).toBe(1);
    expect(makeAnnotation({ file: 'a', line: -10 }).line).toBe(1);
  });

  it('falls back to amber for an invalid color', () => {
    const a = makeAnnotation({ file: 'a', line: 1, color: 'fuchsia' });
    expect(a.color).toBe('amber');
  });
});

describe('normalizeFilePath', () => {
  it('returns empty string for falsy input', () => {
    expect(normalizeFilePath(null)).toBe('');
    expect(normalizeFilePath('')).toBe('');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizeFilePath('src\\foo\\bar.js')).toBe('src/foo/bar.js');
  });

  it('strips the project root prefix when given', () => {
    expect(normalizeFilePath('C:/repo/src/foo.js', 'C:/repo')).toBe('src/foo.js');
    expect(normalizeFilePath('C:\\repo\\src\\foo.js', 'C:/repo')).toBe('src/foo.js');
  });

  it('returns "." when the file IS the project root', () => {
    expect(normalizeFilePath('C:/repo', 'C:/repo')).toBe('.');
  });

  it('leaves the path unchanged when the project prefix does not match', () => {
    expect(normalizeFilePath('/other/foo.js', '/repo')).toBe('/other/foo.js');
  });
});

describe('groupByFile', () => {
  it('returns an empty object for empty / non-array input', () => {
    expect(groupByFile([])).toEqual({});
    expect(groupByFile(null)).toEqual({});
  });

  it('groups annotations by file and sorts by line', () => {
    const list = [
      { id: 'a1', file: 'src/foo.js', line: 30, text: 'a' },
      { id: 'a2', file: 'src/bar.js', line: 10, text: 'b' },
      { id: 'a3', file: 'src/foo.js', line: 5, text: 'c' },
      { id: 'a4', file: 'src/foo.js', line: 15, text: 'd' },
    ];
    const grouped = groupByFile(list);
    expect(Object.keys(grouped).sort()).toEqual(['src/bar.js', 'src/foo.js']);
    expect(grouped['src/foo.js'].map((a) => a.line)).toEqual([5, 15, 30]);
    expect(grouped['src/bar.js'].map((a) => a.line)).toEqual([10]);
  });

  it('skips entries without a file field', () => {
    const list = [
      { id: 'a1', file: 'src/foo.js', line: 1, text: '' },
      { id: 'bad', file: '', line: 2, text: '' },
      { id: 'bad2', line: 3, text: '' }, // missing file
    ];
    const grouped = groupByFile(list);
    expect(Object.keys(grouped)).toEqual(['src/foo.js']);
  });
});
