// src/extensions/gitDiffGutter.js
//
// In-editor "git diff" gutter for CodeMirror.
//
// Two states are surfaced side-by-side so users can tell at a glance what
// is staged for commit vs. what is still pending:
//
//   • Unstaged-modified  → amber bar (var(--color-warning))
//   • Staged             → green  bar (var(--color-success))
//
// VS Code v1.100 (Apr 2025) ships the same distinction; this brings parity.
// Data is fed in via two state effects so the host (Editor.jsx) can refresh
// without rebuilding the editor when files change on disk or a stage/unstage
// happens elsewhere.
//
// Line-range shape:
//   { from: <1-indexed inclusive>, to: <1-indexed inclusive> }
// Caller computes the ranges from `git diff` / `git diff --cached` hunks
// against the post-image (i.e. the line numbers the user actually sees).

import { StateField, StateEffect } from '@codemirror/state';
import { gutter, GutterMarker, EditorView } from '@codemirror/view';

export const setUnstagedDiffEffect = StateEffect.define();
export const setStagedDiffEffect = StateEffect.define();

// Internal helper: turn an array of {from,to} ranges into a Set of every
// 1-indexed line touched. For typical files (a handful of hunks of ≤ 30
// lines each) this is cheap; for a 10k-line whole-file rewrite it caps at
// ~10k entries which is still nothing.
function expand(ranges) {
  const set = new Set();
  if (!Array.isArray(ranges)) return set;
  for (const r of ranges) {
    if (!r) continue;
    const from = Math.max(1, r.from | 0);
    const to = Math.max(from, r.to | 0);
    for (let n = from; n <= to; n++) set.add(n);
  }
  return set;
}

export const diffGutterField = StateField.define({
  create() {
    return { unstaged: new Set(), staged: new Set() };
  },
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setUnstagedDiffEffect)) {
        next = { ...next, unstaged: expand(e.value) };
      } else if (e.is(setStagedDiffEffect)) {
        next = { ...next, staged: expand(e.value) };
      }
    }
    return next;
  },
});

