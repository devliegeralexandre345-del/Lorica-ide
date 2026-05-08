// Lazy-loaded autocomplete dispatcher.
//
// Design:
//   - Every language's word list lives in its own sibling file
//     (`./python.js`, `./rust.js`, …) and is NEVER imported statically.
//   - `getCompletionSource(language)` returns an async completion source
//     that dynamic-imports the right file on first use, caches the
//     resulting module, and runs an in-house ranker on the entries.
//   - Webpack code-splits each `import()` into its own chunk. A fresh
//     Lorica boot loads only the dispatcher (~2 KiB); opening a `.py`
//     file then fetches `python.chunk.js` once (tens of KiB), after
//     which everything is instant.
//
// Why: v2.2's single `completions.js` bundled ~10k entries into the
// main bundle (+~300 KiB parse cost on every cold start). Scaling to
// 2-4k per language across 30 languages (~60-120k entries total) would
// have pushed the main bundle past 4 MB and made startup unusable.
// Lazy-loading keeps the main bundle lean and only pays the parse cost
// for languages the user actually opens.
//
// The in-house ranker (vs. CodeMirror's built-in `completeFromList`)
// adds three things on top of label-prefix matching:
//   1. Fuzzy match against `detail` as well as `label`. So `vec` finds
//      both `Vec` (label match) and `BinaryHeap` whose detail says
//      "Vec<T>-backed priority queue" (detail-only match). Label
//      matches are boosted higher.
//   2. Recency boost. Entries the user accepted recently for THIS
//      language float to the top — see `./recencyStore.js`.
//   3. Snippet template support. Entries with `${...}` markers in their
//      `apply` field accept tab-stops on insertion via CodeMirror's
//      `snippet(template)` helper.

import { snippet } from '@codemirror/autocomplete';
import { getRecencyMap, recencyBoost, recordCompletion } from './recencyStore';

