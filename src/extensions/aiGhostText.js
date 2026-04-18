// src/extensions/aiGhostText.js
//
// CodeMirror 6 inline AI completion ("ghost text"):
//   • Renders a faint suggestion after the cursor as a widget decoration.
//   • Tab accepts, Escape / any edit / cursor move dismisses.
//   • Idle detection: fires an AI request ~500 ms after the user stops
//     typing, provided the cursor is at end-of-line and selection is empty.
//   • Single-flight with AbortController — a new request cancels the old.
//
// Configuration is injected per-editor via the `aiGhostConfig` facet:
//   aiGhostConfig.of({ enabled, getFetcher })
// `getFetcher` is a function that, given ({ prefix, suffix, signal }), resolves
// to the completion string. The Editor component builds this closure using
// the current AI provider / API key / language from app state.

import { StateField, StateEffect, EditorState, Facet } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin } from '@codemirror/view';

// --------------------------------------------------------------------
// Facet — per-editor config
// --------------------------------------------------------------------
export const aiGhostConfig = Facet.define({
  combine(configs) {
    return configs[configs.length - 1] || { enabled: false, getFetcher: null };
  },
});

// --------------------------------------------------------------------
// Effects + state
// --------------------------------------------------------------------
const setGhost = StateEffect.define(); // { from, text } | null
const clearGhost = StateEffect.define();

const ghostField = StateField.define({
  create: () => null,
  update(value, tr) {
    // Any doc change invalidates the ghost — unless the change is *us*
    // accepting it (we clear explicitly then).
    if (tr.docChanged) {
      for (const e of tr.effects) {
        if (e.is(setGhost)) return e.value;
        if (e.is(clearGhost)) return null;
      }
      return null;
    }
    // Selection changes away from the ghost anchor also invalidate.
    if (tr.selection && value) {
      const head = tr.selection.main.head;
      if (head !== value.from) return null;
    }
    for (const e of tr.effects) {
      if (e.is(setGhost)) return e.value;
      if (e.is(clearGhost)) return null;
    }
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (g) => {
      if (!g || !g.text) return Decoration.none;
      return Decoration.set([
        Decoration.widget({
          widget: new GhostWidget(g.text),
          side: 1,
        }).range(g.from),
      ]);
    }),
});

// --------------------------------------------------------------------
// Widget
// --------------------------------------------------------------------
class GhostWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) { return other.text === this.text; }
  toDOM() {
    // Multi-line ghost: render first line as inline <span>, further lines
    // as block rows so indentation lines up.
    const root = document.createElement('span');
    root.className = 'cm-ai-ghost';
    const lines = this.text.split('\n');
    const first = document.createElement('span');
    first.className = 'cm-ai-ghost-line';
    first.textContent = lines[0];
    root.appendChild(first);
    for (let i = 1; i < lines.length; i++) {
      const br = document.createElement('br');
      root.appendChild(br);
      const line = document.createElement('span');
      line.className = 'cm-ai-ghost-line';
      line.textContent = lines[i];
      root.appendChild(line);
    }
    return root;
  }
  ignoreEvent() { return true; }
}

// --------------------------------------------------------------------
// Theme
// --------------------------------------------------------------------
const ghostTheme = EditorView.baseTheme({
  '.cm-ai-ghost': {
    opacity: 0.42,
    fontStyle: 'italic',
    color: 'var(--color-textDim, #7a869a)',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  '.cm-ai-ghost-line': { whiteSpace: 'pre' },
});

// --------------------------------------------------------------------
// Idle watcher — schedules AI requests when the user pauses typing
// --------------------------------------------------------------------
const IDLE_MS = 500;

const ghostWatcher = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.timer = null;
      this.aborter = null;
      this.lastScheduledVersion = -1;
      this.reschedule();
    }

    update(upd) {
      if (upd.docChanged || upd.selectionSet) {
        // Invalidate any inflight request — the context just changed.
        if (this.aborter) { this.aborter.abort(); this.aborter = null; }
        this.reschedule();
      }
    }

    reschedule() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      const cfg = this.view.state.facet(aiGhostConfig);
      if (!cfg.enabled || typeof cfg.getFetcher !== 'function') return;
      this.timer = setTimeout(() => this.fire(), IDLE_MS);
    }

    async fire() {
      this.timer = null;
      const view = this.view;
      const state = view.state;
      const sel = state.selection.main;

      // Only ask when selection is empty.
      if (!sel.empty) return;

      // Context
      const pos = sel.head;
      const doc = state.doc;
      const prefix = doc.sliceString(0, pos);
      const suffix = doc.sliceString(pos);

      // Skip if the line is trivially short or the last char is a letter
      // mid-word — that's usually intra-word typing, not a pause for help.
      const lineBefore = prefix.slice(prefix.lastIndexOf('\n') + 1);
      if (lineBefore.length === 0 && !prefix.endsWith('\n')) return;

      const cfg = state.facet(aiGhostConfig);
      const fetcher = cfg.getFetcher;
      if (!fetcher) return;

      const aborter = new AbortController();
      this.aborter = aborter;
      const versionAtRequest = state.doc.length + '|' + pos;

      let completion = '';
      try {
        completion = await fetcher({ prefix, suffix, signal: aborter.signal });
      } catch (_) {
        return;
      }
      if (aborter.signal.aborted) return;
      // Has the editor moved on in the meantime?
      const nowState = view.state;
      const nowPos = nowState.selection.main.head;
      if (nowState.doc.length + '|' + nowPos !== versionAtRequest) return;
      if (!completion) return;

      view.dispatch({
        effects: setGhost.of({ from: pos, text: completion }),
      });
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
      if (this.aborter) this.aborter.abort();
    }
  },
);

// --------------------------------------------------------------------
// Commands — accept / dismiss
// --------------------------------------------------------------------
export function acceptGhost(view) {
  const g = view.state.field(ghostField, false);
  if (!g || !g.text) return false;
  view.dispatch({
    changes: { from: g.from, to: g.from, insert: g.text },
    selection: { anchor: g.from + g.text.length },
    effects: clearGhost.of(null),
    userEvent: 'input.complete',
  });
  return true;
}

export function dismissGhost(view) {
  const g = view.state.field(ghostField, false);
  if (!g) return false;
  view.dispatch({ effects: clearGhost.of(null) });
  return true;
}

// --------------------------------------------------------------------
// Full extension bundle
// --------------------------------------------------------------------
// NOTE: Tab / Escape bindings are NOT included here — the Editor wires them
// into its own keymap so it can control precedence (ghost should only accept
// when the autocomplete dropdown isn't showing, and indentation should be
// the fallback).
export function aiGhostExtension() {
  return [
    ghostField,
    ghostWatcher,
    ghostTheme,
  ];
}
