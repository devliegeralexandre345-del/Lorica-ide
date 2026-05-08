// src/extensions/multiLineSearchPanel.js
//
// Custom CodeMirror search panel that supports multi-line patterns.
//
// CodeMirror 6's SearchQuery already accepts newlines in `search` and
// `replace` strings out of the box — the only thing the default panel
// can't do is *enter* a newline (its inputs are single-line). This panel
// reuses all the same wiring (setSearchQuery, findNext, replaceAll, …)
// but ships a "multi-line" toggle that swaps the input/replace fields
// for textareas. When OFF, behavior is indistinguishable from the
// stock panel.
//
// Plugged into the editor via `search({ createPanel })` — see Editor.jsx.

import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from '@codemirror/search';

const STORAGE_KEY = 'lorica:editor-search-multiline';

function readMultilinePref() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
function writeMultilinePref(v) {
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch {}
}

// Trailing newlines in the input are almost always typos when the user
// hits Enter inside a textarea — strip them so an accidental Enter
// doesn't kill every match.
function normalizeMultiline(s) {
  return (s || '').replace(/[\r\n]+$/, '');
}

// Build a single field (input or textarea) and keep a reference. The
// `oninput` listener fires the SearchQuery commit so the editor state
// stays live with what the user types — same behavior as the stock panel.
function makeField({ tag, value, placeholder, ariaLabel, mainField, onCommit, multiline }) {
  const el = document.createElement(tag);
  el.value = value || '';
  el.placeholder = placeholder;
  el.setAttribute('aria-label', ariaLabel);
  el.className = 'cm-textfield lorica-search-field' + (multiline ? ' lorica-search-field-multi' : '');
  if (mainField) el.setAttribute('main-field', 'true');
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('autocapitalize', 'off');
  el.setAttribute('spellcheck', 'false');
  el.addEventListener('input', onCommit);
  el.addEventListener('change', onCommit);
  return el;
}

class LoricaSearchPanel {
  constructor(view) {
    this.view = view;
    this.multiline = readMultilinePref();

    const query = getSearchQuery(view.state);
    this.querySpec = {
      search: query.search,
      replace: query.replace,
      caseSensitive: query.caseSensitive,
      regexp: query.regexp,
      wholeWord: query.wholeWord,
    };

    this.dom = document.createElement('div');
    this.dom.className = 'cm-search lorica-search-panel';
    this.dom.setAttribute('aria-label', 'Search');
    this.dom.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.buildUI();
  }

  buildUI() {
    // Wipe and rebuild — called when toggling multi-line so we can swap
    // input ↔ textarea without leaking listeners.
    while (this.dom.firstChild) this.dom.removeChild(this.dom.firstChild);

    const tag = this.multiline ? 'textarea' : 'input';
    const commit = () => this.commit();

    this.searchField = makeField({
      tag, value: this.querySpec.search,
      placeholder: this.multiline ? 'Find (multi-line)…' : 'Find',
      ariaLabel: 'Find',
      mainField: true,
      onCommit: commit,
      multiline: this.multiline,
    });

    this.replaceField = makeField({
      tag, value: this.querySpec.replace,
      placeholder: this.multiline ? 'Replace (multi-line)…' : 'Replace',
      ariaLabel: 'Replace',
      mainField: false,
      onCommit: commit,
      multiline: this.multiline,
    });

    // Toggle row: case, word, regex, multi-line. Same layout as the
    // stock panel so users feel at home.
    const mkCheck = (name, checked, onChange, label) => {
      const wrap = document.createElement('label');
      wrap.className = 'lorica-search-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = name;
      cb.checked = !!checked;
      cb.addEventListener('change', onChange);
      const span = document.createElement('span');
      span.textContent = label;
      wrap.appendChild(cb);
      wrap.appendChild(span);
      return { wrap, cb };
    };

    const caseCtl = mkCheck('case', this.querySpec.caseSensitive, () => {
      this.querySpec.caseSensitive = caseCtl.cb.checked;
      this.commit();
    }, 'match case');

    const wordCtl = mkCheck('word', this.querySpec.wholeWord, () => {
      this.querySpec.wholeWord = wordCtl.cb.checked;
      this.commit();
    }, 'by word');

    const reCtl = mkCheck('re', this.querySpec.regexp, () => {
      this.querySpec.regexp = reCtl.cb.checked;
      this.commit();
    }, 'regexp');

    const mlCtl = mkCheck('multiline', this.multiline, () => {
      this.multiline = mlCtl.cb.checked;
      writeMultilinePref(this.multiline);
      // Capture current text values before swapping the elements.
      this.querySpec.search = this.searchField.value;
      this.querySpec.replace = this.replaceField.value;
      this.buildUI();
      // Re-focus the main field so the user can keep typing.
      requestAnimationFrame(() => this.searchField.focus());
    }, 'multi-line');

    // Action buttons.
    const mkBtn = (label, title, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lorica-search-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };
    const nextBtn = mkBtn('next', 'Find next (Enter)', () => findNext(this.view));
    const prevBtn = mkBtn('prev', 'Find previous (Shift-Enter)', () => findPrevious(this.view));
    const replaceBtn = mkBtn('replace', 'Replace next', () => replaceNext(this.view));
    const replaceAllBtn = mkBtn('all', 'Replace all', () => replaceAll(this.view));
    const closeBtn = mkBtn('×', 'Close (Esc)', () => closeSearchPanel(this.view));
    closeBtn.classList.add('lorica-search-close');

    // Layout: row 1 = find field + nav; row 2 = replace field + actions;
    // row 3 = toggles. Textarea variant gets its own height via CSS.
    const row1 = document.createElement('div');
    row1.className = 'lorica-search-row';
    row1.appendChild(this.searchField);
    row1.appendChild(prevBtn);
    row1.appendChild(nextBtn);
    row1.appendChild(closeBtn);

    const row2 = document.createElement('div');
    row2.className = 'lorica-search-row';
    row2.appendChild(this.replaceField);
    row2.appendChild(replaceBtn);
    row2.appendChild(replaceAllBtn);

    const row3 = document.createElement('div');
    row3.className = 'lorica-search-row lorica-search-toggles';
    row3.appendChild(caseCtl.wrap);
    row3.appendChild(wordCtl.wrap);
    row3.appendChild(reCtl.wrap);
    row3.appendChild(mlCtl.wrap);

    this.dom.appendChild(row1);
    this.dom.appendChild(row2);
    this.dom.appendChild(row3);
  }

