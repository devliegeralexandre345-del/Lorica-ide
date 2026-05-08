// Build script — invokes each language generator and writes its
// completion file. Run with `node scripts/completions-gen/build.mjs`.

import path from 'node:path';
import { emit } from './helpers.mjs';
import { buildHaskell } from './haskell.mjs';
import { buildOCaml } from './ocaml.mjs';
import { buildZig } from './zig.mjs';
import { buildNim } from './nim.mjs';
import { buildCrystal } from './crystal.mjs';

const root = path.resolve(process.cwd());
const outDir = path.join(root, 'src', 'utils', 'completions');

const targets = [
  { lang: 'haskell', build: buildHaskell, file: 'haskell.js' },
  { lang: 'ocaml',   build: buildOCaml,   file: 'ocaml.js' },
  { lang: 'zig',     build: buildZig,     file: 'zig.js' },
  { lang: 'nim',     build: buildNim,     file: 'nim.js' },
  { lang: 'crystal', build: buildCrystal, file: 'crystal.js' },
];

for (const t of targets) {
  const entries = t.build();
  const labels = new Set(entries.map((e) => e.label));
  if (labels.size !== entries.length) {
    throw new Error(`${t.lang}: duplicate labels detected`);
  }
  emit(path.join(outDir, t.file), t.lang, entries);
  console.log(`${t.lang}: ${entries.length} entries written to ${t.file}`);
}
