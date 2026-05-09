// src/utils/annotations.js
//
// Spatial code annotations — Wave 11.4. Per-project sticky notes
// anchored to a (file, line) pair. Persisted as plain JSON under
// `.lorica/annotations.json` so they travel with the repo (commit them
// or .gitignore them — the user picks). Pure functions here; the
// React hook (useAnnotations) sits in src/hooks/.
//
// Shape of one annotation:
//   {
//     id:       string  (uuid-ish)
//     file:     string  (project-relative path, forward slashes)
//     line:     number  (1-indexed, matches editor display)
//     text:     string  (markdown-ish, plain text fine too)
//     color:    string  ('amber' | 'blue' | 'rose' | 'emerald' | 'violet')
//     author:   string  (user-typed; empty by default)
//     pinned:   boolean (renders as a permanent gutter dot when true)
//     createdAt: number  (epoch ms)
//     updatedAt: number  (epoch ms)
//     replies:  Array<Reply>  (Wave 20 — threaded follow-ups)
//   }
//
// Shape of one reply:
//   {
//     id:       string
//     text:     string
//     author:   string
//     createdAt: number
//     updatedAt: number
//   }

const FILE = '.lorica/annotations.json';

// 5 colour variants — each one matches a Tailwind palette already used
// elsewhere in the IDE so the theme adaptation comes for free.
export const ANNOTATION_COLORS = ['amber', 'blue', 'rose', 'emerald', 'violet'];

export function newAnnotationId() {
  // Short opaque id, collision-resistant enough for "a few hundred
  // annotations per repo" — we don't need a real UUID.
  return 'a_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function makeAnnotation({ file, line, text = '', color = 'amber', author = '' }) {
  const now = Date.now();
  return {
    id: newAnnotationId(),
    file: normalizeFilePath(file),
    line: Math.max(1, Math.floor(line || 1)),
    text,
    color: ANNOTATION_COLORS.includes(color) ? color : 'amber',
    author,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    replies: [], // Wave 20 — threaded follow-ups, see makeReply
  };
}

// New reply on an existing annotation. Plain object — the hook handles
// inserting it into the parent's `replies` array.
export function makeReply({ text = '', author = '' } = {}) {
  const now = Date.now();
  return {
    id: 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    text: String(text || ''),
    author: String(author || ''),
    createdAt: now,
    updatedAt: now,
  };
}

// Normalise file paths to forward slashes + project-relative form. If
// `projectPath` is provided AND `file` starts with it, we strip the
// prefix so the JSON is portable across machines (different home
// directory / different OS).
export function normalizeFilePath(file, projectPath) {
  if (!file) return '';
  let p = String(file).replace(/\\/g, '/');
  if (projectPath) {
    const root = String(projectPath).replace(/\\/g, '/').replace(/\/$/, '');
    if (p.startsWith(root + '/')) p = p.slice(root.length + 1);
    else if (p === root) p = '.';
  }
  return p;
}

// Group a flat array of annotations into a map keyed by file path —
// the editor extension reads `byFile[currentPath]` once per render
// instead of filtering on every transaction.
export function groupByFile(annotations) {
  const map = Object.create(null);
  for (const a of annotations || []) {
    if (!a?.file) continue;
    if (!map[a.file]) map[a.file] = [];
    map[a.file].push(a);
  }
  for (const k of Object.keys(map)) {
    map[k].sort((x, y) => x.line - y.line);
  }
  return map;
}

// Read the annotations file from disk via the Lorica bridge. Returns
// `[]` when the file doesn't exist (first use), the project is null,
// or the file is malformed (we never throw on a corrupt store — just
// start fresh).
export async function loadAnnotations(projectPath) {
  if (!projectPath) return [];
  try {
    const path = `${projectPath}/${FILE}`;
    const exists = await window.lorica.fs.exists(path);
    if (!exists?.success || !exists.data) return [];
    const r = await window.lorica.fs.readFile(path);
    if (!r?.success) return [];
    const parsed = JSON.parse(r.data?.content ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isValidAnnotation) : [];
  } catch {
    return [];
  }
}

