// src/components/InstantPreview.jsx
//
// The Instant Preview side rail. Based on the active file's content we
// auto-detect whether one of our live visualizers should render, and pipe
// the content into it. When no visualizer applies we just don't render —
// there's no "empty state" because the rail is opt-in (toggled from the
// status bar / command palette).
//
// Visualizers (all 100% client-side, no deps beyond what we already have):
//   • JSON      — collapsible tree, path breadcrumb, type chips
//   • YAML      — same tree UI, reused parser
//   • CSV/TSV   — rendered as a scrolling table with frozen header
//   • Regex     — live matcher against sample text (first occurrences
//                 highlighted); toggle flags (g/i/m/s/u)
//   • URL/HTTP  — friendly URL inspector (parts, params, decoded)
//   • SQL       — naive identifier extractor producing a compact relation
//                 sketch; good enough to sanity-check joins without a full
//                 parser.
//
// Each visualizer is its own memoized sub-component — stay light by only
// recomputing when the *detected* content for that visualizer changes.
//
// We intentionally keep the parser toolbox minimal: for anything more
// complex (full YAML spec, SQL AST) we'd add a dep. Right now the goal is
// "useful 90% of the time" without bloating the bundle.

import React, { useMemo, useState } from 'react';
import { X, FileJson, Database, Regex, Link as LinkIcon, TableProperties, Sheet, FileCode, Globe, FileText } from 'lucide-react';
import { compileSafe, boundedExec } from '../utils/safeRegex';

// ── Lightweight JSON/YAML tree ───────────────────────────────────────────
const TypeColor = {
  string:  'text-emerald-400',
  number:  'text-sky-400',
  boolean: 'text-purple-400',
  null:    'text-lorica-textDim italic',
};

