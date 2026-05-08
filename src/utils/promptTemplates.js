// src/utils/promptTemplates.js
//
// Tiny frontmatter parser + template-variable expander for project-level
// prompt files (`.lorica/prompts/<name>.md`) and the auto-attached
// `.lorica/instructions.md`. Kept dependency-free on purpose — the
// frontmatter schema is "name + description, both optional", which is
// well within what regex can handle without dragging in js-yaml.
//
// Template variables supported in prompt bodies:
//   {{selection}}  → current editor selection (or empty string)
//   {{file}}       → current active file path (or empty string)
//   {{open_files}} → newline-separated list of open file paths
//
// Unknown variables are left as-is so the user can spot typos in their
// prompt files instead of silently swallowing them.

/**
 * Parse a markdown prompt file: extract optional frontmatter + body.
 *
 * Frontmatter format (all keys optional):
 *
 *   ---
 *   name: Explain code
 *   description: Walk me through the highlighted snippet
 *   ---
 *   <body>
 *
 * Returns `{ meta: {name?, description?}, body: string }`. Files
 * without frontmatter just return `{ meta: {}, body: <whole file> }`.
 */
export function parsePromptFile(text) {
  const src = String(text || '');
  // Match an opening "---" on its own line, capture everything up to
  // the next "---" line, and consume the trailing newline. Tolerant of
  // both LF and CRLF line endings (we don't strip CR ourselves —
  // callers can if they need to).
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };

  const meta = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    let val = line.slice(colon + 1).trim();
    // Strip surrounding quotes if present.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === 'name' || key === 'description') {
      meta[key] = val;
    }
  }
  return { meta, body: m[2] || '' };
}

/**
 * Replace `{{selection}}`, `{{file}}`, `{{open_files}}` in `body` with
 * values from `ctx`. Unknown `{{...}}` tokens are left untouched so the
 * user notices a typo in their prompt template instead of silently
 * losing data.
 *
 * `ctx` shape (all fields optional, all default to empty strings):
 *   { selection: string,
 *     file:      string,
 *     openFiles: string[] }
 */
export function expandPrompt(body, ctx = {}) {
  const selection = String(ctx.selection ?? '');
  const file = String(ctx.file ?? '');
  const openFiles = Array.isArray(ctx.openFiles) ? ctx.openFiles : [];
  const openFilesText = openFiles.filter(Boolean).join('\n');

  return String(body || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, name) => {
    switch (name) {
      case 'selection':  return selection;
      case 'file':       return file;
      case 'open_files': return openFilesText;
      default:           return match; // leave unknown vars in place
    }
  });
}

/**
 * Wrap project instructions in the standard "system-prefix" form. We
 * always frame them so the model knows where the directive came from
 * (a project-shared file, not a user message), and so subsequent user
 * messages can be appended without ambiguity.
 *
 * Returns `null` when `instructions` is empty/whitespace — callers
 * should skip prepending in that case rather than emitting a
 * meaningless "Project instructions:\n\n\n---\n\nUser message:" stub.
 */
export function buildInstructionsPrefix(instructions) {
  const text = String(instructions || '').trim();
  if (!text) return null;
  return [
    'Project instructions (from .lorica/instructions.md):',
    '',
    text,
    '',
    '---',
    '',
    'User message:',
    '',
  ].join('\n');
}