// Write the annotations file. Best-effort — failures are silent
// (storage is full, project moved, etc.).
export async function saveAnnotations(projectPath, annotations) {
  if (!projectPath) return false;
  try {
    // Make sure the .lorica/ directory exists before writing.
    await window.lorica.fs.createDir(`${projectPath}/.lorica`).catch(() => {});
    const path = `${projectPath}/${FILE}`;
    const json = JSON.stringify(annotations || [], null, 2);
    const r = await window.lorica.fs.writeFile(path, json);
    return !!r?.success;
  } catch {
    return false;
  }
}

function isValidAnnotation(a) {
  return (
    a && typeof a === 'object' &&
    typeof a.id === 'string' &&
    typeof a.file === 'string' &&
    typeof a.line === 'number' &&
    Number.isFinite(a.line) &&
    typeof a.text === 'string'
  );
}

// Migrate legacy entries that don't yet have a `replies` array. Pure
// function — returns a shallow-cloned annotation with `replies: []`
// inserted when missing. Saves the migration cost as a one-time pass
// the next time the annotation is updated, so legacy stores stay
// untouched until the user actually edits them.
export function ensureReplies(a) {
  if (!a || typeof a !== 'object') return a;
  if (Array.isArray(a.replies)) return a;
  return { ...a, replies: [] };
}

// Wave 39 — render the full annotation set as a Markdown report.
// Used by the "Export annotations" command + a panel-side download
// button. Output is a single .md file grouping notes by file and,
// within each file, sorted by line.
//
// Format:
//   # Annotations report — <project name>
//   _Generated 2026-05-09T22:00 by Lorica IDE_
//
//   ## src/foo.js
//   ### Line 42 — `amber` · @author
//   <body text, indent-preserving>
//   - 2026-05-09 09:30 @bob: reply text
//
// Pure function — no clipboard / file write here, the caller does that.
export function exportAnnotationsToMarkdown(annotations, opts = {}) {
  const { projectName = 'project', generatedAt = new Date() } = opts;
  const list = (annotations || []).filter((a) => a && a.file);
  if (list.length === 0) {
    return `# Annotations report — ${projectName}\n\n_No annotations._\n`;
  }
  // Group by file → sort each group by line.
  const byFile = new Map();
  for (const a of list) {
    if (!byFile.has(a.file)) byFile.set(a.file, []);
    byFile.get(a.file).push(a);
  }
  const lines = [
    `# Annotations report — ${projectName}`,
    `_Generated ${generatedAt.toISOString()} by Lorica IDE — ${list.length} note${list.length === 1 ? '' : 's'}._`,
    '',
  ];
  const files = Array.from(byFile.keys()).sort();
  for (const file of files) {
    lines.push(`## ${file}`);
    lines.push('');
    const group = byFile.get(file).slice().sort((a, b) => a.line - b.line);
    for (const a of group) {
      const tag = a.author ? ` · @${a.author}` : '';
      const pinned = a.pinned ? ' · 📌' : '';
      const remote = a._remote ? ' · (live-share)' : '';
      lines.push(`### Line ${a.line} — \`${a.color || 'amber'}\`${tag}${pinned}${remote}`);
      lines.push('');
      // Indent body so any internal Markdown stays inside the heading
      // section but doesn't collide with our list bullets below.
      const body = (a.text || '').trim();
      if (body) {
        lines.push(body);
        lines.push('');
      }
      const replies = Array.isArray(a.replies) ? a.replies : [];
      for (const r of replies) {
        const ts = new Date(r.updatedAt || r.createdAt || Date.now()).toISOString().slice(0, 16).replace('T', ' ');
        const replyTag = r.author ? `@${r.author}` : 'anonymous';
        lines.push(`- _${ts}_ ${replyTag}: ${(r.text || '').trim()}`);
      }
      if (replies.length) lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