function JsonNode({ label, value, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  if (value === null) {
    return (
      <div style={{ paddingLeft: depth * 12 }} className="text-[11px] font-mono flex gap-2">
        {label != null && <span className="text-amber-300">"{label}"</span>}
        <span className={TypeColor.null}>null</span>
      </div>
    );
  }
  const type = Array.isArray(value) ? 'array' : typeof value;
  if (type === 'object' || type === 'array') {
    const entries = type === 'array'
      ? value.map((v, i) => [i, v])
      : Object.entries(value);
    return (
      <div style={{ paddingLeft: depth * 12 }} className="text-[11px] font-mono">
        <button
          onClick={() => setOpen(!open)}
          className="text-lorica-textDim hover:text-lorica-accent select-none"
        >
          {open ? '▾' : '▸'} {label != null ? <>"<span className="text-amber-300">{label}</span>"</> : null}
          {label != null && ' '}
          <span className="opacity-60">{type === 'array' ? `[${entries.length}]` : `{${entries.length}}`}</span>
        </button>
        {open && entries.map(([k, v]) => (
          <JsonNode key={k} label={String(k)} value={v} depth={depth + 1} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ paddingLeft: depth * 12 }} className="text-[11px] font-mono flex gap-2">
      {label != null && <span className="text-amber-300">"{label}":</span>}
      <span className={TypeColor[type] || 'text-lorica-text'}>
        {type === 'string' ? `"${value}"` : String(value)}
      </span>
    </div>
  );
}

// A tiny YAML parser good enough for flat-to-moderately-nested configs.
// For anything exotic (anchors, multiline scalars with weird indicators)
// we fall back to "couldn't parse" and show nothing. That's fine — this
// is a nice-to-have, not a source of truth.
function tryParseYaml(text) {
  try {
    // Strip comments
    const lines = text.split('\n').map((l) => l.replace(/(?:^|\s)#.*$/, '')).filter((l) => l.length > 0);
    const root = {};
    const stack = [{ node: root, indent: -1 }];
    for (const raw of lines) {
      const indent = raw.length - raw.trimStart().length;
      const line = raw.trim();
      while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1]?.node;
      if (!parent) return null;
      if (line.startsWith('- ')) {
        const val = parseYamlScalar(line.slice(2));
        if (!Array.isArray(parent._list)) parent._list = [];
        parent._list.push(val);
        continue;
      }
      const colon = line.indexOf(':');
      if (colon === -1) return null;
      const key = line.slice(0, colon).trim();
      const rest = line.slice(colon + 1).trim();
      if (!rest) {
        const obj = {};
        parent[key] = obj;
        stack.push({ node: obj, indent });
      } else {
        parent[key] = parseYamlScalar(rest);
      }
    }
    return root;
  } catch { return null; }
}
function parseYamlScalar(s) {
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

// ── CSV / TSV parser ─────────────────────────────────────────────────────
function parseCsv(text, sep) {
  // Minimal: quoted fields with embedded separator and double-quote escape.
  const rows = [];
  let cur = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === sep)        { cur.push(field); field = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field); field = '';
      rows.push(cur); cur = [];
      i++; continue;
    }
    field += c; i++;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  // Cap at 1000 rows so massive files don't stall the viewer.
  return rows.slice(0, 1000);
}

// ── Regex tester ─────────────────────────────────────────────────────────
function RegexTester({ text }) {
  const [sample, setSample] = useState('Paste text here to test matches.\nLine 2.\nEmail: foo@bar.com\nPhone: 555-1234');
  const [flags, setFlags] = useState('g');
  const { matches, error } = useMemo(() => {
    const src = extractRegex(text);
    if (!src) return { matches: [], error: 'No regex found' };
    // ReDoS guard — compileSafe rejects known-bad shapes, boundedExec
    // caps runtime so a pasted-in pattern can't freeze the UI.
    const { re, error: compileErr } = compileSafe(src, flags);
    if (compileErr) return { matches: [], error: compileErr };
    const { matches } = boundedExec(re, sample, 500, 100);
    return { matches };
  }, [text, flags, sample]);

  const highlighted = useMemo(() => {
    if (matches.length === 0) return sample;
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

  return (
    <div className="space-y-2 p-3">
      <div className="text-[11px] text-lorica-textDim">
        Source regex: <code className="text-lorica-accent">{extractRegex(text) || '(none found)'}</code>
      </div>
      <div className="flex gap-2 text-[10px]">
        {['g', 'i', 'm', 's', 'u'].map((f) => (
          <button
            key={f}
            onClick={() => setFlags((cur) => cur.includes(f) ? cur.replace(f, '') : cur + f)}
            className={`px-2 py-0.5 rounded border ${flags.includes(f) ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim'}`}
          >
            {f}
          </button>
        ))}
      </div>
      <textarea
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        className="w-full h-24 bg-lorica-bg border border-lorica-border rounded p-2 text-[11px] font-mono text-lorica-text outline-none focus:border-lorica-accent/60"
      />
      {error && <div className="text-[11px] text-red-400">Regex error: {error}</div>}
      {!error && (
        <>
          <div className="text-[10px] text-lorica-textDim">{matches.length} match{matches.length === 1 ? '' : 'es'}</div>
          <pre className="bg-lorica-bg border border-lorica-border rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
            {typeof highlighted === 'string' ? highlighted : highlighted.map((s, i) =>
              s.k === 'm' ? <mark key={i} className="bg-lorica-accent/30 text-lorica-accent rounded px-0.5">{s.t}</mark> : <span key={i}>{s.t}</span>
            )}
          </pre>
        </>
      )}
    </div>
  );
}
function extractRegex(text) {
  if (!text) return null;
  // Match a JS-style regex literal: /.../flags — tolerant of simple cases.
  const m = text.match(/\/((?:\\\/|[^/\n])+)\/([gimsuy]*)/);
  if (m) return m[1];
  // Fallback: treat each non-empty trimmed line as a regex — first valid wins.
  for (const l of text.split('\n')) {
    try { new RegExp(l); if (l.trim()) return l; } catch {}
  }
  return null;
}

// ── URL inspector ────────────────────────────────────────────────────────
function UrlInspector({ text }) {
  const url = useMemo(() => {
    const m = text.match(/https?:\/\/[^\s"'`]+/);
    return m ? m[0] : text.trim();
  }, [text]);
  let parsed; try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed) return <div className="p-3 text-[11px] text-lorica-textDim">Not a valid URL</div>;
  const params = Array.from(parsed.searchParams.entries());
  return (
    <div className="p-3 space-y-2 text-[11px] font-mono">
      <Row k="protocol" v={parsed.protocol} />
      <Row k="host"     v={parsed.host} />
      <Row k="pathname" v={parsed.pathname} />
      {params.length > 0 && (
        <div>
          <div className="text-lorica-textDim uppercase tracking-widest text-[9px] mt-2 mb-1">Query params</div>
          {params.map(([k, v], i) => <Row key={i} k={k} v={decodeURIComponent(v)} />)}
        </div>
      )}
      {parsed.hash && <Row k="hash" v={parsed.hash} />}
    </div>
  );
}
function Row({ k, v }) {
  return (
    <div className="flex gap-2">
      <span className="text-amber-300 shrink-0">{k}</span>
      <span className="text-lorica-text break-all">{v}</span>
    </div>
  );
}

// ── SQL sketch ───────────────────────────────────────────────────────────
function SqlSketch({ text }) {
  const info = useMemo(() => extractSql(text), [text]);
  return (
    <div className="p-3 space-y-3 text-[11px] font-mono">
      {info.tables.length > 0 && (
        <div>
          <div className="text-lorica-textDim uppercase tracking-widest text-[9px] mb-1">Tables</div>
          <div className="flex flex-wrap gap-1">
            {info.tables.map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded border border-sky-400/30 bg-sky-400/10 text-sky-400">{t}</span>
            ))}
          </div>
        </div>
      )}
      {info.joins.length > 0 && (
        <div>
          <div className="text-lorica-textDim uppercase tracking-widest text-[9px] mb-1">Joins</div>
          {info.joins.map((j, i) => (
            <div key={i} className="text-lorica-text">
              <span className="text-amber-300">{j.left}</span> ⋈ <span className="text-amber-300">{j.right}</span>{j.on ? <> <span className="text-lorica-textDim">on</span> {j.on}</> : null}
            </div>
          ))}
        </div>
      )}
      {info.columns.length > 0 && (
        <div>
          <div className="text-lorica-textDim uppercase tracking-widest text-[9px] mb-1">Columns</div>
          <div className="flex flex-wrap gap-1">
            {info.columns.slice(0, 30).map((c) => (
              <span key={c} className="px-1.5 py-0.5 rounded border border-lorica-border text-lorica-text">{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function extractSql(text) {
  const t = text.toLowerCase();
  const tables = new Set();
  const columns = new Set();
  const joins = [];
  for (const m of text.matchAll(/\bfrom\s+([a-zA-Z_][\w.]*)/gi)) tables.add(m[1]);
  for (const m of text.matchAll(/\bjoin\s+([a-zA-Z_][\w.]*)(?:\s+(?:as\s+)?([a-zA-Z_]\w*))?\s+(?:on\s+([^\n;]+))?/gi)) {
    tables.add(m[1]);
    joins.push({ left: [...tables].at(-2) || '?', right: m[1], on: (m[3] || '').trim() });
  }
  for (const m of text.matchAll(/\bselect\s+(.+?)\s+from\b/gis)) {
    for (const raw of m[1].split(',')) {
      const c = raw.trim().replace(/\s+as\s+\w+/i, '').split(/\s+/)[0];
      if (c && c !== '*') columns.add(c);
    }
  }
  return { tables: [...tables], joins, columns: [...columns] };
}

// ── XML — tiny tolerant parser into nested nodes ─────────────────────
// We roll a simple parser to avoid pulling in a full XML lib. Handles
// tags, attributes, self-closing, comments, CDATA, text nodes. Not
// schema-aware; good enough for a human-readable tree.
function parseXml(text) {
  if (!text) return null;
  const clean = text.replace(/<\?xml[^?]*\?>/g, '')
                    .replace(/<!--[\s\S]*?-->/g, '')
                    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const root = { tag: '#root', attrs: {}, children: [] };
  let pos = 0;
  const stack = [root];
  const re = /<\/?([a-zA-Z_][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  try {
    while ((m = re.exec(clean)) !== null) {
      if (m[0].startsWith('</')) {
        if (stack.length > 1) stack.pop();
      } else if (m[1]) {
        const tag = m[1];
        const attrStr = m[2] || '';
        const self = !!m[3];
        const attrs = {};
        const attrRe = /([a-zA-Z_][\w:-]*)\s*=\s*"([^"]*)"/g;
        let a;
        while ((a = attrRe.exec(attrStr)) !== null) attrs[a[1]] = a[2];
        const node = { tag, attrs, children: [] };
        stack[stack.length - 1].children.push(node);
        if (!self) stack.push(node);
      } else if (m[4] && m[4].trim()) {
        stack[stack.length - 1].children.push({ tag: '#text', value: m[4].trim() });
      }
      pos = m.index + m[0].length;
    }
  } catch { return null; }
  return root.children.length === 0 ? null : root;
}

function XmlNode({ node, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  if (node.tag === '#text') {
    return <div style={{ paddingLeft: depth * 12 }} className="text-[11px] font-mono text-lorica-text">{node.value}</div>;
  }
  const hasChildren = (node.children || []).length > 0;
  const hasOnlyText = hasChildren && node.children.every((c) => c.tag === '#text');
  return (
    <div style={{ paddingLeft: depth * 12 }} className="text-[11px] font-mono">
      <button
        onClick={() => hasChildren && setOpen(!open)}
        className="text-lorica-textDim hover:text-lorica-accent select-none"
        disabled={!hasChildren}
      >
        {hasChildren ? (open ? '▾' : '▸') : '•'} <span className="text-sky-400">&lt;{node.tag}</span>
        {Object.entries(node.attrs || {}).map(([k, v]) => (
          <span key={k}> <span className="text-amber-300">{k}</span>=<span className="text-emerald-400">"{v}"</span></span>
        ))}
        <span className="text-sky-400">&gt;</span>
        {hasOnlyText && open && <span className="ml-2 text-lorica-text">{node.children[0].value}</span>}
      </button>
      {open && hasChildren && !hasOnlyText && node.children.map((c, i) => (
        <XmlNode key={i} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── TOML — minimal parser for flat + [section] + nested [a.b] ────────
function parseToml(text) {
  const root = {};
  let cur = root;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      cur = root;
      for (const p of section[1].split('.').map((s) => s.trim())) {
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*=\s*(.+)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
    else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    else if (val.startsWith('[') && val.endsWith(']')) {
      try { val = JSON.parse(val); } catch {}
    }
    cur[kv[1]] = val;
  }
  return Object.keys(root).length === 0 ? null : root;
}

// ── HTML iframe sandbox ─────────────────────────────────────────────
// For .html files we render the markup in a sandboxed iframe so scripts
// run in isolation (no access to the Lorica app). Great for checking
// that a snippet looks right without spinning up a server. We use a
// data: URL so the content stays self-contained.
function HtmlIframe({ text }) {
  // sandbox attributes: allow-scripts for interactivity, block the rest.
  // Refreshes every time the content changes.
  const dataUrl = useMemo(() => `data:text/html;charset=utf-8,${encodeURIComponent(text || '')}`, [text]);
  return (
    <iframe
      title="html-preview"
      src={dataUrl}
      // NO allow-same-origin — keeps the frame isolated from Lorica's origin
      // so scripts in the snippet can't read cookies / localStorage / vault state.
      sandbox="allow-scripts allow-forms allow-pointer-lock"
      referrerPolicy="no-referrer"
      className="w-full h-full border-0 bg-white"
    />
  );
}

// ── Markdown TOC extractor ─────────────────────────────────────────
function buildMarkdownToc(text) {
  if (!text) return [];
  const toc = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) toc.push({ depth: m[1].length, title: m[2].trim() });
  }
  return toc;
}
function MarkdownToc({ text }) {
  const toc = useMemo(() => buildMarkdownToc(text), [text]);
  if (toc.length === 0) return <div className="p-3 text-[11px] text-lorica-textDim">No headings in this document.</div>;
  return (
    <div className="p-3 space-y-0.5">
      {toc.map((h, i) => (
        <div key={i} style={{ paddingLeft: (h.depth - 1) * 12 }} className="text-[11px] text-lorica-text">
          <span className="text-lorica-textDim mr-1">{'#'.repeat(h.depth)}</span>{h.title}
        </div>
      ))}
    </div>
  );
}

// ── Router: pick the visualizer(s) to render for the active file ────────
function pickVisualizers(file) {
  if (!file) return [];
  const ext = (file.extension || '').toLowerCase();
  const out = [];
  const content = file.content || '';

  if (ext === 'json' || /^\s*[\[{]/.test(content)) {
    try {
      const data = JSON.parse(content);
      out.push({ id: 'json', label: 'JSON Tree', icon: FileJson, render: () => <div className="p-3"><JsonNode value={data} /></div> });
    } catch {}
  }

  if (ext === 'yaml' || ext === 'yml') {
    const data = tryParseYaml(content);
    if (data) out.push({ id: 'yaml', label: 'YAML Tree', icon: Sheet, render: () => <div className="p-3"><JsonNode value={data} /></div> });
  }

  if (ext === 'csv' || ext === 'tsv') {
    const sep = ext === 'tsv' ? '\t' : ',';
    const rows = parseCsv(content, sep);
    if (rows.length > 0) {
      out.push({
        id: 'csv', label: `${ext.toUpperCase()} Table`, icon: TableProperties,
        render: () => (
          <div className="p-2 overflow-auto max-h-full">
            <table className="text-[11px] font-mono w-full">
              <thead className="sticky top-0 bg-lorica-panel">
                <tr>
                  {(rows[0] || []).map((c, i) => (
                    <th key={i} className="px-2 py-1 text-left text-amber-300 border-b border-lorica-border">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((r, i) => (
                  <tr key={i} className="hover:bg-lorica-accent/5">
                    {r.map((c, j) => <td key={j} className="px-2 py-1 text-lorica-text border-b border-lorica-border/30">{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      });
    }
  }

  // Regex tester — heuristic: the file contains something regex-like OR has
  // .re/.regex extension. Cheap, doesn't cause false positives because we
  // need to successfully extract a regex from extractRegex().
  if (extractRegex(content)) {
    out.push({ id: 'regex', label: 'Regex Tester', icon: Regex, render: () => <RegexTester text={content} /> });
  }

  // URL — if the first non-empty line looks like a URL.
  if (/^\s*https?:\/\//.test(content)) {
    out.push({ id: 'url', label: 'URL Inspector', icon: LinkIcon, render: () => <UrlInspector text={content} /> });
  }

  // SQL sketch — .sql extension or SQL keywords at top.
  if (ext === 'sql' || /\bselect\b.*\bfrom\b/i.test(content)) {
    out.push({ id: 'sql', label: 'SQL Sketch', icon: Database, render: () => <SqlSketch text={content} /> });
  }

  // XML tree — .xml or content looks like XML (starts with <?xml or <tag>).
  if (ext === 'xml' || ext === 'svg' || /^\s*<\?xml/.test(content) || /^\s*<[a-zA-Z]/.test(content.trim().slice(0, 500))) {
    const parsed = parseXml(content);
    if (parsed) {
      out.push({
        id: 'xml', label: 'XML Tree', icon: FileCode,
        render: () => <div className="p-3"><XmlNode node={parsed} /></div>,
      });
    }
  }

  // TOML — .toml extension.
  if (ext === 'toml') {
    const data = parseToml(content);
    if (data) {
      out.push({
        id: 'toml', label: 'TOML Tree', icon: Sheet,
        render: () => <div className="p-3"><JsonNode value={data} /></div>,
      });
    }
  }

  // HTML iframe preview.
  if (ext === 'html' || ext === 'htm') {
    out.push({
      id: 'html', label: 'Live Preview', icon: Globe,
      render: () => <HtmlIframe text={content} />,
    });
  }

  // Markdown — TOC extractor.
  if (ext === 'md' || ext === 'markdown') {
    out.push({
      id: 'toc', label: 'Table of Contents', icon: FileText,
      render: () => <MarkdownToc text={content} />,
    });
  }

  return out;
}

export default function InstantPreview({ file, onClose }) {
  // Re-pick visualizers when file path / content changes. Individual
  // visualizers memoize internally on their own inputs, so the outer
  // recompute is cheap.
  const visualizers = useMemo(() => pickVisualizers(file), [file?.path, file?.content]);
  const [activeId, setActiveId] = useState(null);
  const active = visualizers.find((v) => v.id === activeId) || visualizers[0];

  if (!file || visualizers.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[11px] text-lorica-textDim p-4 text-center">
        <FileJson size={22} className="opacity-40 mb-2" />
        No live preview available for this file.
        <div className="text-[10px] opacity-60 mt-1">
          Open a JSON / YAML / CSV / SQL / URL / regex file and the side rail will light up automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-lorica-surface">
      {/* Tabs for each applicable visualizer */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-lorica-border bg-lorica-panel/60 shrink-0">
        {visualizers.map((v) => {
          const Icon = v.icon;
          const isActive = active?.id === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setActiveId(v.id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${
                isActive
                  ? 'bg-lorica-accent/15 text-lorica-accent'
                  : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40'
              }`}
            >
              <Icon size={11} /> {v.label}
            </button>
          );
        })}
        <div className="flex-1" />
        {onClose && (
          <button onClick={onClose} className="p-1 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {active?.render()}
      </div>
    </div>
  );
}
