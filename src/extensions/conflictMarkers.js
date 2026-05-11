// src/extensions/conflictMarkers.js
//
// CodeMirror 6 extension that decorates git merge conflict blocks and
// renders inline action buttons above each `<<<<<<<` line:
//
//   • Resolve with AI  — bubbles up via the conflictResolveFacet so
//     App.jsx can open the agent panel pre-seeded with a structured prompt.
//   • Keep ours / theirs / both — handled inline (replaces the block in
//     a single CM transaction; no React round-trip).
//
// Implementation notes:
//
//  - The decoration set is computed by a StateField that re-runs on doc
//    change. We debounce the parse so heavy edits (paste, AI rewrite)
//    don't reparse on every keystroke. The debounce lives in a small
//    dispatch loop driven by an updateListener: we schedule a dummy
//    transaction with `recomputeConflictsEffect` after 300ms idle.
//  - Buttons in widgets can NOT use React. They're plain DOM nodes; we
//    register click handlers that read the conflict block off a data-
//    attribute, then call back via the facet (for AI) or dispatch a
//    direct `changes` transaction (for ours/theirs/both).
//  - Theme colours come from CSS vars so they track the active theme.

import { StateField, StateEffect, Facet, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { findConflicts, resolveBlock } from '../utils/conflictMarkers';

// =============================================================
// Facet — host (Editor.jsx) injects a callback fired when the user
// clicks "Resolve with AI". We pass the block + the action name; the
// host opens the agent panel and seeds the prompt.
// =============================================================
export const conflictResolveFacet = Facet.define({
  combine: (values) => values.find((v) => typeof v === 'function') || null,
});

// =============================================================
// State — the parsed conflicts list, recomputed lazily.
// =============================================================
const recomputeConflictsEffect = StateEffect.define();

const conflictsField = StateField.define({
  create(state) {
    return findConflicts(state.doc.toString());
  },
  update(value, tr) {
    // Explicit recompute (debounced from the updateListener below).
    for (const e of tr.effects) {
      if (e.is(recomputeConflictsEffect)) {
        return findConflicts(tr.state.doc.toString());
      }
    }
    // Cheap path on every doc change: if the doc is small or we already
    // know there are no conflicts and the change can't introduce one,
    // skip. Otherwise reparse — conflict marker lines are 7 chars, so the
    // detection is fast even on large files. We still let the debounce
    // handle the heavy case to avoid jank during fast typing.
    if (tr.docChanged) {
      const txt = tr.state.doc.toString();
      // Quick gate: if no `<<<<<<<` substring at all, drop the list.
      if (txt.indexOf('<<<<<<<') < 0) return value.length ? [] : value;
    }
    return value;
  },
});

// =============================================================
// Widget — the "above the <<<<<<< line" toolbar. Holds a reference
// to the block it represents so click handlers can find it without
// re-parsing.
// =============================================================
class ConflictToolbarWidget extends WidgetType {
  constructor(block, blockIndex) {
    super();
    this.block = block;
    this.blockIndex = blockIndex;
  }
  // Two widgets are "equal" (no rerender) iff they describe the same
  // block at the same offset. blockIndex is included so re-ordered
  // conflicts after an edit force a refresh.
  eq(other) {
    return other.blockIndex === this.blockIndex
      && other.block.start === this.block.start
      && other.block.end === this.block.end
      && other.block.oursLabel === this.block.oursLabel
      && other.block.theirsLabel === this.block.theirsLabel;
  }
  toDOM(view) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-conflict-toolbar';
    wrap.setAttribute('data-conflict-index', String(this.blockIndex));

    // Tiny title chip — mirrors what git shows so users immediately
    // know which side is ours vs theirs.
    const label = document.createElement('span');
    label.className = 'cm-conflict-label';
    label.textContent = `Merge conflict — ${this.block.oursLabel} vs ${this.block.theirsLabel}`;
    wrap.appendChild(label);

    const mkBtn = (text, action, kind = 'plain', title = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cm-conflict-btn cm-conflict-btn-${kind}`;
      b.textContent = text;
      if (title) b.title = title;
      b.addEventListener('mousedown', (e) => {
        // Stop CodeMirror from moving the caret on widget click — feels
        // jankier than just letting the action fire silently.
        e.preventDefault();
      });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleConflictAction(view, this.block, action);
      });
      return b;
    };

    wrap.appendChild(mkBtn('Resolve with AI', 'ai', 'ai',
      'Open the AI agent with the conflict context pre-loaded'));
    // Wave 61 — direct AI merge: skips the agent chat, asks the
    // provider for a single proposed replacement that the user accepts
    // or cancels via a modal.
    wrap.appendChild(mkBtn('Quick AI merge', 'ai-quick', 'ai',
      'Ask the AI to propose a merge directly and preview it in a modal'));
    wrap.appendChild(mkBtn(`Keep ${this.block.oursLabel}`, 'ours', 'ours',
      `Replace the block with the ${this.block.oursLabel} side`));
    wrap.appendChild(mkBtn(`Keep ${this.block.theirsLabel}`, 'theirs', 'theirs',
      `Replace the block with the ${this.block.theirsLabel} side`));
    wrap.appendChild(mkBtn('Keep both', 'both', 'both',
      'Stack both sides (ours then theirs) and let you sort it out'));
    return wrap;
  }
  // Block widget — interactive (so clicks reach the buttons).
  ignoreEvent() { return false; }
}

// Runs the chosen action. For ours/theirs/both we dispatch a direct
// changes transaction (fast, no React detour). For 'ai' we hand off to
// the host via the facet — the host opens the agent panel.
function handleConflictAction(view, block, action) {
  if (action === 'ai' || action === 'ai-quick') {
    const cb = view.state.facet(conflictResolveFacet);
    if (cb) {
      try { cb(block, action); } catch (_) { /* swallow — UI feedback is the host's job */ }
    }
    return;
  }
  // Inline resolution. Re-derive the block from the *current* doc in
  // case it shifted under a concurrent edit — block offsets we captured
  // when the widget was built may be slightly stale on a busy file.
  const currentDoc = view.state.doc.toString();
  // Cheap recheck: find a block whose start line matches by content.
  // If we can't find it (the user already edited the marker away),
  // bail rather than corrupt the file.
  const fresh = findConflicts(currentDoc);
  const match = fresh.find((b) => b.startLine === block.startLine)
    || fresh.find((b) => b.start <= block.start && b.end >= block.end);
  const target = match || block;
  const replacement = resolveBlock(currentDoc, target, action);
  view.dispatch({
    changes: { from: target.start, to: target.end, insert: replacement },
    // Park the cursor at the start of the replacement so the user lands
    // somewhere sensible after the block collapses.
    selection: { anchor: target.start },
  });
  // Also notify the host (lets it surface a toast or audit-log entry).
  const cb = view.state.facet(conflictResolveFacet);
  if (cb) {
    try { cb(target, action); } catch (_) {}
  }
}

// =============================================================
// Decorations — line tint over the entire block + the toolbar widget.
// Computed from the conflictsField + the live doc.
// =============================================================
function buildDecorations(state) {
  const blocks = state.field(conflictsField, false);
  if (!blocks || blocks.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder();
  const doc = state.doc;
  blocks.forEach((block, idx) => {
    // Sanity — discard blocks that fell outside the doc (e.g. user
    // truncated the file between parse and render).
    if (block.start < 0 || block.end > doc.length) return;

    // Toolbar widget — block widget anchored just above the <<<<<<< line.
    builder.add(block.start, block.start, Decoration.widget({
      widget: new ConflictToolbarWidget(block, idx),
      block: true,
      side: -1, // place above the line
    }));

    // Line tints — light background per side so the eye sees the split.
    // We iterate line-by-line so theme styles compose with active-line
    // highlighting cleanly. Uses doc.lineAt → number to walk lines.
    const startLine = doc.lineAt(block.start).number;
    const endLine = doc.lineAt(Math.min(block.end, doc.length) - 1).number;
    const sepLine = doc.lineAt(block.theirsStart).number - 1; // ======= line

    for (let ln = startLine; ln <= endLine; ln++) {
      const info = doc.line(ln);
      let cls = 'cm-conflict-line';
      if (ln === startLine || ln === endLine || ln === sepLine) {
        cls += ' cm-conflict-marker-line';
      } else if (ln < sepLine) {
        cls += ' cm-conflict-ours-line';
      } else {
        cls += ' cm-conflict-theirs-line';
      }
      builder.add(info.from, info.from, Decoration.line({ attributes: { class: cls } }));
    }
  });
  return builder.finish();
}

const conflictDecorationsField = StateField.define({
  create(state) { return buildDecorations(state); },
  update(value, tr) {
    if (tr.docChanged
      || tr.effects.some((e) => e.is(recomputeConflictsEffect))
      || tr.startState.field(conflictsField, false) !== tr.state.field(conflictsField, false)) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// =============================================================
// Debounced reparse — schedule a recompute 300ms after the last edit
// so we don't allocate a new conflicts list on every keystroke. We
// piggy-back on an updateListener; the timer lives in a closure on
// the per-view extension instance.
// =============================================================
function debouncedReparse() {
  let timer = null;
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    if (timer) clearTimeout(timer);
    const view = update.view;
    timer = setTimeout(() => {
      timer = null;
      // Only fire if the view is still mounted.
      if (!view.dom || !view.dom.isConnected) return;
      view.dispatch({ effects: recomputeConflictsEffect.of(null) });
    }, 300);
  });
}

// =============================================================
// Theme — uses CSS custom properties so it tracks Lorica's active theme.
// Colour-mix gives us a tinted background without hard-coding colours.
// =============================================================
const conflictTheme = EditorView.baseTheme({
  '.cm-conflict-toolbar': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    margin: '2px 0',
    borderRadius: '6px',
    background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
    fontFamily: 'inherit',
    fontSize: '11px',
    userSelect: 'none',
  },
  '.cm-conflict-label': {
    color: 'var(--color-textDim)',
    marginRight: 'auto',
    fontSize: '10px',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },
  '.cm-conflict-btn': {
    appearance: 'none',
    border: '1px solid color-mix(in srgb, var(--color-border) 80%, transparent)',
    background: 'color-mix(in srgb, var(--color-panel) 80%, transparent)',
    color: 'var(--color-text)',
    padding: '3px 8px',
    borderRadius: '4px',
    fontFamily: 'inherit',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'background 120ms, border-color 120ms, color 120ms',
  },
  '.cm-conflict-btn:hover': {
    borderColor: 'var(--color-accent)',
    color: 'var(--color-accent)',
  },
  '.cm-conflict-btn-ai': {
    borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)',
    color: 'var(--color-accent)',
    background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
    fontWeight: '600',
  },
  '.cm-conflict-btn-ai:hover': {
    background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)',
  },
  // Light tints for the two sides — distinct hues so you can see at a
  // glance which side a line came from.
  '.cm-conflict-ours-line': {
    background: 'color-mix(in srgb, var(--color-success, #22c55e) 8%, transparent)',
  },
  '.cm-conflict-theirs-line': {
    background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
  },
  '.cm-conflict-marker-line': {
    background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 14%, transparent)',
    fontWeight: '600',
  },
});

// =============================================================
// Public extension — drop into the Editor's extensions array.
// =============================================================
export function conflictMarkersExtension() {
  return [
    conflictsField,
    conflictDecorationsField,
    debouncedReparse(),
    conflictTheme,
  ];
}
