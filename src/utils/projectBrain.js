// src/utils/projectBrain.js
//
// Storage + retrieval helpers for the Project Brain — a per-project
// persistent memory of decisions, facts, glossary, milestones. Lives in
// `.lorica/brain/*.md`, one entry per file, YAML-ish frontmatter + markdown
// body.
//
// Format:
//
//   ---
//   id: <uuid>
//   title: Use Redis for queue backing
//   type: decision | fact | glossary | milestone | note
//   date: 2026-04-10
//   tags: [infra, queues]
//   related: [file:src/queues/worker.ts, pr:123]
//   ---
//
//   # markdown body
//
// We keep the parser tiny and tolerant — frontmatter missing? no tags? the
// entry still loads with sensible defaults. The goal is durability across
// schema evolution: users edit these files in any editor and we mustn't
// lose data because of a strict parser.
//
// These entries commit with the repo, so the whole team shares the same
// memory. `.lorica/brain/` is the natural companion to `.lorica/agents/`.

const TYPE_ORDER = ['decision', 'fact', 'glossary', 'milestone', 'note'];

export const BRAIN_TYPES = [
  { id: 'decision',  label: 'Decision',  emoji: '⚖️', color: 'text-amber-400',   bg: 'bg-amber-400/10 border-amber-400/30' },
  { id: 'fact',      label: 'Fact',      emoji: '📌', color: 'text-sky-400',     bg: 'bg-sky-400/10 border-sky-400/30' },
  { id: 'glossary',  label: 'Glossary',  emoji: '📖', color: 'text-purple-400',  bg: 'bg-purple-400/10 border-purple-400/30' },
  { id: 'milestone', label: 'Milestone', emoji: '🎯', color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30' },
  { id: 'note',      label: 'Note',      emoji: '📝', color: 'text-lorica-textDim', bg: 'bg-lorica-border/20 border-lorica-border' },
];

// Minimal frontmatter parser. We don't pull in js-yaml — our schema is
// tiny (strings, a date, flat arrays) and a focused parser keeps the
// bundle light.
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const raw of m[1].split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    // Flat array parse: "[a, b, c]"
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  return { meta, body: m[2] || '' };
}

