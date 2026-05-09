// tests/annotationsExport.test.js
//
// Coverage for the Wave 39 markdown export. Pure-string in / pure-
// string out — no DOM, no clipboard. Pins the report shape so the
// downloaded `.md` stays predictable across releases.

import { describe, it, expect } from 'vitest';
import { exportAnnotationsToMarkdown } from '../src/utils/annotations.js';

const FIXED = new Date('2026-05-09T22:00:00.000Z');

describe('exportAnnotationsToMarkdown', () => {
  it('returns a "no annotations" stub when the list is empty', () => {
    const md = exportAnnotationsToMarkdown([], { projectName: 'lorica', generatedAt: FIXED });
    expect(md).toContain('# Annotations report — lorica');
    expect(md).toContain('_No annotations._');
  });

  it('groups by file and sorts entries by line', () => {
    const list = [
      { id: 'a1', file: 'src/foo.js', line: 30, color: 'amber', text: 'thirty' },
      { id: 'a2', file: 'src/bar.js', line: 10, color: 'rose',  text: 'ten on bar' },
      { id: 'a3', file: 'src/foo.js', line: 5,  color: 'blue',  text: 'five' },
      { id: 'a4', file: 'src/foo.js', line: 15, color: 'amber', text: 'fifteen' },
    ];
    const md = exportAnnotationsToMarkdown(list, { projectName: 'lorica', generatedAt: FIXED });
    // Each file section heading present.
    expect(md).toContain('## src/bar.js');
    expect(md).toContain('## src/foo.js');
    // foo.js entries sorted by line: 5 → 15 → 30
    const fooIdx = md.indexOf('## src/foo.js');
    const fiveIdx = md.indexOf('Line 5');
    const fifteenIdx = md.indexOf('Line 15');
    const thirtyIdx = md.indexOf('Line 30');
    expect(fiveIdx).toBeGreaterThan(fooIdx);
    expect(fifteenIdx).toBeGreaterThan(fiveIdx);
    expect(thirtyIdx).toBeGreaterThan(fifteenIdx);
  });

  it('renders author + pinned + remote tags on the heading', () => {
    const list = [
      { id: 'a1', file: 'a.js', line: 1, color: 'amber', text: 't', author: 'alice', pinned: true, _remote: true },
    ];
    const md = exportAnnotationsToMarkdown(list, { projectName: 'p', generatedAt: FIXED });
    expect(md).toMatch(/Line 1 — `amber` · @alice · 📌 · \(live-share\)/);
  });

  it('includes replies as a bulleted list under the parent note', () => {
    const list = [
      {
        id: 'a1', file: 'a.js', line: 1, color: 'amber', text: 'parent',
        replies: [
          { id: 'r1', text: 'first reply', author: 'bob', createdAt: FIXED.getTime(), updatedAt: FIXED.getTime() },
          { id: 'r2', text: 'second',     author: '',    createdAt: FIXED.getTime(), updatedAt: FIXED.getTime() },
        ],
      },
    ];
    const md = exportAnnotationsToMarkdown(list, { projectName: 'p', generatedAt: FIXED });
    expect(md).toMatch(/- _2026-05-09 22:00_ @bob: first reply/);
    expect(md).toMatch(/- _2026-05-09 22:00_ anonymous: second/);
  });

  it('strips redundant blank lines (no triple newlines)', () => {
    const list = [
      { id: 'a1', file: 'a.js', line: 1, color: 'amber', text: '', author: '', replies: [] },
      { id: 'a2', file: 'a.js', line: 2, color: 'amber', text: 'body', author: '', replies: [] },
    ];
    const md = exportAnnotationsToMarkdown(list, { projectName: 'p', generatedAt: FIXED });
    expect(md).not.toMatch(/\n\n\n/);
  });
});
