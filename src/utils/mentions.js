// src/utils/mentions.js
//
// @mention parsing + expansion for the Agent Copilot input.
//
// Supported tokens:
//   @file:<abs-path>     — injects file content into the prompt
//   @folder:<abs-path>   — injects folder tree listing
//   @active              — injects the currently active editor file
//   @diff / @branch-diff — injects `git diff base...HEAD` for current branch
//
// The picker inserts absolute paths directly so the tokens are self-contained
// and survive history edits. Paths with whitespace aren't supported in v1 —
// the picker escapes spaces to `\ ` so they round-trip through the regex
// without breaking, and expandMentions() un-escapes them before reading.

// Soft cap for the branch-diff payload. Above this we refuse to attach
// silently and instead surface a hint nudging the user to scope their ask.
// 30 KB is roughly 7-8k tokens — comfortable inside any modern context
// window without crowding out the rest of the conversation.
const BRANCH_DIFF_MAX_BYTES = 30 * 1024;

const TOKEN_RE = /@(file|folder):((?:\\ |[^\s])+)|@(active|branch-diff|diff)\b/g;

/**
 * Parse mention tokens from a string.
 * Returns an array of { type, value, raw, index } in order of appearance.
 */
export function parseMentions(text) {
  if (!text) return [];
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1]) {
      tokens.push({
        type: m[1],
        value: m[2].replace(/\\ /g, ' '),
        raw: m[0],
        index: m.index,
      });
    } else if (m[3]) {
      tokens.push({ type: m[3], value: null, raw: m[0], index: m.index });
    }
  }
  return tokens;
}

/** Escape a path so it can be safely embedded in a mention token. */
export function escapePath(path) {
  return String(path).replace(/ /g, '\\ ');
}

/**
 * Expand parsed mention tokens into a context preamble string.
 * Returns '' if nothing to expand.
 *
 * @param {Array} tokens - output of parseMentions()
 * @param {object} ctx   - { activeFile, projectPath }
 */
export async function expandMentions(tokens, ctx) {
  if (!tokens || tokens.length === 0) return '';
  const { activeFile, projectPath } = ctx || {};
  const seen = new Set();
  const blocks = [];

  for (const t of tokens) {
    // `diff` and `branch-diff` are aliases — collapse them in the dedupe
    // set so a user typing `@diff @branch-diff` doesn't double-attach.
    const dedupeType = (t.type === 'diff' || t.type === 'branch-diff')
      ? 'branch-diff'
      : t.type;
    const key = `${dedupeType}:${t.value || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (t.type === 'active') {
      if (activeFile && typeof activeFile.content === 'string') {
        const label = activeFile.path || activeFile.name || '(active)';
        const ext = activeFile.extension || '';
        blocks.push(`@active → ${label}\n\`\`\`${ext}\n${truncate(activeFile.content)}\n\`\`\``);
      } else {
        blocks.push(`@active — (no active file in the editor)`);
      }
      continue;
    }

    if (t.type === 'branch-diff' || t.type === 'diff') {
      // Pull the full `base...HEAD` diff for the current branch. The
      // backend auto-detects main/master so the user doesn't have to.
      if (!projectPath) {
        blocks.push(`@${t.type} — (no project open)`);
        continue;
      }
      try {
        const r = await window.lorica.git.branchDiff(projectPath, null);
        if (!r || !r.success) {
          blocks.push(`@${t.type} — (git diff failed: ${r?.error || 'unknown'})`);
          continue;
        }
        const diff = r.data || '';
        if (!diff.trim()) {
          blocks.push(`@${t.type} — (no changes vs. base branch — you may be on main)`);
          continue;
        }
        // Cap the diff so we never blow the context window. Bytes, not
        // chars: a 30 KB diff is roughly 7-8k tokens.
        const bytes = new Blob([diff]).size;
        if (bytes > BRANCH_DIFF_MAX_BYTES) {
          blocks.push(
            `@${t.type} — diff too large to attach automatically ` +
            `(${Math.round(bytes / 1024)} KB > ${BRANCH_DIFF_MAX_BYTES / 1024} KB cap). ` +
            `Please use Inline AI Edit on smaller scopes.`
          );
          continue;
        }
        blocks.push(`@${t.type} → branch diff vs. base\n\`\`\`diff\n${diff}\n\`\`\``);
      } catch (e) {
        blocks.push(`@${t.type} — (error: ${e.message})`);
      }
      continue;
    }

    if (t.type === 'file') {
      try {
        const r = await window.lorica.fs.readFile(t.value);
        if (r.success) {
          const ext = inferExt(t.value);
          blocks.push(`@file: ${t.value}\n\`\`\`${ext}\n${truncate(r.data.content)}\n\`\`\``);
        } else {
          blocks.push(`@file: ${t.value} — (failed to read: ${r.error})`);
        }
      } catch (e) {
        blocks.push(`@file: ${t.value} — (error: ${e.message})`);
      }
      continue;
    }

    if (t.type === 'folder') {
      try {
        const r = await window.lorica.fs.readDir(t.value);
        if (r.success) {
          const listing = renderTree(r.data, '', 3);
          blocks.push(`@folder: ${t.value}\n${listing}`);
        } else {
          blocks.push(`@folder: ${t.value} — (failed to read: ${r.error})`);
        }
      } catch (e) {
        blocks.push(`@folder: ${t.value} — (error: ${e.message})`);
      }
      continue;
    }
  }

  if (blocks.length === 0) return '';
  return `[Context from @mentions]\n\n${blocks.join('\n\n')}\n\n---\n\n`;
}