  // Build a SearchQuery from the current widget state. We pass
  // `literal: true` when multi-line is on so the textarea's real
  // newlines / tabs are used verbatim (otherwise CodeMirror would
  // also interpret literal `\n` escape sequences inside the text,
  // which is surprising when the user just typed an actual newline).
  buildQuery() {
    const search = this.multiline
      ? normalizeMultiline(this.searchField.value)
      : this.searchField.value;
    const replace = this.multiline
      ? this.replaceField.value.replace(/\r\n/g, '\n')
      : this.replaceField.value;

    return new SearchQuery({
      search,
      replace,
      caseSensitive: this.querySpec.caseSensitive,
      regexp: this.querySpec.regexp,
      wholeWord: this.querySpec.wholeWord,
      literal: this.multiline,
    });
  }

  commit() {
    const q = this.buildQuery();
    // Empty query → no-op (stock panel does the same; otherwise we'd
    // wipe match highlights and confuse the user).
    if (!q.search) return;
    this.querySpec.search = this.searchField.value;
    this.querySpec.replace = this.replaceField.value;
    this.view.dispatch({ effects: setSearchQuery.of(q) });
  }

  onKeyDown(e) {
    // Esc always closes — even from inside the textarea.
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(this.view);
      return;
    }
    if (e.key !== 'Enter') return;

    // In multi-line / textarea mode, plain Enter inserts a newline (the
    // user is composing a multi-line pattern). Cmd/Ctrl+Enter or
    // Shift+Enter (which the stock panel maps to "previous") triggers
    // the actual search — so we keep find-next on Cmd/Ctrl+Enter and
    // prev on Shift+Cmd/Ctrl+Enter.
    if (this.multiline && e.target.tagName === 'TEXTAREA') {
      const trigger = e.metaKey || e.ctrlKey;
      if (!trigger) return;
      e.preventDefault();
      if (e.target === this.searchField) {
        (e.shiftKey ? findPrevious : findNext)(this.view);
      } else if (e.target === this.replaceField) {
        replaceNext(this.view);
      }
      return;
    }

    // Single-line input mode — same bindings as the stock panel.
    if (e.target === this.searchField) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.target === this.replaceField) {
      e.preventDefault();
      replaceNext(this.view);
    }
  }

  update(update) {
    // Sync the field values when an external transaction (e.g. Ctrl+F
    // re-opening with selected text) updates the SearchQuery. Without
    // this the textarea would keep stale text after re-opening.
    for (const tr of update.transactions) {
      for (const e of tr.effects) {
        if (e.is(setSearchQuery)) {
          const q = e.value;
          if (q.search !== this.searchField.value) this.searchField.value = q.search;
          if (q.replace !== this.replaceField.value) this.replaceField.value = q.replace;
          this.querySpec.search = q.search;
          this.querySpec.replace = q.replace;
          this.querySpec.caseSensitive = q.caseSensitive;
          this.querySpec.regexp = q.regexp;
          this.querySpec.wholeWord = q.wholeWord;
        }
      }
    }
  }

  mount() {
    // Focus the find field on open. CodeMirror calls this after attaching
    // the panel to the DOM.
    this.searchField.focus();
    this.searchField.select?.();
  }

  destroy() {
    // No long-lived listeners outside `dom` — nothing to clean up.
  }
}

export function createMultiLineSearchPanel(view) {
  return new LoricaSearchPanel(view);
}
