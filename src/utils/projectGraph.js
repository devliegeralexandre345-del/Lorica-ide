// src/utils/projectGraph.js
//
// Build an import/dependency graph of the project to feed the Code Canvas.
// The graph is computed in the frontend from file contents we already have
// (open files) plus a streaming read of the rest (capped at N files to
// keep startup time bounded on large repos).
//
// Edges are inferred from static regex — good enough for navigation.
// Supported languages:
//   • JS/TS/JSX/TSX — `import ... from '...'` / `require('...')`
//   • Python        — `import x` / `from x import y`
//   • Rust          — `mod x` / `use x::y`
//   • Go            — `import "x"`
//
// For the graph layout we use a cheap force-directed placement done in
// pure JS on demand (no d3 dep). Good enough for <500 nodes.

const IMPORT_PATTERNS = {
  js:  [/\bimport\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
  jsx: [/\bimport\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
  ts:  [/\bimport\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
  tsx: [/\bimport\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g],
  py:  [/^\s*(?:from\s+(\S+)\s+)?import\s+/gm],
  rs:  [/^\s*use\s+([A-Za-z0-9_:]+)/gm, /^\s*mod\s+([A-Za-z0-9_]+)/gm],
  go:  [/^\s*import\s+"([^"]+)"/gm, /import\s*\(\s*((?:"[^"]*"\s*\n?\s*)+)\s*\)/gm],
};

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', '__pycache__', '.next', '.nuxt', '.cache',
  'vendor', '.venv', 'venv', '.tox', 'out',
]);

// Walk the file tree recursively, returning a flat [{path, relPath, ext}] list.
function collectFiles(tree, acc = []) {
  if (!tree) return acc;
  for (const entry of tree) {
    if (entry.isDirectory) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      collectFiles(entry.children, acc);
    } else {
      const name = entry.name || '';
      const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      if (!CODE_EXTENSIONS.has(ext)) continue;
      acc.push({ path: entry.path, name, ext });
    }
  }
  return acc;
}