// ── Language → module loader map ────────────────────────────────────
// Each value is a thunk so webpack sees a literal `import()` per
// language (required for code-splitting — a generic helper that took
// `language` as a variable would produce ONE merged chunk).
//
// Keep all extension aliases pointing to the same loader. Webpack will
// dedupe the chunk automatically.
const LOADERS = {
  python:     () => import(/* webpackChunkName: "cmpl-python"    */ './python'),
  py:         () => import(/* webpackChunkName: "cmpl-python"    */ './python'),

  javascript: () => import(/* webpackChunkName: "cmpl-jsts"      */ './javascript'),
  js:         () => import(/* webpackChunkName: "cmpl-jsts"      */ './javascript'),
  jsx:        () => import(/* webpackChunkName: "cmpl-jsts"      */ './javascript'),
  typescript: () => import(/* webpackChunkName: "cmpl-jsts"      */ './javascript'),
  ts:         () => import(/* webpackChunkName: "cmpl-jsts"      */ './javascript'),
  tsx:        () => import(/* webpackChunkName: "cmpl-jsts"      */ './javascript'),

  rust:       () => import(/* webpackChunkName: "cmpl-rust"      */ './rust'),
  rs:         () => import(/* webpackChunkName: "cmpl-rust"      */ './rust'),

  go:         () => import(/* webpackChunkName: "cmpl-go"        */ './go'),

  c:          () => import(/* webpackChunkName: "cmpl-c"         */ './c'),
  cpp:        () => import(/* webpackChunkName: "cmpl-cpp"       */ './cpp'),
  cc:         () => import(/* webpackChunkName: "cmpl-cpp"       */ './cpp'),
  cxx:        () => import(/* webpackChunkName: "cmpl-cpp"       */ './cpp'),
  h:          () => import(/* webpackChunkName: "cmpl-cpp"       */ './cpp'),
  hpp:        () => import(/* webpackChunkName: "cmpl-cpp"       */ './cpp'),

  csharp:     () => import(/* webpackChunkName: "cmpl-csharp"    */ './csharp'),
  cs:         () => import(/* webpackChunkName: "cmpl-csharp"    */ './csharp'),

  java:       () => import(/* webpackChunkName: "cmpl-java"      */ './java'),

  kotlin:     () => import(/* webpackChunkName: "cmpl-kotlin"    */ './kotlin'),
  kt:         () => import(/* webpackChunkName: "cmpl-kotlin"    */ './kotlin'),

  swift:      () => import(/* webpackChunkName: "cmpl-swift"     */ './swift'),

  ruby:       () => import(/* webpackChunkName: "cmpl-ruby"      */ './ruby'),
  rb:         () => import(/* webpackChunkName: "cmpl-ruby"      */ './ruby'),

  php:        () => import(/* webpackChunkName: "cmpl-php"       */ './php'),

  dart:       () => import(/* webpackChunkName: "cmpl-dart"      */ './dart'),

  html:       () => import(/* webpackChunkName: "cmpl-html"      */ './html'),
  htm:        () => import(/* webpackChunkName: "cmpl-html"      */ './html'),

  css:        () => import(/* webpackChunkName: "cmpl-css"       */ './css'),
  scss:       () => import(/* webpackChunkName: "cmpl-css"       */ './css'),

  sql:        () => import(/* webpackChunkName: "cmpl-sql"       */ './sql'),

  bash:       () => import(/* webpackChunkName: "cmpl-bash"      */ './bash'),
  sh:         () => import(/* webpackChunkName: "cmpl-bash"      */ './bash'),
  shell:      () => import(/* webpackChunkName: "cmpl-bash"      */ './bash'),
  zsh:        () => import(/* webpackChunkName: "cmpl-bash"      */ './bash'),

  yaml:       () => import(/* webpackChunkName: "cmpl-yaml"      */ './yaml'),
  yml:        () => import(/* webpackChunkName: "cmpl-yaml"      */ './yaml'),

  toml:       () => import(/* webpackChunkName: "cmpl-toml"      */ './toml'),

  json:       () => import(/* webpackChunkName: "cmpl-json"      */ './json'),
  jsonc:      () => import(/* webpackChunkName: "cmpl-json"      */ './json'),
  json5:      () => import(/* webpackChunkName: "cmpl-json"      */ './json'),

  xml:        () => import(/* webpackChunkName: "cmpl-xml"       */ './xml'),
  svg:        () => import(/* webpackChunkName: "cmpl-xml"       */ './xml'),
  plist:      () => import(/* webpackChunkName: "cmpl-xml"       */ './xml'),
  xsl:        () => import(/* webpackChunkName: "cmpl-xml"       */ './xml'),
  xslt:       () => import(/* webpackChunkName: "cmpl-xml"       */ './xml'),
  xsd:        () => import(/* webpackChunkName: "cmpl-xml"       */ './xml'),

  markdown:   () => import(/* webpackChunkName: "cmpl-markdown"  */ './markdown'),
  md:         () => import(/* webpackChunkName: "cmpl-markdown"  */ './markdown'),
  mdx:        () => import(/* webpackChunkName: "cmpl-markdown"  */ './markdown'),

  lua:        () => import(/* webpackChunkName: "cmpl-lua"       */ './lua'),

  r:          () => import(/* webpackChunkName: "cmpl-r"         */ './r'),
  rmd:        () => import(/* webpackChunkName: "cmpl-r"         */ './r'),

  elixir:     () => import(/* webpackChunkName: "cmpl-elixir"    */ './elixir'),
  ex:         () => import(/* webpackChunkName: "cmpl-elixir"    */ './elixir'),
  exs:        () => import(/* webpackChunkName: "cmpl-elixir"    */ './elixir'),

  scala:      () => import(/* webpackChunkName: "cmpl-scala"     */ './scala'),

  haskell:    () => import(/* webpackChunkName: "cmpl-haskell"   */ './haskell'),
  hs:         () => import(/* webpackChunkName: "cmpl-haskell"   */ './haskell'),
  lhs:        () => import(/* webpackChunkName: "cmpl-haskell"   */ './haskell'),

  ocaml:      () => import(/* webpackChunkName: "cmpl-ocaml"     */ './ocaml'),
  ml:         () => import(/* webpackChunkName: "cmpl-ocaml"     */ './ocaml'),
  mli:        () => import(/* webpackChunkName: "cmpl-ocaml"     */ './ocaml'),

  zig:        () => import(/* webpackChunkName: "cmpl-zig"       */ './zig'),

  nim:        () => import(/* webpackChunkName: "cmpl-nim"       */ './nim'),

  crystal:    () => import(/* webpackChunkName: "cmpl-crystal"   */ './crystal'),
  cr:         () => import(/* webpackChunkName: "cmpl-crystal"   */ './crystal'),
};

