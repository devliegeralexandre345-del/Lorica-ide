// src/utils/aiCoauthor.js
//
// AI co-author commit trailer — opt-in append of a `Co-authored-by:`
// trailer to commit messages so GitHub credits the AI on the commit
// page. Mirrors VS Code v1.110 (Feb 2026).
//
// Wire-up:
//   • markAiEdit()           — call from any code path that mutates a
//                              file via AI (inline Ctrl+K, agent write_file,
//                              ApplyCodeModal). Stamps localStorage.
//   • shouldAppendTrailer()  — true when the toggle is on AND a recent
//                              AI edit happened (default 30 minutes).
//   • appendTrailer(msg, …)  — pure string transform; no-op when the
//                              message already contains a Co-authored-by
//                              line that matches.
//   • providerCoauthor(p)    — maps the active AI provider to the right
//                              identity ("Claude", "DeepSeek", etc.).
//
// Toggle state is stored under `lorica.git.aiCoauthorTrailer` (string
// 'true' / 'false'); the in-app Settings panel writes it.

export const TIMESTAMP_KEY = 'lorica.ai.lastEditTimestamp';
export const TOGGLE_KEY    = 'lorica.git.aiCoauthorTrailer';

// Window during which a recent AI edit "counts" toward auto-appending.
// 30 minutes is generous enough to cover "AI made me draft the function,
// I tweaked it for 20 minutes, then committed" and tight enough to avoid
// stamping stale credit on commits that have nothing to do with the AI.
export const RECENCY_MS = 30 * 60 * 1000;

// Stamp "an AI just modified the buffer" so a subsequent commit can opt
// to append a trailer. Always cheap — single localStorage.setItem.
export function markAiEdit() {
  try { localStorage.setItem(TIMESTAMP_KEY, String(Date.now())); } catch {}
}

// Return ms since the last AI edit, or Infinity if never (or unreadable).
export function msSinceLastAiEdit() {
  try {
    const v = localStorage.getItem(TIMESTAMP_KEY);
    if (!v) return Infinity;
    const t = parseInt(v, 10);
    if (!Number.isFinite(t) || t <= 0) return Infinity;
    return Date.now() - t;
  } catch { return Infinity; }
}

export function isCoauthorTrailerEnabled() {
  try { return localStorage.getItem(TOGGLE_KEY) === 'true'; } catch { return false; }
}

export function setCoauthorTrailerEnabled(enabled) {
  try { localStorage.setItem(TOGGLE_KEY, enabled ? 'true' : 'false'); } catch {}
}

// Map the active provider to a sensible co-author identity. Each entry
// uses a `noreply` email matching the upstream's published GitHub bot
// pattern so commits are attributed to the canonical bot account where
// one exists.
export function providerCoauthor(provider) {
  switch ((provider || '').toLowerCase()) {
    case 'deepseek':
      return { name: 'DeepSeek', email: 'noreply@deepseek.com' };
    case 'anthropic':
    default:
      return { name: 'Claude', email: 'noreply@anthropic.com' };
  }
}

// True when the toggle is on AND an AI edit is fresh enough to credit.
export function shouldAppendTrailer({ withinMs = RECENCY_MS } = {}) {
  if (!isCoauthorTrailerEnabled()) return false;
  return msSinceLastAiEdit() <= withinMs;
}

// Build the trailer line without a trailing newline so callers can
// control spacing. Format follows the upstream `Co-authored-by` spec.
export function buildTrailer({ name, email } = {}) {
  const n = String(name || 'Claude').trim() || 'Claude';
  const e = String(email || 'noreply@anthropic.com').trim() || 'noreply@anthropic.com';
  return `Co-authored-by: ${n} <${e}>`;
}

// Append the trailer to `message` *unless* the message already contains
// a Co-authored-by trailer that mentions the same identity (case-
// insensitive). Returns the unchanged message in that case so a user
// who typed their own trailer keeps it.
export function appendTrailer(message, { name, email } = {}) {
  const trailer = buildTrailer({ name, email });
  const msg = String(message || '');
  // Already has a Co-authored-by line that points at this identity?
  // Cheap regex — `Co-authored-by:` is unique enough we don't need to
  // be clever about it.
  const escapedEmail = (email || 'noreply@anthropic.com').toLowerCase();
  const lines = msg.split(/\r?\n/);
  for (const ln of lines) {
    if (/^co-authored-by:/i.test(ln) && ln.toLowerCase().includes(escapedEmail)) {
      return msg; // duplicate would be ugly — leave it alone
    }
  }
  // Conventional trailer placement: blank line, then the trailer, with
  // no trailing newline so commit message stays tight.
  const trimmed = msg.replace(/\s+$/u, '');
  return trimmed + '\n\n' + trailer;
}
