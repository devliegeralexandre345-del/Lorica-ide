// tests/recentFiles.test.js
//
// Coverage for the Wave 49 recent-files persistence + the open/recent
// merger. We exercise the pure helper `mergeOpenAndRecent` here as
// well as the localStorage-backed `loadRecentFiles` / `recordFileOpen`
// pair against a mocked storage.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRecentFiles,
  recordFileOpen,
  clearRecentFiles,
  mergeOpenAndRecent,
} from '../src/utils/recentFiles.js';

// Vitest's jsdom env already provides localStorage — reset between tests.
beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

describe('mergeOpenAndRecent', () => {
  it('places currently-open files before recent ones', () => {
    const open = [
      { path: '/a/foo.js', name: 'foo.js' },
      { path: '/a/bar.js', name: 'bar.js' },
    ];
    const recent = [
      { path: '/a/baz.js', name: 'baz.js' },
      { path: '/a/bar.js', name: 'bar.js' }, // duplicate w/ open
    ];
    const out = mergeOpenAndRecent(open, recent);
    expect(out.map((e) => e.path)).toEqual(['/a/foo.js', '/a/bar.js', '/a/baz.js']);
    expect(out[0].open).toBe(true);
    expect(out[1].open).toBe(true);
    expect(out[2].open).toBe(false);
  });

  it('handles empty inputs without crashing', () => {
    expect(mergeOpenAndRecent([], [])).toEqual([]);
    expect(mergeOpenAndRecent(null, null)).toEqual([]);
  });

  it('skips entries missing a path', () => {
    const open = [{ name: 'broken' }, { path: '/a/foo.js', name: 'foo.js' }];
    const recent = [{ path: '/a/bar.js', name: 'bar.js' }];
    expect(mergeOpenAndRecent(open, recent).map((e) => e.path)).toEqual(['/a/foo.js', '/a/bar.js']);
  });

  it('dedupes recent entries against each other', () => {
    const recent = [
      { path: '/a/foo.js' },
      { path: '/a/foo.js' },
      { path: '/a/bar.js' },
    ];
    expect(mergeOpenAndRecent([], recent).map((e) => e.path)).toEqual(['/a/foo.js', '/a/bar.js']);
  });
});

describe('localStorage round-trip', () => {
  it('records a file open and reads it back', () => {
    recordFileOpen('/proj', { path: '/proj/a.js', name: 'a.js', extension: 'js' });
    const out = loadRecentFiles('/proj');
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('/proj/a.js');
    expect(out[0].name).toBe('a.js');
  });

  it('bumps a re-opened file to the top of the list', () => {
    recordFileOpen('/proj', { path: '/proj/a.js', name: 'a.js' });
    recordFileOpen('/proj', { path: '/proj/b.js', name: 'b.js' });
    recordFileOpen('/proj', { path: '/proj/a.js', name: 'a.js' });
    const out = loadRecentFiles('/proj').map((e) => e.path);
    expect(out).toEqual(['/proj/a.js', '/proj/b.js']);
  });

  it('namespaces history per project', () => {
    recordFileOpen('/p1', { path: '/p1/a.js', name: 'a.js' });
    recordFileOpen('/p2', { path: '/p2/b.js', name: 'b.js' });
    expect(loadRecentFiles('/p1').map((e) => e.path)).toEqual(['/p1/a.js']);
    expect(loadRecentFiles('/p2').map((e) => e.path)).toEqual(['/p2/b.js']);
  });

  it('caps history at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      recordFileOpen('/p', { path: `/p/file${i}.js`, name: `file${i}.js` });
    }
    expect(loadRecentFiles('/p')).toHaveLength(50);
  });

  it('clearRecentFiles wipes the project history', () => {
    recordFileOpen('/p', { path: '/p/a.js', name: 'a.js' });
    clearRecentFiles('/p');
    expect(loadRecentFiles('/p')).toEqual([]);
  });

  it('falls back to empty list on malformed storage', () => {
    localStorage.setItem('lorica.recentFiles./p', 'not json');
    expect(loadRecentFiles('/p')).toEqual([]);
  });

  it('ignores entries missing a path field in storage', () => {
    localStorage.setItem(
      'lorica.recentFiles./p',
      JSON.stringify([{ name: 'orphan' }, { path: '/p/a.js', name: 'a.js' }]),
    );
    const out = loadRecentFiles('/p');
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('/p/a.js');
  });

  it('silently ignores missing or non-object input to recordFileOpen', () => {
    recordFileOpen('/p', null);
    recordFileOpen('/p', {});
    recordFileOpen('/p', { name: 'x' });
    expect(loadRecentFiles('/p')).toEqual([]);
  });

  it('drops entries older than the 30-day TTL', () => {
    // Wave 60 — write a hand-built history with one stale + one fresh.
    const stale = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const fresh = Date.now() - 1 * 24 * 60 * 60 * 1000;
    localStorage.setItem('lorica.recentFiles./p', JSON.stringify([
      { path: '/p/old.js', name: 'old.js', ts: stale },
      { path: '/p/new.js', name: 'new.js', ts: fresh },
    ]));
    const out = loadRecentFiles('/p');
    expect(out.map((e) => e.path)).toEqual(['/p/new.js']);
  });

  it('keeps entries with no timestamp (pre-Wave-60 history is preserved)', () => {
    localStorage.setItem('lorica.recentFiles./p', JSON.stringify([
      { path: '/p/legacy.js', name: 'legacy.js' }, // no ts
    ]));
    const out = loadRecentFiles('/p');
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('/p/legacy.js');
  });

  it('accepts an explicit `now` override for deterministic TTL testing', () => {
    const t = 100_000_000;
    localStorage.setItem('lorica.recentFiles./p', JSON.stringify([
      { path: '/p/older.js', name: 'older.js', ts: t - 31 * 24 * 60 * 60 * 1000 },
      { path: '/p/younger.js', name: 'younger.js', ts: t - 1000 },
    ]));
    const out = loadRecentFiles('/p', { now: t });
    expect(out.map((e) => e.path)).toEqual(['/p/younger.js']);
  });
});