// Markers are deliberately tiny — a ~3px-wide vertical bar that hugs the
// gutter edge. Same visual idiom VS Code uses; doesn't crowd the line
// numbers.
class DiffMarker extends GutterMarker {
  constructor(kind) {
    super();
    this.kind = kind; // 'unstaged' | 'staged' | 'both'
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-gitdiff-bar cm-gitdiff-${this.kind}`;
    el.title =
      this.kind === 'staged'  ? 'Staged change' :
      this.kind === 'unstaged' ? 'Modified (unstaged)' :
      'Modified — partly staged';
    return el;
  }
  // CodeMirror short-circuits gutter rendering when the marker `eq`s the
  // previous one; without this every line we touch re-creates a DOM node.
  eq(other) { return other instanceof DiffMarker && other.kind === this.kind; }
}

export function gitDiffGutter() {
  return [
    diffGutterField,
    gutter({
      class: 'cm-gitdiff-gutter',
      lineMarker(view, line) {
        const state = view.state.field(diffGutterField, false);
        if (!state) return null;
        const ln = view.state.doc.lineAt(line.from).number;
        const u = state.unstaged.has(ln);
        const s = state.staged.has(ln);
        if (u && s) return new DiffMarker('both');
        if (s) return new DiffMarker('staged');
        if (u) return new DiffMarker('unstaged');
        return null;
      },
      // No initial spacer — keeps the gutter at zero width when the file
      // has no diff (and on non-git projects).
    }),
    EditorView.theme({
      '.cm-gitdiff-gutter': {
        minWidth: '3px',
        background: 'transparent',
        padding: 0,
      },
      '.cm-gitdiff-bar': {
        width: '3px',
        height: '100%',
        marginLeft: '1px',
      },
      '.cm-gitdiff-unstaged': {
        background: 'var(--color-warning)',
        opacity: 0.85,
      },
      '.cm-gitdiff-staged': {
        background: 'var(--color-success)',
        opacity: 0.9,
      },
      // "Both" = a line was already staged but then edited again. Render a
      // green-on-amber gradient so neither colour is misleading.
      '.cm-gitdiff-both': {
        background: 'linear-gradient(to right, var(--color-success) 0%, var(--color-success) 50%, var(--color-warning) 50%, var(--color-warning) 100%)',
        opacity: 0.9,
      },
    }),
  ];
}

// =====================================================================
// Diff parser — extracts post-image line ranges from a unified diff.
// =====================================================================
//
// Unified diff hunk header: `@@ -<oldStart>,<oldLen> +<newStart>,<newLen> @@`
// We care only about the new-side ranges, and within a hunk we walk the
// body lines to mark precisely which post-image lines are added/changed
// (skipping context). Pure-deletion hunks contribute no ranges (there's
// no surviving line to highlight in the editor).
//
// `targetFile`, when provided, scopes parsing to a single `+++ b/<path>`
// section in case the diff covers multiple files (e.g. `git diff` without
// a path argument).
export function parseDiffNewLineRanges(diffText, targetFile) {
  const ranges = [];
  if (!diffText || typeof diffText !== 'string') return ranges;

  const lines = diffText.split('\n');
  // Normalise the target so comparisons survive Windows-style backslashes.
  const wantPath = targetFile
    ? targetFile.replace(/\\/g, '/').replace(/^"+|"+$/g, '')
    : null;

  let inWantedFile = !wantPath; // when no scope, every file is "wanted"
  let newLine = 0;
  let inHunk = false;

  // Scratch range we extend as we walk consecutive +/space lines.
  let cur = null;
  const flush = () => {
    if (cur && cur.to >= cur.from) ranges.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    // File header — `+++ b/<path>` (sometimes `+++ "b/<path>"`)
    if (ln.startsWith('+++ ')) {
      flush();
      inHunk = false;
      if (!wantPath) { inWantedFile = true; continue; }
      let p = ln.slice(4).trim();
      // Strip surrounding quotes (git quotes paths with special chars).
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      // Strip the canonical `b/` prefix, if any.
      if (p.startsWith('b/')) p = p.slice(2);
      // `/dev/null` is a deletion — never matches a target file.
      if (p === '/dev/null') { inWantedFile = false; continue; }
      const norm = p.replace(/\\/g, '/');
      // Path may be absolute (target) or repo-relative (diff). Match suffix.
      inWantedFile = wantPath.endsWith('/' + norm) || wantPath === norm
        || norm.endsWith('/' + wantPath) || wantPath.endsWith(norm);
      continue;
    }
    // Skip the `--- a/<path>` line outright; nothing to do.
    if (ln.startsWith('--- ')) continue;

    // Hunk header
    if (ln.startsWith('@@')) {
      flush();
      if (!inWantedFile) { inHunk = false; continue; }
      const m = /\+(\d+)(?:,(\d+))?/.exec(ln);
      if (!m) { inHunk = false; continue; }
      newLine = parseInt(m[1], 10);
      inHunk = true;
      continue;
    }
    if (!inHunk || !inWantedFile) continue;

    // Hunk body
    const c = ln.charAt(0);
    if (c === '+') {
      // Added / changed line — extend the current range or start one.
      if (cur && cur.to === newLine - 1) {
        cur.to = newLine;
      } else {
        flush();
        cur = { from: newLine, to: newLine };
      }
      newLine++;
    } else if (c === '-') {
      // Deletion only — no post-image line, doesn't move newLine forward.
      // Don't break the range; some hunks intersperse +/-.
    } else if (c === ' ' || c === '\\' || ln === '') {
      // Context line or "\ No newline at end of file" or terminator.
      flush();
      if (c === ' ') newLine++;
    } else {
      // Anything else (e.g. another `diff --git` separator) ends the hunk.
      flush();
      inHunk = false;
    }
  }
  flush();
  return ranges;
}
