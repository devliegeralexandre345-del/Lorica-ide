// src/extensions/gitBlame.js
//
// Inline "git blame" gutter for CodeMirror. When enabled, each line in the
// editor gets a compact lens on the left showing `author · short-hash · date`.
// Hover for the commit summary. Uncommitted lines render in the accent color
// so the user can spot their own in-progress edits at a glance.
//
// Design notes:
//   • Blame data is fetched out-of-band by the Editor component and piped in
//     via the `setBlameEffect` state effect. Keeping the data outside the
//     extension means blame can be refreshed without rebuilding the view.
//   • The gutter marker is purposely slim (~110 px) and opacity-scaled so it
//     fades into the UI until the user hovers — no visual cost when they're
//     not actively reading blame.
//   • When a file is dirty (has unsaved edits) blame becomes stale. The
//     Editor re-fetches on save; until then the rows just show their
//     existing mapping — staleness is flagged via a small dot.

import { StateField, StateEffect } from '@codemirror/state';
import { gutter, GutterMarker, EditorView } from '@codemirror/view';

export const setBlameEffect = StateEffect.define();
export const toggleBlameEffect = StateEffect.define();

// Stored shape: { enabled: boolean, rows: Map<lineNumber, blameRow> }
export const blameField = StateField.define({
  create() {
    return { enabled: false, rows: new Map() };
  },
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setBlameEffect)) {
        const rows = new Map();
        for (const r of e.value || []) rows.set(r.line, r);
        next = { ...next, rows };
      }
      if (e.is(toggleBlameEffect)) {
        next = { ...next, enabled: typeof e.value === 'boolean' ? e.value : !next.enabled };
      }
    }
    return next;
  },
});

class BlameMarker extends GutterMarker {
  constructor(row) {
    super();
    this.row = row;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-blame-marker';
    if (this.row.is_uncommitted) el.classList.add('cm-blame-uncommitted');

    // Compact layout: "author · date" on one line. Short hash is shown as a
    // subtle badge when there's room. Tooltip has the full message.
    const author = (this.row.author || '—').split(/[\s<]/)[0].slice(0, 12);
    const date = (this.row.date || '').slice(0, 10);
    const hash = this.row.short_hash || '';

    el.innerHTML = `
      <span class="cm-blame-author">${escape(author)}</span>
      <span class="cm-blame-sep">·</span>
      <span class="cm-blame-date">${escape(date)}</span>
      ${hash ? `<span class="cm-blame-hash">${escape(hash)}</span>` : ''}
    `;
    el.title = this.row.is_uncommitted
      ? 'Uncommitted change'
      : `${this.row.author} — ${hash}\n${this.row.summary || ''}`;
    return el;
  }
}

function escape(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

export function blameGutter() {
  return [
    blameField,
    gutter({
      class: 'cm-blame-gutter',
      lineMarker(view, line) {
        const state = view.state.field(blameField, false);
        if (!state || !state.enabled) return null;
        const ln = view.state.doc.lineAt(line.from).number;
        const row = state.rows.get(ln);
        return row ? new BlameMarker(row) : null;
      },
      initialSpacer: () => new BlameMarker({
        author: 'Loading', date: '—', short_hash: '', summary: '', is_uncommitted: false,
      }),
    }),
    EditorView.theme({
      '.cm-blame-gutter': {
        minWidth: '140px',
        borderRight: '1px solid var(--color-border)',
        background: 'transparent',
        fontSize: '10px',
        fontFamily: '"JetBrains Mono", monospace',
      },
      '.cm-blame-marker': {
        padding: '0 8px',
        color: 'var(--color-textDim)',
        opacity: 0.5,
        transition: 'opacity 120ms ease',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      '.cm-blame-gutter:hover .cm-blame-marker': {
        opacity: 0.95,
      },
      '.cm-blame-uncommitted': {
        color: 'var(--color-accent) !important',
        fontWeight: 600,
      },
      '.cm-blame-sep': { opacity: 0.4 },
      '.cm-blame-hash': {
        opacity: 0.5,
        fontSize: '9px',
        padding: '0 3px',
        borderRadius: '3px',
        background: 'var(--color-border)',
      },
      '.cm-blame-author': { fontWeight: 500 },
      '.cm-blame-date': { opacity: 0.7 },
    }),
  ];
}
