// src/extensions/annotationsGutter.js
//
// Inline gutter dots for spatial annotations (Wave 12.1, completing
// Wave 11.4). Companion to AnnotationsPanel — the panel is the
// browse/search view, this extension is the spatial in-editor view.
//
// Each annotation on the active file shows up as a small coloured
// circle in a dedicated gutter. Click a dot → emit a window event
// (`lorica:focusAnnotation`) so the panel can scroll to + select it.
// Right-click any line in this gutter → emit `lorica:addAnnotation`
// so the App can prompt for the note's text and call addAnnotation()
// on the hook. Decoupled from the hook on purpose — the extension
// stays as a pure rendering/dispatch layer.

import { StateField, StateEffect } from '@codemirror/state';
import { gutter, GutterMarker, EditorView } from '@codemirror/view';

// State effect: caller pushes the active file's annotations into the
// editor state. Shape: array of { id, line, color, text } — we only
// need a slim subset of the full annotation record for rendering.
export const setAnnotationsEffect = StateEffect.define();

// Internal state field — keyed by 1-indexed line number for O(1)
// lookup in lineMarker. We rebuild this on every effect rather than
// patching incrementally because the active-file set is small (typical
// repo: under 50 annotations per file).
export const annotationsField = StateField.define({
  create() { return new Map(); }, // line → array<annotation>
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setAnnotationsEffect)) {
        const next = new Map();
        for (const a of e.value || []) {
          if (!a || typeof a.line !== 'number') continue;
          if (!next.has(a.line)) next.set(a.line, []);
          next.get(a.line).push(a);
        }
        return next;
      }
    }
    return value;
  },
});

// Map our 5 colour names to the same palette tokens used in
// AnnotationsPanel so the dot, the row in the panel, and the chip on
// the colour-filter row all match exactly.
const COLOR_HEX = {
  amber:   '#fbbf24',
  blue:    '#38bdf8',
  rose:    '#fb7185',
  emerald: '#34d399',
  violet:  '#a78bfa',
};

class AnnotationMarker extends GutterMarker {
  constructor(annotations) {
    super();
    this.annotations = annotations;
  }
  eq(other) {
    if (!(other instanceof AnnotationMarker)) return false;
    if (other.annotations.length !== this.annotations.length) return false;
    for (let i = 0; i < this.annotations.length; i++) {
      const a = this.annotations[i], b = other.annotations[i];
      if (a.id !== b.id || a.color !== b.color || a.pinned !== b.pinned) return false;
    }
    return true;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-annotation-dot-wrap';
    // Multi-annotation lines get a stacked rendering — first dot full-
    // size, additional dots shrink and crowd to the right. Cheap visual
    // cue without writing a popover for the count.
    const list = this.annotations.slice(0, 3);
    list.forEach((a, idx) => {
      const dot = document.createElement('span');
      dot.className = 'cm-annotation-dot' + (a.pinned ? ' cm-annotation-pinned' : '');
      dot.style.background = COLOR_HEX[a.color] || COLOR_HEX.amber;
      dot.style.transform = `translateX(${idx * 4}px) scale(${1 - idx * 0.15})`;
      // Stash the id on the DOM node so click handler can route.
      dot.dataset.annotationId = a.id;
      const preview = (a.text || '').split('\n')[0].slice(0, 80);
      dot.title = preview ? `${preview} (${this.annotations.length} note${this.annotations.length > 1 ? 's' : ''})` : `${this.annotations.length} annotation`;
      wrap.appendChild(dot);
    });
    if (this.annotations.length > 3) {
      const more = document.createElement('span');
      more.className = 'cm-annotation-more';
      more.textContent = `+${this.annotations.length - 3}`;
      wrap.appendChild(more);
    }
    return wrap;
  }
}

export function annotationsGutter() {
  return [
    annotationsField,
    gutter({
      class: 'cm-annotations-gutter',
      lineMarker(view, line) {
        const map = view.state.field(annotationsField, false);
        if (!map || map.size === 0) return null;
        const ln = view.state.doc.lineAt(line.from).number;
        const list = map.get(ln);
        return list && list.length > 0 ? new AnnotationMarker(list) : null;
      },
      initialSpacer: () => new AnnotationMarker([{ id: 'spacer', color: 'amber', text: '', pinned: false }]),
      domEventHandlers: {
        // Left click on an existing dot → emit a `lorica:peekAnnotation`
        // event that the host renders as an inline popover (Wave 15).
        // Shift-click jumps straight to the panel for full edit. Empty
        // gutter line → add intent.
        click: (view, line, event) => {
          const target = event.target?.closest?.('.cm-annotation-dot');
          if (target?.dataset?.annotationId) {
            const map = view.state.field(annotationsField, false);
            const ln = view.state.doc.lineAt(line.from).number;
            const list = map?.get(ln) || [];
            const eventName = event.shiftKey ? 'lorica:focusAnnotation' : 'lorica:peekAnnotation';
            const rect = target.getBoundingClientRect();
            window.dispatchEvent(new CustomEvent(eventName, {
              detail: {
                id: target.dataset.annotationId,
                line: ln,
                annotations: list,
                anchor: { x: rect.right + 6, y: rect.top },
              },
            }));
            return true;
          }
          // Empty area click — surface as add intent.
          const ln = view.state.doc.lineAt(line.from).number;
          window.dispatchEvent(new CustomEvent('lorica:addAnnotation', {
            detail: { line: ln, source: 'gutter-click' },
          }));
          return true;
        },
        // Right-click anywhere in the gutter → add intent (faster path
        // for users who'd rather not click an empty pixel).
        contextmenu: (view, line, event) => {
          event.preventDefault();
          const ln = view.state.doc.lineAt(line.from).number;
          window.dispatchEvent(new CustomEvent('lorica:addAnnotation', {
            detail: { line: ln, source: 'gutter-context' },
          }));
          return true;
        },
      },
    }),
    EditorView.theme({
      '.cm-annotations-gutter': {
        minWidth: '18px',
        cursor: 'pointer',
        background: 'transparent',
      },
      '.cm-annotation-dot-wrap': {
        position: 'relative',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingLeft: '4px',
      },
      '.cm-annotation-dot': {
        position: 'absolute',
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        boxShadow: '0 0 6px currentColor',
        opacity: '0.85',
        transition: 'opacity 120ms ease, transform 120ms ease',
      },
      '.cm-annotation-dot:hover': {
        opacity: '1',
        // Lift slightly on hover so users see the dot is interactive.
        transform: 'translateX(0) scale(1.25) !important',
      },
      '.cm-annotation-pinned': {
        // Pinned annotations get a thin ring so they read as "permanent"
        // vs the regular ephemeral notes.
        boxShadow: '0 0 0 1.5px rgba(255,255,255,0.5), 0 0 6px currentColor',
      },
      '.cm-annotation-more': {
        marginLeft: '14px',
        fontSize: '8px',
        color: 'var(--color-textDim)',
        fontFamily: 'monospace',
      },
    }),
  ];
}