// Cache: language-key → Promise<entries[]>. Stores the promise itself
// so concurrent callers all share the same in-flight load.
const cache = new Map();

// Per-language cache of the "prepared" entries (apply wrapped for
// snippets, recorder hook in place). We do this once-per-language at
// load time so each keystroke just re-ranks an already-prepared array.
const preparedCache = new Map();

function loadEntries(language) {
  if (cache.has(language)) return cache.get(language);
  const loader = LOADERS[language];
  if (!loader) {
    const p = Promise.resolve([]);
    cache.set(language, p);
    return p;
  }
  const p = loader()
    .then((mod) => mod.default || [])
    .catch((e) => {
      // A missing chunk should degrade gracefully to "no completions"
      // rather than blowing up the editor.
      console.warn(`[completions] failed to load ${language}:`, e);
      return [];
    });
  cache.set(language, p);
  return p;
}

// ── Snippet detection / preparation ─────────────────────────────────
// A snippet entry uses `${name}` or `${1:default}` markers in its
// `apply` field. We detect that and replace `apply` with the function
// CodeMirror's `snippet()` helper produces, which handles tab-stops
// and field navigation.
//
// Forward-compatibility: many existing dictionary entries store
// `${name}` placeholders without explicit numbering (e.g.
// `def ${function_name}(${args}):`). CM's `snippet()` accepts that —
// fields get auto-numbered in textual order. Entries WITHOUT any
// placeholder are left alone (their `apply` is just a literal string).
const SNIPPET_MARKER_RE = /\$\{[^}]*\}|#\{[^}]*\}/;

function hasSnippetMarkers(text) {
  return typeof text === 'string' && SNIPPET_MARKER_RE.test(text);
}

/**
 * Wrap an entry's `apply` field. For string `apply` with snippet
 * markers, we route through CodeMirror's `snippet()` so the user gets
 * tab-stops. For plain string `apply`, we wrap it in a function that
 * inserts the literal text and records the pick. For undefined `apply`
 * (default = insert label), same wrap using the label.
 *
 * The recorder is the only way we can hook completion-accepted events
 * without modifying Editor.jsx — every CM accept path eventually calls
 * the option's `apply`, so we intercept there.
 */
function prepareEntry(entry, language) {
  const label = entry.label;
  const isSnippet = entry.type === 'snippet' || hasSnippetMarkers(entry.apply);

  if (isSnippet && typeof entry.apply === 'string') {
    const tmpl = entry.apply;
    const snippetFn = snippet(tmpl);
    return {
      ...entry,
      apply: (view, completion, from, to) => {
        try { recordCompletion(language, label); } catch {}
        snippetFn(view, completion, from, to);
      },
    };
  }

  // Plain literal apply (string) or default (undefined → insert label).
  const literal = typeof entry.apply === 'string' ? entry.apply : label;
  return {
    ...entry,
    apply: (view, completion, from, to) => {
      try { recordCompletion(language, label); } catch {}
      view.dispatch({
        changes: { from, to, insert: literal },
        selection: { anchor: from + literal.length },
        scrollIntoView: true,
        userEvent: 'input.complete',
      });
    },
  };
}

function getPrepared(language, raw) {
  const cached = preparedCache.get(language);
  if (cached && cached.raw === raw) return cached.prepared;
  // Each entry that's a string in the raw list (rare in our dicts but
  // CodeMirror accepts it) becomes `{ label }` first.
  const prepared = raw.map((e) => {
    const obj = typeof e === 'string' ? { label: e } : e;
    return prepareEntry(obj, language);
  });
  preparedCache.set(language, { raw, prepared });
  return prepared;
}

