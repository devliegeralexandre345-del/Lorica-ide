// Lazy-loaded autocomplete dispatcher.
//
// Design:
//   - Every language's word list lives in its own sibling file
//     (`./python.js`, `./rust.js`, …) and is NEVER imported statically.
//   - `getCompletionSource(language)` returns an async completion source
//     that dynamic-imports the right file on first use, caches the
//     resulting module, and forwards to CodeMirror's `completeFromList`.
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

import { completeFromList } from '@codemirror/autocomplete';

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

    const entries = await loadEntries(language);
    if (!entries.length) return null;
    const source = completeFromList(entries);
    return source(ctx);
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
}
