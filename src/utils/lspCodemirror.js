// CodeMirror glue for the LSP client.
//
// Two pieces:
//   1. `createLspCompletionSource(getLspClient)` — an async CompletionSource
//      that forwards to the LSP server. Meant to run AFTER the static
//      dictionary source (via `override: [staticSource, lspSource]`), so
//      the user sees both: stdlib identifiers from the static chunk,
//      project symbols from the LSP.
//   2. `createLspDiagnostics(diagnostics)` — derives a CodeMirror
//      `Diagnostic[]` from the LSP-shaped diagnostics the hook polls.
//      Wired via `linter(() => diagnostics, { delay: 0 })` or the
//      `setDiagnostics` effect — we return the array and the editor
//      owner plumbs it.
//
// LSP completion item → CM completion mapping: keep label identical,
// use `info` for the docstring, `detail` for the signature. Sort by
// the server's own `sortText` if provided — servers already optimize
// ranking so we don't second-guess them.

// LSP CompletionItemKind → CodeMirror type string. CM only knows about
// a handful of categories; anything exotic collapses to `variable`.
const KIND_MAP = {
  1: 'text',         // Text
  2: 'method',
  3: 'function',
  4: 'function',     // Constructor
  5: 'property',     // Field
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'namespace',    // Module
  10: 'property',
  11: 'constant',    // Unit
  12: 'constant',    // Value
  13: 'enum',
  14: 'keyword',
  15: 'snippet',     // Snippet
  16: 'constant',    // Color
  17: 'text',        // File
  18: 'variable',    // Reference
  19: 'namespace',   // Folder
  20: 'enum',        // EnumMember
  21: 'constant',
  22: 'class',       // Struct
  23: 'variable',    // Event
  24: 'function',    // Operator
  25: 'type',        // TypeParameter
};

/**
 * Build a CodeMirror completion source that calls the provided async
 * LSP completion function. Returns `null` (= "no completions from us,
 * let other sources contribute") whenever the server is absent or the
 * request fails.
 *
 * @param {(ctx: any) => Promise<any[] | null>} lspFetcher  — function
 *        that takes the CM completion context and returns LSP items.
 */
export function createLspCompletionSource(lspFetcher) {
  return async (ctx) => {
    if (!ctx || ctx.explicit === false && ctx.matchBefore(/\w/) == null) {
      // Only fire on word characters or explicit invocations — don't
      // nag the server with a request on every keystroke in whitespace.
      return null;
    }

    let items;
    try {
      items = await lspFetcher(ctx);
    } catch {
      return null;
    }
    if (!items || !items.length) return null;

    const word = ctx.matchBefore(/[\w.]+/);
    const from = word ? word.from : ctx.pos;

    const options = items.map((item) => {
      const type = KIND_MAP[item.kind] || 'variable';
      // `label` is what the user types; `insertText` (if present) is
      // the completion to actually apply when accepted.
      return {
        label: item.label,
        type,
        detail: item.detail || undefined,
        info: docstring(item.documentation),
        apply: item.insertText && item.insertText !== item.label
          ? item.insertText
          : undefined,
        // `boost` lets the server's preferred ordering win — if
        // sortText is alphabetically small, boost is higher.
        boost: item.sortText ? 1 - charBoost(item.sortText) : 0,
      };
    });

    return { from, options, validFor: /^[\w.]*$/ };
  };
}

/** `documentation` can be a string or a MarkupContent (`{ kind, value }`). */
function docstring(doc) {
  if (!doc) return undefined;
  if (typeof doc === 'string') return doc;
  if (typeof doc === 'object' && doc.value) return String(doc.value);
  return undefined;
}

/** Convert the first char of sortText to a tiny boost so servers that
 *  prefix high-priority entries with low ASCII come out first. */
function charBoost(s) {
  if (!s) return 0.5;
  return (s.charCodeAt(0) || 0) / 256;
}

/**
 * Translate LSP diagnostics (with line/character positions) into
 * CodeMirror diagnostics (with absolute offsets), given a CM EditorState.
 *
 * @param {any}  state       — CodeMirror EditorState
 * @param {any[]} lspDiags   — array of LSP Diagnostic objects
 * @returns {any[]}          — array of CM Diagnostic objects
 */
export function toCodemirrorDiagnostics(state, lspDiags) {
  if (!state || !Array.isArray(lspDiags) || !lspDiags.length) return [];
  const doc = state.doc;
  return lspDiags.map((d) => {
    const from = posToOffset(doc, d.range?.start);
    const to   = posToOffset(doc, d.range?.end);
    return {
      from: Math.min(from, to),
      to: Math.max(from, to),
      severity: severityToLevel(d.severity),
      message: d.message || 'Issue',
      source: d.source || undefined,
    };
  }).filter((d) => d.from >= 0 && d.to >= 0 && d.to <= doc.length);
}

/** LSP Position (`{line, character}`) → CodeMirror absolute offset. */
function posToOffset(doc, pos) {
  if (!pos || typeof pos.line !== 'number') return -1;
  const line = pos.line + 1; // CM is 1-indexed
  if (line > doc.lines) return doc.length;
  const info = doc.line(line);
  const ch = Math.min(pos.character ?? 0, info.length);
  return info.from + ch;
}

/** LSP severity number → CM severity string. */
function severityToLevel(sev) {
  switch (sev) {
    case 1: return 'error';
    case 2: return 'warning';
    case 3: return 'info';
    case 4: return 'hint';
    default: return 'info';
  }
}

/** LSP hover contents → plain markdown string for tooltip display. */
export function hoverToMarkdown(hover) {
  if (!hover) return null;
  const c = hover.contents;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((x) => (typeof x === 'string' ? x : x?.value || ''))
      .filter(Boolean)
      .join('\n\n');
  }
  if (c && typeof c === 'object' && c.value) return String(c.value);
  return null;
}
