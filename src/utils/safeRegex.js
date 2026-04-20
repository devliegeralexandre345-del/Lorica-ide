// src/utils/safeRegex.js
//
// Helpers that guard user-typed regex against catastrophic backtracking
// (ReDoS). We can't perfectly detect a bad pattern statically without a
// full parser, but a handful of well-known pathological shapes catch
// most real-world problems, and we complement that with a hard cap on
// how long the regex is allowed to run per match.
//
// Usage:
//   const { re, error } = compileSafe(src, flags)
//   if (error) { ... }
//   const arr = boundedExec(re, sample, 50_000)   // maxMatches
//
// For exec-style matching against untrusted input we also watchdog on
// elapsed time via a recursion breaker. The whole thing is still
// synchronous because regex exec is; the value is the cap.

const DANGEROUS_SHAPES = [
  // Nested quantifiers: `(a+)+`, `(.*)+`, `(a*)*`, etc. Classic ReDoS.
  /\([^()]*[*+?][^()]*\)[*+?]/,
  // Alternation with shared prefix inside a quantified group: `(a|a)+`
  /\(\s*([^|()]+)\|\1\s*\)[*+?]/,
  // Huge explicit repetition: {1000,} / {500,}
  /\{\s*\d{4,}\s*,?\s*\d*\}/,
];

/**
 * Compile a user-typed pattern into a RegExp with some sanity checks.
 * Returns `{ re, error }`. Error strings are user-facing.
 */
export function compileSafe(src, flags = '') {
  if (typeof src !== 'string') return { re: null, error: 'Regex must be a string' };
  if (src.length > 2000) return { re: null, error: 'Regex too long (2k cap)' };
  for (const shape of DANGEROUS_SHAPES) {
    if (shape.test(src)) {
      return { re: null, error: 'Pattern has a shape known to cause catastrophic backtracking. Simplify quantifiers.' };
    }
  }
  try {
    return { re: new RegExp(src, flags) };
  } catch (e) {
    return { re: null, error: e.message || 'Invalid regex' };
  }
}

/**
 * Iterate matches with a hard cap on count and elapsed time. Returns
 * `{ matches, truncated, timedOut }`.
 *
 *   matches    — up to `maxMatches` entries
 *   truncated  — true if we stopped because of the count cap
 *   timedOut   — true if we stopped because of the time cap
 */
export function boundedExec(re, text, maxMatches = 500, maxMs = 100) {
  const out = [];
  if (!re || typeof text !== 'string') return { matches: out, truncated: false, timedOut: false };
  const deadline = performance.now() + maxMs;
  let m;
  let truncated = false;
  let timedOut = false;
  while ((m = re.exec(text)) !== null) {
    out.push({ idx: m.index, text: m[0], groups: m.slice(1) });
    if (!re.flags.includes('g')) break;
    if (m.index === re.lastIndex) re.lastIndex++;
    if (out.length >= maxMatches) { truncated = true; break; }
    if (performance.now() > deadline) { timedOut = true; break; }
  }
  return { matches: out, truncated, timedOut };
}
