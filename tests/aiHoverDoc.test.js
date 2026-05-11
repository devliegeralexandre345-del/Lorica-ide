// tests/aiHoverDoc.test.js
//
// Coverage for the Wave 55 hover-doc cache. The network round-trip in
// fetchHoverDoc isn't exercised — we only validate the cache key
// derivation + the public read/clear primitives.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearHoverDocCache,
  getCachedHoverDoc,
  __testing__,
} from '../src/utils/aiHoverDoc.js';

const { __cacheKey, CACHE } = __testing__;

beforeEach(() => { clearHoverDocCache(); });

describe('__cacheKey', () => {
  it('separates file from identifier with "::"', () => {
    expect(__cacheKey('foo.js', 'bar')).toBe('foo.js::bar');
  });

  it('tolerates missing file', () => {
    expect(__cacheKey(undefined, 'bar')).toBe('::bar');
    expect(__cacheKey(null, 'bar')).toBe('::bar');
    expect(__cacheKey('', 'bar')).toBe('::bar');
  });

  it('tolerates missing identifier', () => {
    expect(__cacheKey('foo.js', undefined)).toBe('foo.js::');
  });
});

describe('getCachedHoverDoc', () => {
  it('returns null when the cache is empty', () => {
    expect(getCachedHoverDoc('foo.js', 'bar')).toBeNull();
  });

  it('returns the cached text after a manual seed', () => {
    CACHE.set(__cacheKey('foo.js', 'bar'), { text: 'this is bar', at: Date.now() });
    expect(getCachedHoverDoc('foo.js', 'bar')).toBe('this is bar');
  });

  it('is scoped per file/identifier pair', () => {
    CACHE.set(__cacheKey('a.js', 'foo'), { text: 'A', at: Date.now() });
    CACHE.set(__cacheKey('b.js', 'foo'), { text: 'B', at: Date.now() });
    expect(getCachedHoverDoc('a.js', 'foo')).toBe('A');
    expect(getCachedHoverDoc('b.js', 'foo')).toBe('B');
    expect(getCachedHoverDoc('c.js', 'foo')).toBeNull();
  });
});

describe('clearHoverDocCache', () => {
  it('wipes every entry', () => {
    CACHE.set(__cacheKey('a.js', 'x'), { text: 'X', at: Date.now() });
    CACHE.set(__cacheKey('b.js', 'y'), { text: 'Y', at: Date.now() });
    clearHoverDocCache();
    expect(getCachedHoverDoc('a.js', 'x')).toBeNull();
    expect(getCachedHoverDoc('b.js', 'y')).toBeNull();
    expect(CACHE.size).toBe(0);
  });
});
