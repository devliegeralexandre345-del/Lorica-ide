// tests/conflictMarkers.test.js
//
// Coverage for findConflicts + resolveBlock — the parser that powers
// inline "Resolve with AI / Keep ours / Keep theirs" toolbars on git
// merge conflicts (Wave 1).

import { describe, it, expect } from 'vitest';
import { findConflicts, resolveBlock } from '../src/utils/conflictMarkers.js';

describe('findConflicts', () => {
  it('returns [] for empty / null / wrong-type inputs', () => {
    expect(findConflicts('')).toEqual([]);
    expect(findConflicts(null)).toEqual([]);
    expect(findConflicts(undefined)).toEqual([]);
    expect(findConflicts(42)).toEqual([]);
    expect(findConflicts({})).toEqual([]);
  });

  it('returns [] when there is no conflict marker', () => {
    expect(findConflicts('const x = 1;\nconst y = 2;\n')).toEqual([]);
  });

  it('parses a single simple conflict', () => {
    const doc = [
      'before',
      '<<<<<<< HEAD',
      'ours-1',
      'ours-2',
      '=======',
      'theirs-1',
      '>>>>>>> feature',
      'after',
    ].join('\n');

    const blocks = findConflicts(doc);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.startLine).toBe(2);
    expect(b.endLine).toBe(7);
    expect(b.oursLabel).toBe('HEAD');
    expect(b.theirsLabel).toBe('feature');
    expect(doc.slice(b.oursStart, b.oursEnd)).toBe('ours-1\nours-2\n');
    expect(doc.slice(b.theirsStart, b.theirsEnd)).toBe('theirs-1\n');
  });

  it('handles diff3 ancestor block (||||||| section is not part of ours)', () => {
    const doc = [
      '<<<<<<< HEAD',
      'ours',
      '||||||| ancestor',
      'base',
      '=======',
      'theirs',
      '>>>>>>> branch',
    ].join('\n');

    const blocks = findConflicts(doc);
    expect(blocks).toHaveLength(1);
    expect(doc.slice(blocks[0].oursStart, blocks[0].oursEnd)).toBe('ours\n');
    expect(doc.slice(blocks[0].theirsStart, blocks[0].theirsEnd)).toBe('theirs\n');
  });

  it('finds multiple non-overlapping conflicts in the same file', () => {
    const doc = [
      '<<<<<<< HEAD',
      'a-ours',
      '=======',
      'a-theirs',
      '>>>>>>> b1',
      'mid',
      '<<<<<<< HEAD',
      'b-ours',
      '=======',
      'b-theirs',
      '>>>>>>> b2',
    ].join('\n');

    const blocks = findConflicts(doc);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].theirsLabel).toBe('b1');
    expect(blocks[1].theirsLabel).toBe('b2');
  });

  it('skips a block whose closing >>>>>>> never arrives', () => {
    const doc = [
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      // missing >>>>>>>
    ].join('\n');
    expect(findConflicts(doc)).toHaveLength(0);
  });

  it('skips when ======= is missing', () => {
    const doc = [
      '<<<<<<< HEAD',
      'ours-no-sep',
      '>>>>>>> branch',
    ].join('\n');
    expect(findConflicts(doc)).toHaveLength(0);
  });

  it('handles a nested <<<<<<< by skipping the outer block', () => {
    const doc = [
      '<<<<<<< outer',     // outer skipped (nested inner)
      '<<<<<<< inner',
      'inner-ours',
      '=======',
      'inner-theirs',
      '>>>>>>> inner-branch',
      '=======',
      'outer-theirs',
      '>>>>>>> outer-branch',
    ].join('\n');

    const blocks = findConflicts(doc);
    // Outer skipped, inner parsed.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].oursLabel).toBe('inner');
    expect(blocks[0].theirsLabel).toBe('inner-branch');
  });

  it('falls back to "ours"/"theirs" when marker labels are absent', () => {
    const doc = [
      '<<<<<<<',
      'a',
      '=======',
      'b',
      '>>>>>>>',
    ].join('\n');
    const b = findConflicts(doc)[0];
    expect(b.oursLabel).toBe('ours');
    expect(b.theirsLabel).toBe('theirs');
  });
});

describe('resolveBlock', () => {
  const doc = [
    '<<<<<<< HEAD',
    'ours-line',
    '=======',
    'theirs-line',
    '>>>>>>> feature',
  ].join('\n');
  const block = findConflicts(doc)[0];

  it('action="ours" returns just the ours body', () => {
    expect(resolveBlock(doc, block, 'ours')).toBe('ours-line\n');
  });

  it('action="theirs" returns just the theirs body', () => {
    expect(resolveBlock(doc, block, 'theirs')).toBe('theirs-line\n');
  });

  it('action="both" stacks ours then theirs', () => {
    expect(resolveBlock(doc, block, 'both')).toBe('ours-line\ntheirs-line\n');
  });

  it('unknown action returns the original block (safe no-op)', () => {
    expect(resolveBlock(doc, block, 'banana')).toBe(doc.slice(block.start, block.end));
  });
});