// ── Ranking ─────────────────────────────────────────────────────────
// Two-pass scorer:
//   1. Prefix match on label  → biggest match score (case-insensitive).
//   2. Substring match on label → smaller score.
//   3. Substring match on detail → smallest score, label still wins.
//
// We feed CodeMirror `boost` per option so multiple equally-prefixed
// matches still sort by recency. CodeMirror uses boost in -99..99,
// matched-position-weighted; recency boost is bounded at +20 so it
// can flip same-prefix entries but won't drown out a real prefix
// match over a substring detail-only hit.

const PREFIX_LABEL_BOOST    = 30;
const SUBSTR_LABEL_BOOST    = 10;
const SUBSTR_DETAIL_BOOST   = -5; // detail-only hits sort below label hits

/** Compute a label-highlight match range for `getMatch`. */
function labelMatchRanges(label, query) {
  if (!query) return [];
  const idx = label.toLowerCase().indexOf(query);
  if (idx < 0) return [];
  return [idx, idx + query.length];
}

/**
 * Build a CompletionResult for the given prepared entries and the
 * user's current word. Caller has already verified there's something
 * to match against.
 */
function rankAndFilter(prepared, language, word, fromPos) {
  const q = word.toLowerCase();
  const recency = getRecencyMap(language);
  const now = Date.now();
  const out = [];

  for (const entry of prepared) {
    const label = entry.label;
    if (typeof label !== 'string' || !label) continue;
    const lbl = label.toLowerCase();
    const det = typeof entry.detail === 'string' ? entry.detail.toLowerCase() : '';

    let kindBoost = null;
    if (lbl.startsWith(q))         kindBoost = PREFIX_LABEL_BOOST;
    else if (lbl.includes(q))      kindBoost = SUBSTR_LABEL_BOOST;
    else if (det && det.includes(q)) kindBoost = SUBSTR_DETAIL_BOOST;

    if (kindBoost === null) continue;

    const baseBoost = typeof entry.boost === 'number' ? entry.boost : 0;
    const rBoost = recencyBoost(recency, label, now);
    // Cap final boost at +99 (CodeMirror's documented range).
    const finalBoost = Math.max(-99, Math.min(99, baseBoost + kindBoost + rBoost));

    out.push({ ...entry, boost: finalBoost });
  }

  return {
    from: fromPos,
    options: out,
    // We did our own filtering; tell CodeMirror not to re-filter.
    filter: false,
    // `validFor` is intentionally permissive (any word/dot chars) so
    // typing more characters lets CM reuse this result without
    // re-querying us. Not capitalization-restrictive — `iter` should
    // continue to match `Iterator` as the user types more letters.
    // We pair it with `update` below so the in-place re-match still
    // takes recency + detail-fuzzy into account.
    validFor: /^[\w.]*$/,
    update: (current, from, to, ctx) => {
      const newWord = ctx.state.sliceDoc(from, to);
      if (!newWord) return null;
      return rankAndFilter(prepared, language, newWord.toLowerCase(), from);
    },
    getMatch: (completion) => labelMatchRanges(completion.label, q),
  };
}

