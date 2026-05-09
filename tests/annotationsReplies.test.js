// tests/annotationsReplies.test.js
//
// Coverage for the Wave 20 reply additions to the annotations module:
// makeReply, ensureReplies, and the migration of legacy annotations
// (no `replies` array) into the new shape.

import { describe, it, expect } from 'vitest';
import {
  makeAnnotation,
  makeReply,
  ensureReplies,
} from '../src/utils/annotations.js';

describe('makeAnnotation', () => {
  it('initialises an empty replies array', () => {
    const a = makeAnnotation({ file: 'src/foo.js', line: 1 });
    expect(Array.isArray(a.replies)).toBe(true);
    expect(a.replies).toHaveLength(0);
  });
});

describe('makeReply', () => {
  it('produces a reply with id starting r_, defaulted text/author, timestamps', () => {
    const r = makeReply({ text: 'lgtm', author: 'alice' });
    expect(r.id).toMatch(/^r_/);
    expect(r.text).toBe('lgtm');
    expect(r.author).toBe('alice');
    expect(typeof r.createdAt).toBe('number');
    expect(r.createdAt).toBe(r.updatedAt);
  });

  it('coerces missing fields to empty strings rather than undefined', () => {
    const r = makeReply();
    expect(r.text).toBe('');
    expect(r.author).toBe('');
  });

  it('returns distinct ids on consecutive calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(makeReply({ text: 't' }).id);
    expect(ids.size).toBe(50);
  });
});

describe('ensureReplies', () => {
  it('adds replies: [] to legacy annotations missing the field', () => {
    const legacy = { id: 'a1', file: 'x', line: 1, text: '' };
    const migrated = ensureReplies(legacy);
    expect(Array.isArray(migrated.replies)).toBe(true);
    expect(migrated.replies).toHaveLength(0);
    // Original mustn't be mutated.
    expect(legacy.replies).toBeUndefined();
  });

  it('passes through annotations that already have a replies array', () => {
    const existing = { id: 'a1', file: 'x', line: 1, text: '', replies: [{ id: 'r1', text: 'hi' }] };
    const result = ensureReplies(existing);
    expect(result).toBe(existing);
  });

  it('returns the input unchanged for non-objects', () => {
    expect(ensureReplies(null)).toBe(null);
    expect(ensureReplies(42)).toBe(42);
  });
});
