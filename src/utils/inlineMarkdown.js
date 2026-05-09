// src/utils/inlineMarkdown.js
//
// Tiny inline Markdown renderer (Wave 26). Used by annotation replies
// + the popover preview. Deliberately NOT react-markdown — replies
// are short, there can be hundreds of them in a project, and the full
// Markdown pipeline pulls remark + rehype into the chunk graph.
//
// Supports the inline subset that matters for code-review notes:
//   **bold**, *italic*, `code`, ~~strikethrough~~, [text](url),
//   newlines as <br>.
//
// Block elements (lists, headings, fenced code) are intentionally
// out of scope — those belong to MarkdownMessage which uses
// react-markdown. If a reply really needs a block, the user can
// promote it to a regular note.
//
// Output: an array of React nodes. Pure function; no JSX, no React
// import — that lets the caller pass the result through React's
// children machinery directly.

import React from 'react';

// URL whitelist — `javascript:` and `data:` are blocked so a
// malicious peer (in a Live Share session) can't sneak an XSS
// payload into a reply. Anything containing a `:` that isn't on the
// allow-list is rejected outright.
function safeUrl(href) {
  try {
    const trimmed = String(href || '').trim();
    if (!trimmed) return '';
    // Explicit allow for the safe schemes.
    if (/^(https?|mailto):/i.test(trimmed)) return trimmed;
    // Reject anything else that uses a scheme (contains a colon
    // before the first slash). This catches javascript:, data:,
    // file:, vbscript:, etc.
    const firstColon = trimmed.indexOf(':');
    const firstSlash = trimmed.indexOf('/');
    if (firstColon !== -1 && (firstSlash === -1 || firstColon < firstSlash)) {
      return '';
    }
    // Plain relative paths are allowed (the IDE never opens them in
    // an external browser anyway, but `target="_blank"` will resolve
    // them against the current page so `./README.md` is harmless).
    if (/^[a-zA-Z0-9./_-]/.test(trimmed)) return trimmed;
    return '';
  } catch {
    return '';
  }
}

// Order matters: inline-code first so backticks aren't re-tokenised
// as bold/italic markers later. Each entry's pattern returns the
// match text in a capture group named `body`. Replacements are
// rendered as React nodes inserted into the surrounding string.
const PATTERNS = [
  { kind: 'code',   re: /`([^`]+)`/ },
  { kind: 'link',   re: /\[([^\]]+)\]\(([^)]+)\)/ },
  { kind: 'bold',   re: /\*\*([^*]+)\*\*/ },
  { kind: 'italic', re: /(?<!\*)\*([^*]+)\*(?!\*)/ },
  { kind: 'strike', re: /~~([^~]+)~~/ },
];

function renderRun(text, keyPrefix) {
  // Walk the string repeatedly, finding the earliest match across all
  // patterns. Slice off the prefix as plain text, render the match as
  // its node, recurse on the suffix. O(n × patterns) but the input is
  // a single reply (~ a couple of hundred chars at most).
  const out = [];
  let cursor = 0;
  let key = 0;
  while (cursor < text.length) {
    let earliest = null;
    for (const p of PATTERNS) {
      const slice = text.slice(cursor);
      const m = p.re.exec(slice);
      if (!m) continue;
      const at = cursor + m.index;
      if (!earliest || at < earliest.at) {
        earliest = { at, match: m, pattern: p };
      }
    }
    if (!earliest) {
      out.push(text.slice(cursor));
      break;
    }
    if (earliest.at > cursor) {
      out.push(text.slice(cursor, earliest.at));
    }
    const m = earliest.match;
    const k = `${keyPrefix}-${key++}`;
    switch (earliest.pattern.kind) {
      case 'code':
        out.push(React.createElement(
          'code',
          { key: k, className: 'lorica-md-code' },
          m[1],
        ));
        break;
      case 'link': {
        const href = safeUrl(m[2]);
        if (!href) {
          out.push(m[0]);
        } else {
          out.push(React.createElement(
            'a',
            { key: k, href, target: '_blank', rel: 'noopener noreferrer', className: 'lorica-md-link' },
            m[1],
          ));
        }
        break;
      }
      case 'bold':
        out.push(React.createElement('strong', { key: k }, m[1]));
        break;
      case 'italic':
        out.push(React.createElement('em', { key: k }, m[1]));
        break;
      case 'strike':
        out.push(React.createElement('del', { key: k }, m[1]));
        break;
    }
    cursor = earliest.at + m[0].length;
  }
  return out;
}

/**
 * Render a string of inline Markdown into an array of React nodes.
 * Splits on `\n` so newlines in the source become `<br>` separators.
 * Returns an array suitable to drop into JSX directly.
 */
export function renderInlineMarkdown(text) {
  if (!text) return [];
  const lines = String(text).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(React.createElement('br', { key: `br-${i}` }));
    if (line) {
      out.push(...renderRun(line, `r${i}`));
    }
  });
  return out;
}

// Export for tests so we can pin URL-safety behaviour without going
// through the full render path.
export const __testing__ = { safeUrl };
