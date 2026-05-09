// tests/parseDiffNewLineRanges.test.js
//
// Coverage for parseDiffNewLineRanges — the unified-diff parser that
// converts `git diff` text into post-image line ranges for the in-editor
// gutter (Wave 2). Pure string-in / array-out function.

import { describe, it, expect } from 'vitest';
import { parseDiffNewLineRanges } from '../src/extensions/gitDiffGutter.js';

describe('parseDiffNewLineRanges', () => {
  it('returns [] for empty / non-string input', () => {
    expect(parseDiffNewLineRanges('')).toEqual([]);
    expect(parseDiffNewLineRanges(null)).toEqual([]);
    expect(parseDiffNewLineRanges(undefined)).toEqual([]);
    expect(parseDiffNewLineRanges(42)).toEqual([]);
  });

  it('parses a single contiguous addition into one range', () => {
    const diff = [
      'diff --git a/foo.js b/foo.js',
      '--- a/foo.js',
      '+++ b/foo.js',
      '@@ -1,2 +1,4 @@',
      ' line1',
      '+added2',
      '+added3',
      ' line4',
    ].join('\n');
    const r = parseDiffNewLineRanges(diff);
    expect(r).toEqual([{ from: 2, to: 3 }]);
  });

  it('splits non-contiguous additions into separate ranges', () => {
    const diff = [
      '+++ b/foo.js',
      '@@ -1,5 +1,7 @@',
      ' a',
      '+added2',
      ' c',
      ' d',
      '+added5',
      '+added6',
      ' g',
    ].join('\n');
    const r = parseDiffNewLineRanges(diff);
    expect(r).toEqual([
      { from: 2, to: 2 },
      { from: 5, to: 6 },
    ]);
  });

  it('treats deletions as no-ops on the new line counter', () => {
    const diff = [
      '+++ b/foo.js',
      '@@ -1,3 +1,2 @@',
      ' a',
      '-removed',
      '+kept-replacement',
      ' c',
    ].join('\n');
    const r = parseDiffNewLineRanges(diff);
    // The replacement is on new-line 2.
    expect(r).toEqual([{ from: 2, to: 2 }]);
  });

  it('parses multiple hunks in one file', () => {
    const diff = [
      '+++ b/foo.js',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',
      '@@ -10,1 +11,2 @@',
      ' j',
      '+k',
    ].join('\n');
    const r = parseDiffNewLineRanges(diff);
    expect(r).toEqual([
      { from: 2, to: 2 },
      { from: 12, to: 12 },
    ]);
  });

  it('scopes to the requested file when targetFile is provided', () => {
    const diff = [
      '+++ b/other.js',
      '@@ -1,1 +1,2 @@',
      ' x',
      '+y',
      'diff --git a/foo.js b/foo.js',
      '+++ b/foo.js',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',
    ].join('\n');
    // Only foo.js's hunks should be reported.
    expect(parseDiffNewLineRanges(diff, 'foo.js')).toEqual([{ from: 2, to: 2 }]);
    expect(parseDiffNewLineRanges(diff, 'other.js')).toEqual([{ from: 2, to: 2 }]);
  });

  it('matches by suffix so absolute target paths also work', () => {
    const diff = [
      '+++ b/src/foo.js',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',
    ].join('\n');
    // Caller passes the absolute path — parser strips a/ b/ and checks suffix match.
    expect(parseDiffNewLineRanges(diff, '/abs/repo/src/foo.js')).toEqual([{ from: 2, to: 2 }]);
  });

  it('skips deletions to /dev/null (file removed)', () => {
    const diff = [
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-bye',
      '-bye',
    ].join('\n');
    expect(parseDiffNewLineRanges(diff)).toEqual([]);
  });

  it('handles quoted paths from git (special chars)', () => {
    const diff = [
      '+++ "b/path with space.js"',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',
    ].join('\n');
    expect(parseDiffNewLineRanges(diff, 'path with space.js')).toEqual([{ from: 2, to: 2 }]);
  });

  it('tolerates missing line counts in @@ header (defaults to 1)', () => {
    const diff = [
      '+++ b/foo.js',
      '@@ -1 +1 @@',
      '+only-line',
    ].join('\n');
    const r = parseDiffNewLineRanges(diff);
    expect(r).toEqual([{ from: 1, to: 1 }]);
  });
});
