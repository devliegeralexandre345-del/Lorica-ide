// src/extensions/smartInsert.js
//
// Bridge for the Smart Paste modal (Wave 11.3) to insert text at the
// current selection in CodeMirror. The modal lives outside the editor
// (it's a top-level overlay in App.jsx), so we use a window-scoped
// custom event to deliver the translation back into the editor without
// reaching into Editor.jsx's internals (forbidden per LEDGER rule).
//
// The extension is a ViewPlugin: it grabs the EditorView, registers a
// listener, and dispatches a transaction that replaces the current
// selection with the event's text. Multiple editor instances are
// possible (split editors) — each registers its own listener but only
// the editor that has DOM focus wins (we check `view.hasFocus`). This
// avoids dropping the same paste into both panes.

import { ViewPlugin } from '@codemirror/view';

export function smartInsertExtension() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.handler = (ev) => {
          const text = ev?.detail?.text;
          if (typeof text !== 'string' || !text) return;
          // Skip non-focused editors so split panes don't both insert.
          // If neither pane is focused (modal closed without a focused
          // editor), the first ViewPlugin listener wins — fine in practice
          // because the modal restores focus to the previously-active
          // editor before firing the event.
          if (!view.hasFocus && document.querySelectorAll('.cm-editor.cm-focused').length > 0) {
            return;
          }
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: text },
            // Place the cursor at the end of the inserted block so the
            // user can keep typing right after.
            selection: { anchor: from + text.length },
            scrollIntoView: true,
          });
          // Re-focus the editor — if the modal stole focus, this brings
          // it back so subsequent typing lands in the right place.
          view.focus();
        };
        window.addEventListener('lorica:insertAtCursor', this.handler);
      }
      destroy() {
        try { window.removeEventListener('lorica:insertAtCursor', this.handler); } catch {}
      }
    },
  );
}