function extractImports(content, ext) {
  const patterns = IMPORT_PATTERNS[ext];
  if (!patterns || !content) return [];
  const out = new Set();
  for (const re of patterns) {
    // Reset lastIndex for /g regexes reused across calls
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const target = (m[1] || '').trim();
      if (target) out.add(target);
      // Guard against pathological loops on empty matches.
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return Array.from(out);
}

// Resolve a raw import specifier to a file path in the project. This is
// approximate — we don't run a real resolver (tsconfig paths, package
// exports, etc). We just try a few candidates and pick the first one that
// exists in the flat file list. External/unresolved specifiers are kept
// as floating "external" nodes so the user still sees the relationship.
function resolveSpecifier(fromFile, spec, fileIndex, projectPath) {
  if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('../')) {
    // Bare specifier — treat as external package, skip (we don't want
    // a giant node for "react" dominating the canvas).
    return null;
  }
  // Strip file extensions the user may have written.
  let stem = spec.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, '');
  // Resolve relative to the importing file's directory.
  const fromDir = fromFile.path.replace(/[\\/][^\\/]+$/, '');
  const abs = (fromDir + '/' + stem).replace(/\\/g, '/');
  // Normalize ../ segments.
  const parts = [];
  for (const p of abs.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  const resolved = '/' + parts.join('/');

  const candidates = [
    resolved,
    resolved + '.js', resolved + '.jsx', resolved + '.ts', resolved + '.tsx',
    resolved + '/index.js', resolved + '/index.ts', resolved + '/index.jsx', resolved + '/index.tsx',
  ];
  for (const c of candidates) {
    const normalized = c.replace(/\\/g, '/').toLowerCase();
    const hit = fileIndex.get(normalized);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build the graph for a project. Reads files that aren't already open
 * using the lorica bridge.
 *
 * @param {object} tree — project file tree as stored in state.fileTree
 * @param {string} projectPath
 * @param {object[]} openFiles — already-loaded files (content available)
 * @param {object} opts
 * @param {number} opts.maxFiles — cap on how many files to read
 * @param {AbortSignal} opts.signal
 */
export async function buildProjectGraph(tree, projectPath, openFiles, opts = {}) {
  const { maxFiles = 200, signal } = opts;
  const files = collectFiles(tree);
  // Dedupe by path — the file tree shouldn't have duplicates but defensive.
  const seen = new Set();
  const unique = files.filter((f) => {
    const k = (f.path || '').replace(/\\/g, '/').toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // Prioritize smaller paths (likely root-level entry points) over deep ones
  // when we're capped. This gives a more useful graph for big repos.
  unique.sort((a, b) => (a.path.length - b.path.length));
  const scanned = unique.slice(0, maxFiles);

  // Build a case-insensitive absolute-path → entry index for resolution.
  const fileIndex = new Map();
  for (const f of scanned) {
    fileIndex.set(f.path.replace(/\\/g, '/').toLowerCase(), f);
  }
  const openByPath = new Map();
  for (const o of openFiles || []) {
    if (o?.path) openByPath.set(o.path.replace(/\\/g, '/').toLowerCase(), o);
  }

  const nodes = [];
  const edges = [];
  const nodeByPath = new Map();

  // Seed nodes (every scanned file becomes a node regardless of imports).
  for (const f of scanned) {
    const id = f.path;
    nodes.push({
      id,
      label: f.name,
      path: f.path,
      ext: f.ext,
      degree: 0,
    });
    nodeByPath.set(id, nodes[nodes.length - 1]);
  }

  // Scan file contents in small concurrent batches.
  const BATCH = 8;
  for (let i = 0; i < scanned.length; i += BATCH) {
    if (signal?.aborted) break;
    const batch = scanned.slice(i, i + BATCH);
    await Promise.all(batch.map(async (f) => {
      let content = openByPath.get(f.path.replace(/\\/g, '/').toLowerCase())?.content;
      if (content == null) {
        try {
          const r = await window.lorica.fs.readFile(f.path);
          if (r?.success) content = r.data.content;
        } catch (_) { /* ignore */ }
      }
      if (!content) return;
      const imports = extractImports(content, f.ext);
      for (const spec of imports) {
        const hit = resolveSpecifier(f, spec, fileIndex, projectPath);
        if (hit && hit.path !== f.path) {
          edges.push({ from: f.path, to: hit.path });
          const a = nodeByPath.get(f.path);
          const b = nodeByPath.get(hit.path);
          if (a) a.degree++;
          if (b) b.degree++;
        }
      }
    }));
  }

  return { nodes, edges };
}

/**
 * Cheap force-directed layout. Deterministic-ish (seeded from node index
 * so the graph doesn't jitter between opens).
 *
 * Runs for `iterations` steps. For small graphs (<200 nodes) this is
 * ~instant; for bigger ones it takes <100ms and is fine to do sync.
 */
export function layoutGraph(graph, { iterations = 120, width = 1200, height = 800 } = {}) {
  const nodes = graph.nodes.map((n, i) => ({
    ...n,
    x: Math.cos(i * 2.4) * 200 + width / 2,
    y: Math.sin(i * 2.4) * 200 + height / 2,
    vx: 0, vy: 0,
  }));
  const index = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges
    .map((e) => ({ a: index.get(e.from), b: index.get(e.to) }))
    .filter((e) => e.a && e.b);

  // Parameters — tuned by eye for ~100 nodes.
  const REPEL = 2400;
  const SPRING_K = 0.04;
  const SPRING_L = 120;
  const CENTER_K = 0.004;
  const DAMP = 0.85;

  for (let it = 0; it < iterations; it++) {
    // Repulsion — O(n²) but fine up to few hundred nodes.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const f = REPEL / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }
    // Spring force on edges.
    for (const e of edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = SPRING_K * (d - SPRING_L);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      e.a.vx += fx; e.a.vy += fy;
      e.b.vx -= fx; e.b.vy -= fy;
    }
    // Gentle pull toward canvas center so disconnected components don't drift.
    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * CENTER_K;
      n.vy += (height / 2 - n.y) * CENTER_K;
      n.vx *= DAMP; n.vy *= DAMP;
      n.x += n.vx; n.y += n.vy;
    }
  }

  // Clamp to bounds.
  for (const n of nodes) {
    n.x = Math.max(30, Math.min(width - 30, n.x));
    n.y = Math.max(30, Math.min(height - 30, n.y));
  }
  return { nodes, edges };
}