const MAX_FILE_CHARS = 30000;
function truncate(s) {
  if (!s) return '';
  return s.length > MAX_FILE_CHARS
    ? s.slice(0, MAX_FILE_CHARS) + `\n\n… [truncated, ${s.length - MAX_FILE_CHARS} chars omitted]`
    : s;
}

function inferExt(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path || '');
  return m ? m[1].toLowerCase() : '';
}

function renderTree(entries, indent = '', maxDepth = 3) {
  if (!Array.isArray(entries) || maxDepth < 0) return '';
  return entries
    .map((e) => {
      const prefix = e.isDirectory ? '[D]' : '[F]';
      const childStr =
        e.children && e.children.length > 0 && maxDepth > 0
          ? '\n' + renderTree(e.children, indent + '  ', maxDepth - 1)
          : '';
      return `${indent}${prefix} ${e.name}${childStr}`;
    })
    .join('\n');
}

/**
 * Flatten a hierarchical fileTree into a flat list suitable for picker filtering.
 * Each returned entry has { path (absolute), name, relPath, isDirectory }.
 */
export function flattenFileTree(tree, projectPath) {
  const out = [];
  const sep = projectPath?.includes('\\') ? '\\' : '/';
  const walk = (nodes, relBase) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const rel = relBase ? `${relBase}${sep}${node.name}` : node.name;
      out.push({
        path: node.path,
        name: node.name,
        relPath: rel,
        isDirectory: !!node.isDirectory,
      });
      if (node.children && node.children.length > 0) walk(node.children, rel);
    }
  };
  walk(tree, '');
  return out;
}

/**
 * Fuzzy match a query against a list of entries.
 * Returns top `limit` entries sorted by relevance score (lower is better).
 */
export function fuzzyMatch(entries, query, limit = 30) {
  if (!query) {
    // No query — prioritise files over folders, cap at limit
    const files = entries.filter((e) => !e.isDirectory).slice(0, limit);
    const folders = entries.filter((e) => e.isDirectory).slice(0, 5);
    return [...files, ...folders].slice(0, limit);
  }
  const q = query.toLowerCase();
  const scored = [];
  for (const e of entries) {
    const name = e.name.toLowerCase();
    const rel = (e.relPath || '').toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (rel.endsWith(`/${q}`) || rel.endsWith(`\\${q}`)) score = 2;
    else if (name.includes(q)) score = 3;
    else if (rel.includes(q)) score = 4;
    if (score >= 0) scored.push({ e, score });
  }
  scored.sort((a, b) => a.score - b.score || a.e.relPath.length - b.e.relPath.length);
  return scored.slice(0, limit).map((s) => s.e);
}
