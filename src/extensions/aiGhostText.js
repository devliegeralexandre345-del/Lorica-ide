// src/extensions/aiGhostText.js
//
// CodeMirror 6 inline AI completion ("ghost text"):
//   • Renders a faint suggestion after the cursor as a widget decoration.
//   • Tab accepts, Escape / any edit / cursor move dismisses.
//   • Idle detection: fires an AI request after the user stops typing.
//   • Manual trigger: Alt-\ or Ctrl-Alt-Space forces a suggestion right now.
//   • Single-flight with AbortController — new edits cancel inflight calls.
//   • Exposes a live "state" field (disabled | idle | thinking | ready | error)
//     that a small corner indicator reads so the user can see what's going on.
//
// Configuration is injected per-editor via the `aiGhostConfig` facet:
//   aiGhostConfig.of({ enabled, getFetcher })
// `getFetcher` resolves to the completion string given ({ prefix, suffix, signal }).
//
// Debug: set `window.__LORICA_GHOST_DEBUG = true` in the devtools console to
// get verbose logs (which check ran, why it skipped, how long a call took).

import { StateField, StateEffect, Facet } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin } from '@codemirror/view';

// Debug log helper. Opt-out via `window.__LORICA_GHOST_DEBUG = false` in DevTools.
// Kept on by default while the feature stabilises so users can self-diagnose.
const dbg = (...args) => {
  if (typeof window === 'undefined') return;
  if (window.__LORICA_GHOST_DEBUG === false) return;
  // eslint-disable-next-line no-console
  console.debug('[ghost]', ...args);
};

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
const setGhost = StateEffect.define();    // { from, text }
const clearGhost = StateEffect.define();  // null
const setStatus = StateEffect.define();   // 'disabled' | 'idle' | 'thinking' | 'ready' | 'error'

const ghostField = StateField.define({
  create: () => null,
  update(value, tr) {
    if (tr.docChanged) {
      for (const e of tr.effects) {
        if (e.is(setGhost)) return e.value;
        if (e.is(clearGhost)) return null;
      }
      return null;
    }
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
        Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.from),
      ]);
    }),
});

// Status — exposed so the small corner indicator can render it.
export const ghostStatusField = StateField.define({
  create: () => 'idle',
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setStatus)) return e.value;
    }
    return value;
  },
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
    const root = document.createElement('span');
    root.className = 'cm-ai-ghost';
    const lines = this.text.split('\n');
    const first = document.createElement('span');
    first.className = 'cm-ai-ghost-line';
    first.textContent = lines[0];
    root.appendChild(first);
    for (let i = 1; i < lines.length; i++) {
      root.appendChild(document.createElement('br'));
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
// Theme — ghost text + status pill
// --------------------------------------------------------------------
const ghostTheme = EditorView.baseTheme({
  '.cm-ai-ghost': {
    opacity: 0.5,
    fontStyle: 'italic',
    color: 'var(--color-textDim, #7a869a)',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  '.cm-ai-ghost-line': { whiteSpace: 'pre' },
});

// --------------------------------------------------------------------
// Idle watcher — schedules AI requests when the user pauses typing.
// Exposes runNow() for a manual keyboard trigger.
// --------------------------------------------------------------------
const IDLE_MS = 450;

const ghostWatcher = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.timer = null;
      this.aborter = null;
    }

    update(upd) {
      if (upd.docChanged || upd.selectionSet) {
        if (this.aborter) { this.aborter.abort(); this.aborter = null; }
        this.reschedule();
      }
    }

    reschedule() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      const cfg = this.view.state.facet(aiGhostConfig);
      if (!cfg.enabled) { this.setStatus('disabled'); return; }
      if (typeof cfg.getFetcher !== 'function') { dbg('no fetcher'); return; }
      this.setStatus('idle');
      this.timer = setTimeout(() => this.fire(false), IDLE_MS);
    }

    setStatus(s) {
      // Dispatching during an in-progress update is forbidden in CM6, so we
      // always defer status transitions to a microtask.
      Promise.resolve().then(() => {
        try { this.view.dispatch({ effects: setStatus.of(s) }); } catch (_) {}
      });
    }

    async fire(manual) {
      this.timer = null;
      const view = this.view;
      const state = view.state;
      const sel = state.selection.main;

      if (!sel.empty) { dbg('skip: selection not empty'); return; }

      const pos = sel.head;
      const doc = state.doc;
      const prefix = doc.sliceString(0, pos);
      const suffix = doc.sliceString(pos);

      // Be lenient: if triggered manually, always fire. If automatic,
      // still fire even on empty lines — the model can produce a
      // boilerplate opener. The only thing we skip is a completely
      // empty document (nothing to go on).
      if (!manual && prefix.length === 0 && suffix.length === 0) {
        dbg('skip: empty doc');
        return;
      }

      const cfg = state.facet(aiGhostConfig);
      const fetcher = cfg.getFetcher;
      if (!cfg.enabled || typeof fetcher !== 'function') {
        dbg('skip: disabled or no fetcher', { enabled: cfg.enabled });
        return;
      }

      const aborter = new AbortController();
      this.aborter = aborter;
      const versionAtRequest = state.doc.length + '|' + pos;

      this.setStatus('thinking');
      dbg('fire', { manual, prefixLen: prefix.length, suffixLen: suffix.length });
      const t0 = performance.now();

      let completion = '';
      try {
        completion = await fetcher({ prefix, suffix, signal: aborter.signal });
      } catch (e) {
        dbg('fetcher threw:', e?.message || e);
        this.setStatus('error');
        return;
      }
      const ms = Math.round(performance.now() - t0);

      if (aborter.signal.aborted) { dbg('aborted', { ms }); return; }
      const nowState = view.state;
      const nowPos = nowState.selection.main.head;
      if (nowState.doc.length + '|' + nowPos !== versionAtRequest) {
        dbg('context moved — dropping result', { ms });
        this.setStatus('idle');
        return;
      }

      if (!completion) {
        dbg('empty completion', { ms });
        this.setStatus('idle');
        return;
      }

      dbg('got completion', { ms, bytes: completion.length, preview: completion.slice(0, 60) });
      view.dispatch({
        effects: [
          setGhost.of({ from: pos, text: completion }),
          setStatus.of('ready'),
        ],
      });
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
      if (this.aborter) this.aborter.abort();
    }
  },
);

// --------------------------------------------------------------------
// Commands — accept / dismiss / manual trigger
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
  dbg('accepted', { bytes: g.text.length });
  return true;
}

export function dismissGhost(view) {
  const g = view.state.field(ghostField, false);
  if (!g) return false;
  view.dispatch({ effects: clearGhost.of(null) });
  return true;
}

// Find the ghostWatcher instance attached to this view and fire immediately.
export function triggerGhost(view) {
  // Iterate through plugins to locate our ViewPlugin instance.
  const plugin = view.plugin(ghostWatcher);
  if (!plugin) { dbg('manual trigger: plugin not found'); return false; }
  // Cancel any queued idle timer / inflight request, then fire now.
  if (plugin.timer) { clearTimeout(plugin.timer); plugin.timer = null; }
  if (plugin.aborter) { plugin.aborter.abort(); plugin.aborter = null; }
  plugin.fire(true);
  return true;
}

// --------------------------------------------------------------------
// Bundle
// --------------------------------------------------------------------
export function aiGhostExtension() {
  return [ghostField, ghostStatusField, ghostWatcher, ghostTheme];
}
