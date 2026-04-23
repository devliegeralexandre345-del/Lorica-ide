// One-shot migration: split `src/utils/completions.js` into per-language
// files under `src/utils/completions/`. Safe to run multiple times —
// each run overwrites target files cleanly.
//
// Usage: `node scripts/split-completions.mjs`
//
// After running, the old `completions.js` is renamed to `completions.legacy.js`
// so webpack falls through to `completions/index.js` (already in place).

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src', 'utils', 'completions.js');
const OUT = join(root, 'src', 'utils', 'completions');

// Map: ConstName → output filename (without .js)
const MAP = {
  JS_TS_COMPLETIONS:    'javascript',
  PYTHON_COMPLETIONS:   'python',
  RUST_COMPLETIONS:     'rust',
  C_CPP_COMPLETIONS:    'cpp',         // we'll also write c.js as an alias
  CSHARP_COMPLETIONS:   'csharp',
  GO_COMPLETIONS:       'go',
  HTML_COMPLETIONS:     'html',
  CSS_COMPLETIONS:      'css',
  SQL_COMPLETIONS:      'sql',
  JAVA_COMPLETIONS:     'java',
  PHP_COMPLETIONS:      'php',
  RUBY_COMPLETIONS:     'ruby',
  KOTLIN_COMPLETIONS:   'kotlin',
  SWIFT_COMPLETIONS:    'swift',
  DART_COMPLETIONS:     'dart',
  YAML_COMPLETIONS:     'yaml',
  TOML_COMPLETIONS:     'toml',
  BASH_COMPLETIONS:     'bash',
  MARKDOWN_COMPLETIONS: 'markdown',
  JSON_COMPLETIONS:     'json',
  XML_COMPLETIONS:      'xml',
  LUA_COMPLETIONS:      'lua',
  R_COMPLETIONS:        'r',
  ELIXIR_COMPLETIONS:   'elixir',
  SCALA_COMPLETIONS:    'scala',
  HASKELL_COMPLETIONS:  'haskell',
  OCAML_COMPLETIONS:    'ocaml',
  ZIG_COMPLETIONS:      'zig',
  NIM_COMPLETIONS:      'nim',
  CRYSTAL_COMPLETIONS:  'crystal',
};

const source = readFileSync(SRC, 'utf8');

/** Extract the body of `const NAME = [ ... ];` including the brackets. */
function extractArray(constName) {
  const re = new RegExp(`const\\s+${constName}\\s*=\\s*\\[`, 'm');
  const m = source.match(re);
  if (!m) throw new Error(`${constName} not found`);
  const startOfArray = m.index + m[0].length - 1; // position of the `[`

  // Walk forward balancing brackets. Naive approach: track [ and ]
  // depth, counting only those OUTSIDE of strings/regex. Entries are
  // single-line `{ ... }` objects so this is safe.
  let depth = 0;
  let i = startOfArray;
  let inStr = null;     // current string delimiter (' " `)
  let escape = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (escape) { escape = false; continue; }
    if (inStr) {
      if (c === '\\') escape = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return source.slice(startOfArray, i);
}

const HEADER = (lang) => `// Completion entries for ${lang}.
// Auto-generated from the legacy monolithic completions.js by
// \`scripts/split-completions.mjs\`. Safe to hand-edit after the split —
// just keep the \`export default\` array shape.
//
// Entry shape: { label, type, info, apply? }
//   - \`type\` is one of keyword / function / class / variable / module
//     / constant / method / property / snippet
//   - \`info\` is a ≤60-char description shown in the autocomplete tooltip
//   - \`apply\` (optional) overrides what gets inserted when the entry is
//     chosen — used for snippets with placeholders

export default `;

// Write each language file.
for (const [constName, lang] of Object.entries(MAP)) {
  const body = extractArray(constName);
  const out = join(OUT, `${lang}.js`);
  writeFileSync(out, HEADER(lang) + body + ';\n');
  console.log(`wrote ${out}  (${body.length} bytes)`);
}

// C is an alias of cpp — share the same array so we don't duplicate data.
// The dispatcher maps both extensions to the same chunk name anyway, but
// having a distinct file lets the dispatcher disambiguate in case future
// maintainers want C-only or C++-only entries.
const cppBody = extractArray('C_CPP_COMPLETIONS');
writeFileSync(
  join(OUT, 'c.js'),
  `// Re-export of the shared C/C++ completion list. Kept as its own
// module so the dispatcher can load it under the \`c\` extension; the
// actual data is identical to cpp.js because most of the builtins
// overlap and splitting them by standard is more trouble than it's
// worth for autocomplete.

export { default } from './cpp.js';
`,
);
console.log(`wrote ${join(OUT, 'c.js')}  (alias of cpp)`);

// Finally, rename legacy file so webpack picks up completions/index.js.
const legacy = SRC.replace(/\.js$/, '.legacy.js');
renameSync(SRC, legacy);
console.log(`renamed ${SRC}  →  ${legacy}`);

console.log('\nDone. Run \`npm run build\` to verify webpack picks up the new entry point.');