// ── C/C++ context-aware include header completion ───────────────────
// When the cursor is in `#include <...>` or `#include "..."`, we want
// to suggest header names regardless of whether the language file for
// C or C++ has finished loading yet. The header list is tiny and
// static, so we inline it here (same as the previous implementation)
// rather than pay a dynamic import just to surface 100 strings.
const CPP_STD_HEADERS = [
  'vector', 'array', 'deque', 'list', 'forward_list', 'set', 'map',
  'multiset', 'multimap', 'unordered_set', 'unordered_map',
  'unordered_multiset', 'unordered_multimap', 'stack', 'queue',
  'priority_queue', 'span',
  'string', 'string_view', 'iostream', 'fstream', 'sstream', 'iomanip',
  'ostream', 'istream', 'ios', 'streambuf',
  'algorithm', 'numeric', 'iterator', 'functional', 'utility', 'tuple',
  'optional', 'variant', 'any', 'memory', 'type_traits', 'concepts',
  'ranges', 'bit', 'compare',
  'thread', 'mutex', 'shared_mutex', 'condition_variable', 'future',
  'atomic', 'barrier', 'latch', 'semaphore', 'stop_token',
  'chrono', 'random', 'cmath', 'complex', 'limits', 'numbers', 'ratio',
  'exception', 'stdexcept', 'system_error', 'cassert', 'cerrno',
  'filesystem', 'charconv', 'format',
  'typeindex', 'typeinfo', 'bitset', 'new', 'scoped_allocator',
  'coroutine', 'source_location',
];
const C_STD_HEADERS = [
  'stdio.h', 'stdlib.h', 'string.h', 'ctype.h', 'math.h', 'time.h',
  'errno.h', 'assert.h', 'limits.h', 'float.h', 'stddef.h', 'stdint.h',
  'stdbool.h', 'inttypes.h', 'signal.h', 'setjmp.h', 'stdarg.h',
  'locale.h', 'wchar.h', 'wctype.h', 'fenv.h', 'complex.h', 'tgmath.h',
  'unistd.h', 'fcntl.h', 'sys/types.h', 'sys/stat.h', 'sys/wait.h',
  'sys/socket.h', 'sys/mman.h', 'pthread.h', 'dirent.h', 'dlfcn.h',
  'netinet/in.h', 'arpa/inet.h', 'netdb.h', 'termios.h',
];

function matchIncludeContext(lineText, col) {
  const before = lineText.slice(0, col);
  const m = /#\s*include\s*([<"])([^>"]*)$/.exec(before);
  if (!m) return null;
  return { opener: m[1], prefix: m[2] };
}

function cCppIncludeOptions(language) {
  return [
    ...(language === 'c' ? [] : CPP_STD_HEADERS.map((h) => ({
      label: h, type: 'module', info: `C++ standard header <${h}>`,
    }))),
    ...C_STD_HEADERS.map((h) => ({
      label: h, type: 'module', info: `C standard header <${h}>`,
    })),
  ];
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Return a CodeMirror async completion source for a given language.
 * The returned function triggers chunk loading on first call; subsequent
 * calls hit the in-memory cache.
 *
 * @param {string} language  — file extension or language name
 * @returns {import('@codemirror/autocomplete').CompletionSource}
 */
export function getCompletionSource(language) {
  const isCFamily = language === 'c' || language === 'cpp' ||
                    language === 'cc' || language === 'cxx' ||
                    language === 'h'  || language === 'hpp';

  return async (ctx) => {
    // C/C++ special case: intercept `#include <` before the generic
    // path so headers are suggested even if the language chunk is
    // still loading on first use.
    if (isCFamily) {
      const line = ctx.state.doc.lineAt(ctx.pos);
      const col = ctx.pos - line.from;
      const inc = matchIncludeContext(line.text, col);
      if (inc) {
        return {
          from: ctx.pos - inc.prefix.length,
          options: cCppIncludeOptions(language === 'c' ? 'c' : 'cpp'),
          validFor: /^[\w./-]*$/,
        };
      }
    }

    const raw = await loadEntries(language);
    if (!raw.length) {
      // Language with no entries yet (custom / niche file the agent
      // is still wiring up). Returning null lets other sources
      // (LSP, completeAnyWord) contribute without interference.
      return null;
    }

    const word = ctx.matchBefore(/[\w.]+/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const typed = word.text;

    const prepared = getPrepared(language, raw);
    return rankAndFilter(prepared, language, typed.toLowerCase(), word.from);
  };
}

/**
 * Eagerly preload a language's chunk. Useful for "predict what the
 * user is about to open" heuristics (e.g. when a project contains
 * `Cargo.toml`, preload `cmpl-rust`).
 */
export function preload(language) {
  return loadEntries(language);
}

/** Clear a cached chunk — mainly for tests. */
export function __clearCache() {
  cache.clear();
  preparedCache.clear();
}
