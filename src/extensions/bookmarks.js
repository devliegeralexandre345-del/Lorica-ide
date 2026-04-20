// src/extensions/bookmarks.js
//
// Bookmarks gutter for CodeMirror. A bookmark is just a {file, line} pair
// stored outside the editor state (in Redux, persisted to localStorage).
// This module owns ONLY the rendering + the effects used to sync state
// into the editor. Toggling a bookmark from the keyboard is wired in the
// Editor keymap (Ctrl+M).

import { StateField, StateEffect } from '@codemirror/state';
import { gutter, GutterMarker, EditorView } from '@codemirror/view';

export const setBookmarksEffect = StateEffect.define();

export const bookmarkField = StateField.define({
  create() { return new Set(); }, // set of 1-indexed line numbers
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setBookmarksEffect)) {
        return new Set(e.value || []);
      }
    }
    return value;
  },
});

class BookmarkMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-bookmark-marker';
    el.textContent = '★';
    return el;
  }
}

export function bookmarkGutter() {
  return [
    bookmarkField,
    gutter({
      class: 'cm-bookmark-gutter',
      lineMarker(view, line) {
        const set = view.state.field(bookmarkField, false);
        if (!set) return null;
        const ln = view.state.doc.lineAt(line.from).number;
        return set.has(ln) ? new BookmarkMarker() : null;
      },
      initialSpacer: () => new BookmarkMarker(),
    }),
    EditorView.theme({
      '.cm-bookmark-gutter': {
        minWidth: '16px',
        background: 'transparent',
      },
      '.cm-bookmark-marker': {
        color: 'var(--color-accent)',
        fontSize: '11px',
        textAlign: 'center',
        cursor: 'pointer',
        filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 60%, transparent))',
      },
    }),
  ];
}
