// src/extensions/semanticMarks.js
//
// Decorate semantic-type mismatches in the editor. Mismatches come from
// the LLM-driven semanticTypes util; we render them as wavy underlines
// with a tooltip on hover. This is purely a display layer — the actual
// inference + persistence happens outside.

import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';

export const setSemanticMarksEffect = StateEffect.define();

// Stored shape: { mismatches: [{line, col, length, severity, message}] }
export const semanticMarksField = StateField.define({
  create() { return { mismatches: [] }; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSemanticMarksEffect)) {
        return { mismatches: Array.isArray(e.value) ? e.value : [] };
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (state) => {
    const builder = new RangeSetBuilder();
    const doc = arguments; // just to suppress lint — real doc accessed below
    return buildDecorations(state.mismatches);
  }),
});

function buildDecorations(mismatches) {
  // We can't access the full document here without the editor state. The
  // real decorations need to go through a viewPlugin that iterates each
  // visible line and maps (line, col) to absolute positions. Use that
  // pattern instead.
  return Decoration.none;
}

// ViewPlugin equivalent via StateField.provide: we iterate via
// EditorView.decorations.compute — the factory below reads from the
// field AND the current doc to compute ranges.
export function semanticMarksExtension() {
  return [
    semanticMarksField,
    EditorView.decorations.compute([semanticMarksField], (state) => {
      const info = state.field(semanticMarksField, false);
      if (!info || !info.mismatches?.length) return Decoration.none;
      const builder = new RangeSetBuilder();
      const doc = state.doc;
      // Sort by line to satisfy RangeSetBuilder's strict ordering.
      const sorted = [...info.mismatches].sort((a, b) => (a.line - b.line) || ((a.col || 0) - (b.col || 0)));
      for (const m of sorted) {
        const lineNum = Math.min(Math.max(1, m.line | 0), doc.lines);
        const lineInfo = doc.line(lineNum);
        const col = Math.min(Math.max(0, m.col | 0), lineInfo.length);
        const from = lineInfo.from + col;
        const len = Math.max(1, Math.min(m.length || 10, lineInfo.length - col));
        const to = Math.min(lineInfo.to, from + len);
        if (to <= from) continue;
        const cls = m.severity === 'info' ? 'cm-sem-info' : 'cm-sem-warn';
        builder.add(from, to, Decoration.mark({
          class: cls,
          attributes: { title: `${m.expected || '?'} vs ${m.actual || '?'} — ${m.message}` },
        }));
      }
      return builder.finish();
    }),
    EditorView.theme({
      '.cm-sem-warn': {
        textDecoration: 'underline wavy #fbbf24',
        textUnderlineOffset: '3px',
        textDecorationThickness: '1px',
        cursor: 'help',
      },
      '.cm-sem-info': {
        textDecoration: 'underline dotted #38bdf8',
        textUnderlineOffset: '3px',
        cursor: 'help',
      },
    }),
  ];
}
