// src/extensions/cursorBeacon.js
//
// Tiny CodeMirror ViewPlugin that publishes the current cursor
// position via a window event for the collab session (Wave 11.5) to
// pick up. Decoupled — the editor doesn't import collab; the App-level
// listener bridges the two.
//
// Throttled to ~80ms so dragging-select doesn't flood the awareness
// stream. We also gate on `window.__loricaCollabActive` (set by
// useCollabSession) so the event isn't fired at all when no session
// is live — zero overhead in the common case.

import { ViewPlugin } from '@codemirror/view';

export function cursorBeaconExtension({ getActiveFilePath } = {}) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.lastEmit = 0;
        this.timer = null;
      }
      update(update) {
        if (!update.selectionSet) return;
        if (!window.__loricaCollabActive) return;
        const now = Date.now();
        const delta = now - this.lastEmit;
        const fire = () => {
          this.lastEmit = Date.now();
          const head = this.view.state.selection.main.head;
          const lineObj = this.view.state.doc.lineAt(head);
          const file = typeof getActiveFilePath === 'function' ? getActiveFilePath() : null;
          try {
            window.dispatchEvent(new CustomEvent('lorica:cursorMoved', {
              detail: {
                file,
                line: lineObj.number,
                column: head - lineObj.from + 1,
              },
            }));
          } catch {}
        };
        if (delta >= 80) {
          fire();
        } else {
          if (this.timer) return;
          this.timer = setTimeout(() => { this.timer = null; fire(); }, 80 - delta);
        }
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );
}