function writeFrontmatter(meta) {
  const lines = ['---'];
  for (const k of ['id', 'title', 'type', 'date', 'tags', 'related', 'confidence']) {
    if (meta[k] == null) continue;
    const v = meta[k];
    if (Array.isArray(v)) lines.push(`${k}: [${v.join(', ')}]`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function slugify(s) {
  return String(s || 'entry').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entry';
}

function randId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
}

function brainDir(projectPath) {
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath}${sep}.lorica${sep}brain`;
}

export async function ensureBrainDir(projectPath) {
  const dir = brainDir(projectPath);
  if (!dir) return null;
  try { await window.lorica.fs.createDir(dir); } catch {}
  return dir;
}

/**
 * Load all entries from the brain dir. Returns a flat sorted array with
 * metadata + body already parsed. This is cheap enough that we don't need
 * an index (typical brains have <500 entries) — searching happens in JS
 * with substring + tag match; semantic retrieval is left to the agent via
 * the brain_search tool which re-reads the relevant entries on demand.
 */
export async function loadBrainEntries(projectPath) {
  const dir = brainDir(projectPath);
  if (!dir) return [];
  const r = await window.lorica.fs.readDir(dir);
  if (!r?.success) return [];
  const mdFiles = (Array.isArray(r.data) ? r.data : [])
    .filter((e) => !e.isDirectory && e.name.endsWith('.md'));
  const entries = [];
  for (const f of mdFiles) {
    try {
      const fr = await window.lorica.fs.readFile(f.path);
      if (!fr?.success) continue;
      const { meta, body } = parseFrontmatter(fr.data.content);
      entries.push({
        path: f.path,
        filename: f.name,
        id: meta.id || f.name,
        title: meta.title || f.name.replace(/\.md$/, ''),
        type: TYPE_ORDER.includes(meta.type) ? meta.type : 'note',
        date: meta.date || '',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        related: Array.isArray(meta.related) ? meta.related : [],
        confidence: meta.confidence || '',
        body,
        raw: fr.data.content,
      });
    } catch { /* skip */ }
  }
  // Newest first by date, then title.
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  return entries;
}

/**
 * Create or update an entry on disk. Returns the final entry (with path).
 * If `existingPath` is supplied we update in place; otherwise we pick a
 * path `<brain>/<YYYY-MM-DD>-<slug>.md`.
 */
export async function saveBrainEntry(projectPath, entry, existingPath = null) {
  const dir = await ensureBrainDir(projectPath);
  if (!dir) throw new Error('No project open');
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const id = entry.id || randId();
  const date = entry.date || new Date().toISOString().slice(0, 10);
  const type = TYPE_ORDER.includes(entry.type) ? entry.type : 'note';
  const meta = {
    id, title: entry.title || 'Untitled',
    type, date,
    tags: entry.tags || [],
    related: entry.related || [],
    confidence: entry.confidence || undefined,
  };
  const content = writeFrontmatter(meta) + (entry.body || '') + (entry.body?.endsWith('\n') ? '' : '\n');
  const path = existingPath || `${dir}${sep}${date}-${slugify(entry.title || id)}.md`;
  const r = await window.lorica.fs.writeFile(path, content);
  if (!r?.success) throw new Error(r?.error || 'write failed');
  return { ...entry, id, date, type, path, filename: path.split(/[\\/]/).pop() };
}

export async function deleteBrainEntry(entryPath) {
  const r = await window.lorica.fs.deletePath(entryPath);
  return !!r?.success;
}

/**
 * Lightweight search: substring on title/body/tags. Good enough for
 * <500 entries with instant feedback. Semantic retrieval for the agent
 * is layered on top of this.
 */
export function searchBrain(entries, query) {
  if (!query?.trim()) return entries;
  const q = query.toLowerCase();
  return entries.filter((e) =>
    e.title.toLowerCase().includes(q) ||
    (e.body || '').toLowerCase().includes(q) ||
    (e.tags || []).some((t) => String(t).toLowerCase().includes(q))
  );
}

/**
 * Extract [[wiki-style links]] from a body. Returns unique target strings.
 */
export function extractLinks(body) {
  if (!body) return [];
  const out = new Set();
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

/** Resolve a [[link]] target to an entry (exact title → case-insensitive → filename). */
export function resolveLink(target, entries) {
  const t = target.toLowerCase();
  return entries.find((e) => e.title.toLowerCase() === t)
      || entries.find((e) => (e.filename || '').replace(/\.md$/, '').toLowerCase() === t)
      || null;
}

/** Bidirectional brain link graph. */
export function buildBrainGraph(entries) {
  const graph = new Map(entries.map((e) => [e.path, { entry: e, outgoing: new Set(), incoming: new Set() }]));
  for (const e of entries) {
    for (const l of extractLinks(e.body)) {
      const target = resolveLink(l, entries);
      if (!target) continue;
      graph.get(e.path).outgoing.add(target.path);
      graph.get(target.path).incoming.add(e.path);
    }
  }
  return graph;
}

/**
 * Build a compact context block the agent gets at session start, listing
 * the most relevant brain entries. We hand the agent the titles + first
 * paragraph of each — full bodies are fetched on demand via the
 * brain_search tool. This keeps the initial context cheap.
 */
export function buildBrainPreamble(entries, limit = 10) {
  if (!entries || entries.length === 0) return null;
  const lines = ['## Project brain — durable memory', ''];
  for (const e of entries.slice(0, limit)) {
    const snippet = (e.body || '').split('\n\n')[0].slice(0, 240).trim();
    lines.push(`- **${e.title}** (${e.type}, ${e.date})${e.tags.length ? ` — \`${e.tags.join(', ')}\`` : ''}`);
    if (snippet) lines.push(`  ${snippet}`);
  }
  lines.push('', '_To read the full entry, call `brain_search` with the title or a keyword._');
  return lines.join('\n');
}
