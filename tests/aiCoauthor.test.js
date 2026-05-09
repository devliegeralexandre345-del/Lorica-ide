// tests/aiCoauthor.test.js
//
// Pure-function coverage for the AI co-author trailer logic introduced
// in Wave 2. The src module also has localStorage-backed helpers
// (markAiEdit / shouldAppendTrailer) but those are integration concerns
// — the logic that *renders* the trailer line is pure and that's what
// users see in their commits.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  providerCoauthor,
  buildTrailer,
  appendTrailer,
  markAiEdit,
  msSinceLastAiEdit,
  isCoauthorTrailerEnabled,
  setCoauthorTrailerEnabled,
  shouldAppendTrailer,
  TIMESTAMP_KEY,
  TOGGLE_KEY,
  RECENCY_MS,
} from '../src/utils/aiCoauthor.js';

describe('providerCoauthor', () => {
  it('maps anthropic to Claude / noreply@anthropic.com', () => {
    expect(providerCoauthor('anthropic')).toEqual({ name: 'Claude', email: 'noreply@anthropic.com' });
  });

  it('maps deepseek to DeepSeek / noreply@deepseek.com', () => {
    expect(providerCoauthor('deepseek')).toEqual({ name: 'DeepSeek', email: 'noreply@deepseek.com' });
  });

  it('is case-insensitive', () => {
    expect(providerCoauthor('DeepSeek')).toEqual({ name: 'DeepSeek', email: 'noreply@deepseek.com' });
    expect(providerCoauthor('ANTHROPIC')).toEqual({ name: 'Claude', email: 'noreply@anthropic.com' });
  });

  it('falls back to Claude for unknown / undefined providers', () => {
    expect(providerCoauthor()).toEqual({ name: 'Claude', email: 'noreply@anthropic.com' });
    expect(providerCoauthor('mystery')).toEqual({ name: 'Claude', email: 'noreply@anthropic.com' });
    expect(providerCoauthor('')).toEqual({ name: 'Claude', email: 'noreply@anthropic.com' });
  });
});

describe('buildTrailer', () => {
  it('formats with the canonical "Co-authored-by:" prefix', () => {
    expect(buildTrailer({ name: 'Claude', email: 'noreply@anthropic.com' }))
      .toBe('Co-authored-by: Claude <noreply@anthropic.com>');
  });

  it('falls back to defaults when name/email are blank or missing', () => {
    expect(buildTrailer({})).toBe('Co-authored-by: Claude <noreply@anthropic.com>');
    expect(buildTrailer()).toBe('Co-authored-by: Claude <noreply@anthropic.com>');
    expect(buildTrailer({ name: '   ', email: '' }))
      .toBe('Co-authored-by: Claude <noreply@anthropic.com>');
  });

  it('trims surrounding whitespace from both fields', () => {
    expect(buildTrailer({ name: '  Claude  ', email: '  noreply@anthropic.com  ' }))
      .toBe('Co-authored-by: Claude <noreply@anthropic.com>');
  });
});

describe('appendTrailer', () => {
  it('appends a Co-authored-by trailer with a blank-line separator', () => {
    const out = appendTrailer('feat: add login', { name: 'Claude', email: 'noreply@anthropic.com' });
    expect(out).toBe('feat: add login\n\nCo-authored-by: Claude <noreply@anthropic.com>');
  });

  it('does not duplicate when the message already contains a matching trailer (case-insensitive)', () => {
    const msg = 'feat: ship\n\nCo-authored-by: claude <NOREPLY@ANTHROPIC.COM>';
    const out = appendTrailer(msg, { name: 'Claude', email: 'noreply@anthropic.com' });
    expect(out).toBe(msg);
  });

  it('still appends when the existing trailer points at a different identity', () => {
    const msg = 'feat: ship\n\nCo-authored-by: Someone <someone@example.com>';
    const out = appendTrailer(msg, { name: 'Claude', email: 'noreply@anthropic.com' });
    expect(out).toMatch(/Co-authored-by: Someone <someone@example\.com>/);
    expect(out).toMatch(/Co-authored-by: Claude <noreply@anthropic\.com>$/);
  });

  it('strips trailing whitespace before the separator', () => {
    const out = appendTrailer('feat: ship   \n\n  ', { name: 'Claude', email: 'noreply@anthropic.com' });
    // Must not collapse to 3+ blank lines or keep the trailing spaces.
    expect(out).toBe('feat: ship\n\nCo-authored-by: Claude <noreply@anthropic.com>');
  });

  it('handles empty / null messages', () => {
    expect(appendTrailer(null, { name: 'Claude', email: 'noreply@anthropic.com' }))
      .toBe('\n\nCo-authored-by: Claude <noreply@anthropic.com>');
    expect(appendTrailer('', { name: 'Claude', email: 'noreply@anthropic.com' }))
      .toBe('\n\nCo-authored-by: Claude <noreply@anthropic.com>');
  });

  it('uses the provider identity returned from providerCoauthor', () => {
    const id = providerCoauthor('deepseek');
    expect(appendTrailer('chore: tweak', id)).toMatch(/DeepSeek <noreply@deepseek\.com>$/);
  });
});

describe('markAiEdit / msSinceLastAiEdit / shouldAppendTrailer (localStorage round-trip)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records the timestamp under the expected key', () => {
    markAiEdit();
    const v = parseInt(localStorage.getItem(TIMESTAMP_KEY), 10);
    expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(Date.now() - v)).toBeLessThan(2000);
  });

  it('returns Infinity when no edit has been recorded', () => {
    expect(msSinceLastAiEdit()).toBe(Infinity);
  });

  it('returns Infinity for unparseable values', () => {
    localStorage.setItem(TIMESTAMP_KEY, 'not-a-number');
    expect(msSinceLastAiEdit()).toBe(Infinity);
  });

  it('shouldAppendTrailer requires both the toggle AND a recent edit', () => {
    expect(shouldAppendTrailer()).toBe(false);
    setCoauthorTrailerEnabled(true);
    expect(shouldAppendTrailer()).toBe(false); // toggle on but no recent edit
    markAiEdit();
    expect(shouldAppendTrailer()).toBe(true);
  });

  it('shouldAppendTrailer rejects edits older than RECENCY_MS', () => {
    setCoauthorTrailerEnabled(true);
    localStorage.setItem(TIMESTAMP_KEY, String(Date.now() - RECENCY_MS - 5000));
    expect(shouldAppendTrailer()).toBe(false);
  });

  it('isCoauthorTrailerEnabled round-trips correctly', () => {
    expect(isCoauthorTrailerEnabled()).toBe(false);
    setCoauthorTrailerEnabled(true);
    expect(isCoauthorTrailerEnabled()).toBe(true);
    expect(localStorage.getItem(TOGGLE_KEY)).toBe('true');
    setCoauthorTrailerEnabled(false);
    expect(isCoauthorTrailerEnabled()).toBe(false);
  });
});
