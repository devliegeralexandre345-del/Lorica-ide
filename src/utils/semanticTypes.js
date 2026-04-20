// src/utils/semanticTypes.js
//
// LLM-driven semantic brand-type inference. We feed the model a JS/TS
// file's source + optionally a few related files, and ask it to infer
// which string/number parameters carry semantic meaning (UserId,
// EmailAddress, CurrencyCents, …) and where they get mismatched.
//
// The result is stored per-project in `.lorica/semantic-types.json`:
//
//   {
//     "<abs path>": {
//       "inferredAt": <timestamp>,
//       "brands": ["UserId", "GroupId", ...],
//       "mismatches": [
//         { "line": 42, "col": 12, "length": 6,
//           "severity": "warning",
//           "message": "GroupId flowing into UserId parameter" }
//       ]
//     }
//   }
//
// The editor reads this file on open and renders underlines + tooltips
// via CodeMirror decorations (see extension in ../extensions/semanticMarks.js).

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK  = 'https://api.deepseek.com/v1/chat/completions';
const MODELS = { anthropic: 'claude-3-5-haiku-20241022', deepseek: 'deepseek-chat' };

const SYSTEM = [
  'You infer semantic brand types for JS/TS/Python code and flag mismatches.',
  'Many values have the SAME primitive type but carry DIFFERENT meaning — e.g.',
  'UserId and GroupId are both strings; mixing them is a bug. Your job is to',
  'recognize these from usage (names, source/sink of values, adjacent comments)',
  'and report on mismatched flow.',
  '',
  'Return STRICT JSON, no prose, no fences:',
  '{',
  '  "brands": ["UserId", "GroupId", "EmailAddress", ...],',
  '  "mismatches": [',
  '    { "line": <1-indexed>, "col": <0-indexed char>, "length": <chars>,',
  '      "severity": "warning" | "info",',
  '      "expected": "UserId", "actual": "GroupId",',
  '      "message": "<1 sentence explanation>" }',
  '  ]',
  '}',
  '',
  'Rules:',
  '  • Be CONSERVATIVE — only flag clear brand confusions, not generic type bugs.',
  '  • Do NOT flag primitives mixing with their own brand (e.g. "string" into UserId).',
  '  • `line` is 1-indexed; `col` is 0-indexed character offset on that line.',
  '  • If nothing is inferable, return {"brands":[],"mismatches":[]}.',
].join('\n');

async function robustFetch(url, opts, preferNative) {
  try { return preferNative ? await fetch(url, opts) : await tauriFetch(url, opts); }
  catch { return preferNative ? await tauriFetch(url, opts) : await fetch(url, opts); }
}

function parse(text) {
  if (!text) return null;
  let t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try {
    const o = JSON.parse(t.slice(s, e + 1));
    return {
      brands: Array.isArray(o.brands) ? o.brands : [],
      mismatches: Array.isArray(o.mismatches) ? o.mismatches.filter((m) =>
        typeof m.line === 'number' && typeof m.message === 'string'
      ) : [],
    };
  } catch { return null; }
}

export async function inferSemanticTypes({ filePath, code, provider, apiKey, signal }) {
  const model = MODELS[provider] || MODELS.anthropic;
  const userMsg = [
    `File: ${filePath}`,
    '```',
    code.slice(0, 20000),
    '```',
    'Return the JSON now.',
  ].join('\n');
  if (provider === 'anthropic') {
    const r = await robustFetch(ANTHROPIC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model, max_tokens: 2000, temperature: 0.1,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal,
    }, false);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return parse((data?.content || []).map((b) => b.text || '').join(''));
  }
  const r = await robustFetch(DEEPSEEK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, max_tokens: 2000, temperature: 0.1,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
    }),
    signal,
  }, true);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return parse(data?.choices?.[0]?.message?.content || '');
}

function storePath(projectPath) {
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath}${sep}.lorica${sep}semantic-types.json`;
}

export async function loadSemanticStore(projectPath) {
  const p = storePath(projectPath);
  if (!p) return {};
  try {
    const r = await window.lorica.fs.readFile(p);
    if (!r?.success) return {};
    return JSON.parse(r.data.content);
  } catch { return {}; }
}

export async function saveSemanticStore(projectPath, store) {
  const p = storePath(projectPath);
  if (!p) return;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  try { await window.lorica.fs.createDir(`${projectPath}${sep}.lorica`); } catch {}
  try { await window.lorica.fs.writeFile(p, JSON.stringify(store, null, 2)); } catch {}
}

// Generate a TypeScript module declaring every inferred brand as a branded
// type. The user can check this in and use it as an actual type boundary.
// Bundled as a single file so it's drop-in.
export function exportBrandsToTypescript(store) {
  const all = new Set();
  for (const entry of Object.values(store || {})) {
    for (const b of (entry.brands || [])) all.add(b);
  }
  const brands = [...all].filter((b) => /^[A-Z][A-Za-z0-9_]*$/.test(b)).sort();
  if (brands.length === 0) return '// No brands inferred yet.\n';
  const lines = [
    '// Auto-generated by Lorica Semantic Types.',
    '// DO NOT edit by hand — regenerate from the Semantic Types panel.',
    '',
    '// Branded primitive type helper — zero runtime cost.',
    "declare const __brand: unique symbol;",
    'export type Brand<T, B extends string> = T & { readonly [__brand]: B };',
    '',
  ];
  for (const b of brands) {
    lines.push(`export type ${b} = Brand<string, '${b}'>;`);
  }
  lines.push('', '// Constructors — runtime is a no-op cast; these exist so you can opt in gradually.');
  for (const b of brands) {
    lines.push(`export const ${b} = (s: string): ${b} => s as ${b};`);
  }
  return lines.join('\n') + '\n';
}

// Aggregate stats across the whole store for the panel UI.
export function summarizeStore(store) {
  const brands = new Map();
  let totalMismatches = 0;
  let files = 0;
  for (const [path, entry] of Object.entries(store || {})) {
    files++;
    for (const b of (entry.brands || [])) {
      if (!brands.has(b)) brands.set(b, { count: 0, files: [] });
      const bucket = brands.get(b);
      bucket.count++;
      bucket.files.push(path);
    }
    totalMismatches += (entry.mismatches || []).length;
  }
  return {
    brands: [...brands.entries()]
      .map(([name, { count, files }]) => ({ name, count, files }))
      .sort((a, b) => b.count - a.count),
    totalMismatches,
    files,
  };
}
