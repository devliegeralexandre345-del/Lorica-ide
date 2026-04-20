// src/components/RegexBuilder.jsx
//
// A regex workbench. Three things:
//   1. A pattern library of ~20 common regexes (email, URL, phone, IP,
//      UUID, semver, …) — click to load, tweak, and insert.
//   2. A live tester: type regex + sample text, matches highlight in
//      real-time with capture-group inspection.
//   3. A "cheat-sheet" rail documenting the common syntax — reduces
//      context-switching to an external docs tab for the 80% of regex
//      work we actually do.
//
// The panel inserts the final regex into the active editor at the cursor
// when the user clicks "Insert". No automation beyond that.

import React, { useEffect, useMemo, useState } from 'react';
import { Regex, BookOpen, Copy, Code2, Plus, Trash2, Star } from 'lucide-react';
import { compileSafe, boundedExec } from '../utils/safeRegex';

// Persistence — custom patterns live in `.lorica/regex-patterns.json` so
// they travel with the project; if no project is open, we fall back to
// localStorage so the panel still works.
const LS_KEY = 'lorica.regex.patterns.v1';

function projectPath(state) { return state?.projectPath || null; }
function patternsPath(p) {
  if (!p) return null;
  const sep = p.includes('\\') ? '\\' : '/';
  return `${p}${sep}.lorica${sep}regex-patterns.json`;
}
async function loadCustomPatterns(state) {
  const p = patternsPath(projectPath(state));
  if (p) {
    try {
      const r = await window.lorica.fs.readFile(p);
      if (r?.success) {
        const parsed = JSON.parse(r.data.content || '[]');
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {}
    return [];
  }
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
async function saveCustomPatterns(state, patterns) {
  const p = patternsPath(projectPath(state));
  if (p) {
    const sep = projectPath(state).includes('\\') ? '\\' : '/';
    try { await window.lorica.fs.createDir(`${projectPath(state)}${sep}.lorica`); } catch {}
    try { await window.lorica.fs.writeFile(p, JSON.stringify(patterns, null, 2)); return; } catch {}
  }
  try { localStorage.setItem(LS_KEY, JSON.stringify(patterns)); } catch {}
}

const PATTERNS = [
  { name: 'Email',            src: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", flags: 'g' },
  { name: 'URL (http/https)', src: "https?:\\/\\/[^\\s\"'<>`]+",                      flags: 'g' },
  { name: 'IPv4',             src: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",                 flags: 'g' },
  { name: 'IPv6 (simple)',    src: "(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}",        flags: 'g' },
  { name: 'UUID v4',          src: "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", flags: 'gi' },
  { name: 'Hex color',        src: "#(?:[0-9a-fA-F]{3}){1,2}\\b",                     flags: 'g' },
  { name: 'Semver',           src: "\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?",         flags: 'g' },
  { name: 'ISO 8601 date',    src: "\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?", flags: 'g' },
  { name: 'Phone (intl)',     src: "\\+?\\d[\\d\\s().-]{7,}\\d",                      flags: 'g' },
  { name: 'Credit card (loose)', src: "\\b(?:\\d[ -]*?){13,19}\\b",                  flags: 'g' },
  { name: 'JWT',              src: "eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+", flags: 'g' },
  { name: 'HTML tag',         src: "<\\/?[a-zA-Z][^>]*>",                             flags: 'g' },
  { name: 'Markdown link',    src: "\\[([^\\]]+)\\]\\(([^)]+)\\)",                   flags: 'g' },
  { name: 'Hashtag',          src: "#[A-Za-z0-9_]+",                                  flags: 'g' },
  { name: 'Number (int/dec)', src: "-?\\d+(?:\\.\\d+)?",                             flags: 'g' },
  { name: 'Whitespace line',  src: "^\\s*$",                                           flags: 'gm' },
  { name: 'TODO comment',     src: "\\b(TODO|FIXME|HACK|XXX|NOTE)\\b.*",             flags: 'g' },
  { name: 'File path (unix)', src: "(?:\\/[\\w.-]+)+\\/?",                             flags: 'g' },
  { name: 'Windows path',     src: "[A-Za-z]:\\\\(?:[\\w .-]+\\\\?)+",              flags: 'g' },
  { name: 'Base64',           src: "(?:[A-Za-z0-9+\\/]{4})+(?:[A-Za-z0-9+\\/]{2}==|[A-Za-z0-9+\\/]{3}=)?", flags: 'g' },
];

const CHEAT = [
  ['.',     'any char except newline'],
  ['\\d',   'digit'],
  ['\\w',   'word char [A-Za-z0-9_]'],
  ['\\s',   'whitespace'],
  ['\\D \\W \\S', 'negated'],
  ['^ $',   'start / end of line'],
  ['\\b',   'word boundary'],
  ['?',     '0 or 1'],
  ['*',     '0 or more'],
  ['+',     '1 or more'],
  ['{n,m}', 'n to m'],
  ['|',     'alternation'],
  ['()',    'capture group'],
  ['(?:)',  'non-capture'],
  ['(?=)',  'lookahead'],
  ['(?!)',  'negative lookahead'],
  ['[abc]', 'any of'],
  ['[^ab]', 'none of'],
  ['g i m s u', 'flags'],
];

export default function RegexBuilder({ state, dispatch }) {
  const [src, setSrc]       = useState(PATTERNS[0].src);
  const [flags, setFlags]   = useState(PATTERNS[0].flags);
  const [sample, setSample] = useState('foo@bar.com\nhttps://example.com/path?x=1\nTODO: write tests\nuuid: 550e8400-e29b-41d4-a716-446655440000');
  const [customPatterns, setCustomPatterns] = useState([]);
  const [newName, setNewName] = useState('');

  // Load custom patterns on mount / project change.
  useEffect(() => {
    (async () => setCustomPatterns(await loadCustomPatterns(state)))();
  }, [state.projectPath]);

  const saveCurrent = async () => {
    const name = (newName || '').trim();
    if (!name) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Give your pattern a name first', duration: 2000 } });
      return;
    }
    if (customPatterns.some((p) => p.name === name)) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Name already used', duration: 2000 } });
      return;
    }
    const next = [{ name, src, flags, createdAt: Date.now() }, ...customPatterns];
    setCustomPatterns(next);
    await saveCustomPatterns(state, next);
    setNewName('');
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Saved "${name}"`, duration: 1500 } });
  };
  const deleteCustom = async (name) => {
    const next = customPatterns.filter((p) => p.name !== name);
    setCustomPatterns(next);
    await saveCustomPatterns(state, next);
  };

  const { matches, error, truncated, timedOut } = useMemo(() => {
    // ReDoS guard — safeRegex rejects catastrophic shapes up front and
    // the bounded executor caps both match count and elapsed time so
    // the UI can't freeze on a pathological pattern.
    const { re, error: compileErr } = compileSafe(src, flags);
    if (compileErr) return { matches: [], error: compileErr };
    const { matches, truncated, timedOut } = boundedExec(re, sample, 500, 100);
    return { matches, truncated, timedOut };
  }, [src, flags, sample]);

  const highlighted = useMemo(() => {
    if (!matches.length) return [{ t: sample, k: 'n' }];
    const out = [];
    let cursor = 0;
    for (const m of matches) {
      if (m.idx > cursor) out.push({ t: sample.slice(cursor, m.idx), k: 'n' });
      out.push({ t: m.text, k: 'm' });
      cursor = m.idx + m.text.length;
    }
    if (cursor < sample.length) out.push({ t: sample.slice(cursor), k: 'n' });
    return out;
  }, [matches, sample]);

  const loadPattern = (p) => { setSrc(p.src); setFlags(p.flags); };

  const copyRegex = () => {
    navigator.clipboard.writeText(`/${src}/${flags}`).catch(() => {});
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Regex copied', duration: 1500 } });
  };

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showRegexBuilder', value: false });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div
        className="w-full max-w-5xl h-full max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_50px_rgba(0,212,255,0.2)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Regex size={14} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Regex Builder</div>
          <div className="flex-1" />
          <button onClick={copyRegex} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/40 transition-colors">
            <Copy size={11} /> Copy /regex/flags
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">×</button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: saved + library */}
          <div className="w-56 border-r border-lorica-border overflow-y-auto shrink-0">
            <div className="px-3 py-2 text-[9px] uppercase tracking-widest text-lorica-textDim sticky top-0 bg-lorica-panel/80 backdrop-blur border-b border-lorica-border flex items-center gap-1.5">
              <Star size={9} /> My patterns ({customPatterns.length})
            </div>
            <div className="p-2 border-b border-lorica-border/50 space-y-1">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name…"
                className="w-full bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[10px] outline-none"
              />
              <button
                onClick={saveCurrent}
                disabled={!newName.trim()}
                className="w-full flex items-center justify-center gap-1 text-[10px] text-lorica-accent border border-lorica-accent/40 rounded py-0.5 hover:bg-lorica-accent/10 disabled:opacity-30"
              >
                <Plus size={9} /> Save current
              </button>
            </div>
            {customPatterns.length === 0 && (
              <div className="px-3 py-2 text-[10px] text-lorica-textDim italic">No saved patterns yet.</div>
            )}
            {customPatterns.map((p) => (
              <div key={p.name} className="group flex items-center px-3 py-1.5 border-b border-lorica-border/30 hover:bg-lorica-accent/10">
                <button onClick={() => loadPattern(p)} className="flex-1 text-left text-[11px] text-lorica-text hover:text-lorica-accent truncate">
                  {p.name}
                </button>
                <button onClick={() => deleteCustom(p.name)} className="opacity-0 group-hover:opacity-100 text-lorica-textDim hover:text-red-400 transition-opacity">
                  <Trash2 size={9} />
                </button>
              </div>
            ))}
            <div className="px-3 py-2 mt-2 text-[9px] uppercase tracking-widest text-lorica-textDim sticky top-0 bg-lorica-panel/80 backdrop-blur border-y border-lorica-border flex items-center gap-1.5">
              <BookOpen size={9} /> Library
            </div>
            {PATTERNS.map((p) => (
              <button
                key={p.name}
                onClick={() => loadPattern(p)}
                className="w-full text-left px-3 py-1.5 text-[11px] text-lorica-text hover:bg-lorica-accent/10 hover:text-lorica-accent transition-colors border-b border-lorica-border/30"
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Middle: builder + tester */}
          <div className="flex-1 p-3 flex flex-col gap-2 overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="text-lorica-textDim font-mono">/</span>
              <input
                value={src}
                onChange={(e) => setSrc(e.target.value)}
                spellCheck={false}
                className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-xs font-mono text-lorica-accent outline-none focus:border-lorica-accent/60"
              />
              <span className="text-lorica-textDim font-mono">/</span>
              <div className="flex gap-1">
                {['g', 'i', 'm', 's', 'u'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFlags((cur) => cur.includes(f) ? cur.replace(f, '') : cur + f)}
                    className={`px-1.5 py-0.5 rounded border text-[10px] ${flags.includes(f) ? 'border-lorica-accent bg-lorica-accent/20 text-lorica-accent' : 'border-lorica-border text-lorica-textDim'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              spellCheck={false}
              placeholder="Paste or type sample text to test against."
              className="w-full h-32 bg-lorica-bg border border-lorica-border rounded p-2 text-[11px] font-mono text-lorica-text outline-none focus:border-lorica-accent/60 resize-none"
            />

            {error && <div className="text-[11px] text-red-400">Regex error: {error}</div>}
            {!error && (
              <div className="flex items-center gap-2 text-[10px] text-lorica-textDim">
                <span>{matches.length} match{matches.length === 1 ? '' : 'es'}</span>
                {matches.length > 0 && matches[0].groups.length > 0 && (
                  <span>· {matches[0].groups.length} capture group{matches[0].groups.length === 1 ? '' : 's'}</span>
                )}
                {truncated && <span className="text-amber-400">· truncated at 500</span>}
                {timedOut && <span className="text-red-400">· timed out (possible ReDoS)</span>}
              </div>
            )}

            <pre className="flex-1 overflow-auto bg-lorica-bg border border-lorica-border rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
              {highlighted.map((s, i) =>
                s.k === 'm'
                  ? <mark key={i} className="bg-lorica-accent/30 text-lorica-accent rounded px-0.5">{s.t}</mark>
                  : <span key={i}>{s.t}</span>
              )}
            </pre>
          </div>

          {/* Right: cheat sheet */}
          <div className="w-60 border-l border-lorica-border overflow-y-auto shrink-0">
            <div className="px-3 py-2 text-[9px] uppercase tracking-widest text-lorica-textDim sticky top-0 bg-lorica-panel/80 backdrop-blur border-b border-lorica-border flex items-center gap-1.5">
              <Code2 size={9} /> Cheat sheet
            </div>
            {CHEAT.map(([sig, desc]) => (
              <div key={sig} className="px-3 py-1 border-b border-lorica-border/30 flex items-start gap-2 text-[11px]">
                <code className="text-lorica-accent font-mono shrink-0">{sig}</code>
                <span className="text-lorica-textDim">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
