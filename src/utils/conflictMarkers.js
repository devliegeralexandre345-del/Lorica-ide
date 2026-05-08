// src/utils/conflictMarkers.js
//
// Parse git merge conflict markers out of a document. Used by the
// conflictExtension to render inline "Resolve" buttons next to each
// `<<<<<<<` block, and by App.jsx to extract the OURS/THEIRS payload
// when seeding the AI prompt.
//
// We deliberately keep this dependency-free so it can be unit-tested
// without spinning up CodeMirror, and so the extension can call it on
// every doc change without paying any framework cost.
//
// Block layout we recognise:
//
//   <<<<<<< HEAD                ← startLine
//   ours line 1
//   ours line 2
//   ||||||| merged common ancestor   (optional, diff3 style — skipped)
//   ancestor line
//   =======                     ← separator
//   theirs line 1
//   theirs line 2
//   >>>>>>> branch-name         ← endLine
//
// Returned offsets:
//   - start / end: absolute character offsets of the whole block
//     (start at the `<<<<<<<` line beginning, end at the newline
//     after the `>>>>>>>` line — or doc length if the block is the
//     last thing in the file).
//   - oursStart / oursEnd:   character range of just the ours body
//                            (excludes the `<<<<<<<` line and the `=======`).
//   - theirsStart / theirsEnd: same for the theirs body
//                              (excludes `=======` and `>>>>>>>`).
//   - startLine / endLine: 1-indexed line numbers — handy for line
//                          decorations / scroll-into-view.
//
// Nested conflicts are skipped (git itself doesn't emit them in normal
// rebases; the extra complexity isn't worth it). If we see a stray
// `=======` or `>>>>>>>` without a matching `<<<<<<<` we just bail on
// that block and continue scanning — better to render nothing than to
// render a broken widget over real code.

const MARK_OURS = /^<{7}(?:\s|$)/;       // <<<<<<< HEAD
const MARK_BASE = /^\|{7}(?:\s|$)/;       // ||||||| ancestor (diff3, optional)
const MARK_SEP  = /^={7}\s*$/;           // =======
const MARK_THEIRS = /^>{7}(?:\s|$)/;     // >>>>>>> branch

/**
 * Find all merge-conflict blocks in a document string.
 *
 * @param {string} doc - The full editor document.
 * @returns {Array<{
 *   start: number, end: number,
 *   startLine: number, endLine: number,
 *   oursStart: number, oursEnd: number,
 *   theirsStart: number, theirsEnd: number,
 *   oursLabel: string, theirsLabel: string,
 * }>}
 */
export function findConflicts(doc) {
  if (!doc || typeof doc !== 'string') return [];
  // Cheap sniff before paying for the line-by-line walk. Most files in
  // an editor are NOT in a conflicted state — short-circuit on a plain
  // substring miss. The marker is 7 chars; substring scan is O(n) but
  // implemented in C inside the JS engine, much faster than line split.
  if (doc.indexOf('<<<<<<<') < 0) return [];

  const lines = doc.split('\n');
  // Pre-compute line start offsets so we can return absolute char
  // ranges without re-scanning. lineStart[i] = offset of line i (0-idx).
  const lineStart = new Array(lines.length);
  {
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      lineStart[i] = off;
      // +1 for the \n we split on (last line gets a phantom +1 but we
      // never index past the last line so it's harmless).
      off += lines[i].length + 1;
    }
  }
  const docLen = doc.length;

  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!MARK_OURS.test(lines[i])) { i++; continue; }

    const startLineIdx = i;
    // Look for the matching ======= and then >>>>>>>. If we run into
    // another <<<<<<< first, the outer block is malformed (nested) — we
    // skip the outer and let the parser pick up the inner one.
    let sepIdx = -1;
    let endIdx = -1;
    let baseIdx = -1; // optional diff3 ancestor marker
    let nested = false;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (MARK_OURS.test(l)) { nested = true; break; }
      if (MARK_BASE.test(l) && sepIdx < 0 && baseIdx < 0) { baseIdx = j; continue; }
      if (MARK_SEP.test(l) && sepIdx < 0) { sepIdx = j; continue; }
      if (MARK_THEIRS.test(l)) {
        if (sepIdx < 0) break; // >>>>>> without ====== → malformed, give up
        endIdx = j;
        break;
      }
    }

    if (nested) { i++; continue; }
    if (sepIdx < 0 || endIdx < 0) { i++; continue; }

    // Ours body: from line after <<<<<<< up to (but not including)
    // the ======= or the optional ||||||| ancestor.
    const oursEndLine = baseIdx >= 0 ? baseIdx : sepIdx;
    const oursStart = lineStart[startLineIdx + 1] ?? lineStart[startLineIdx];
    const oursEnd   = lineStart[oursEndLine] ?? oursStart;
    const theirsStart = lineStart[sepIdx + 1] ?? lineStart[sepIdx];
    const theirsEnd   = lineStart[endIdx] ?? theirsStart;

    // Block bounds: from start of <<<<<<< line to end of >>>>>>> line
    // (include trailing newline if there is one so a replace cleanly
    // removes the whole block without leaving a blank line).
    const blockStart = lineStart[startLineIdx];
    const lastLineEnd = (lineStart[endIdx + 1] ?? (lineStart[endIdx] + lines[endIdx].length));
    const blockEnd = Math.min(docLen, lastLineEnd);

    // Pull labels off the marker lines (e.g. "HEAD", "feature-branch"). Purely
    // cosmetic — shown in the inline buttons so users know which side is which.
    const oursLabel   = lines[startLineIdx].replace(/^<{7}\s*/, '').trim() || 'ours';
    const theirsLabel = lines[endIdx].replace(/^>{7}\s*/, '').trim() || 'theirs';

    blocks.push({
      start: blockStart,
      end: blockEnd,
      startLine: startLineIdx + 1, // 1-indexed
      endLine: endIdx + 1,
      oursStart,
      oursEnd,
      theirsStart,
      theirsEnd,
      oursLabel,
      theirsLabel,
    });

    i = endIdx + 1;
  }

  return blocks;
}

/**
 * Resolve a conflict block given the chosen action. Returns the
 * replacement text that should overwrite [block.start, block.end].
 *
 * "both" stacks ours then theirs separated by a single blank line —
 * the most common 'I want to keep both halves' shape. The user can
 * always tweak the result by hand afterwards.
 *
 * @param {string} doc
 * @param {ReturnType<typeof findConflicts>[number]} block
 * @param {'ours'|'theirs'|'both'} action
 * @returns {string}
 */
export function resolveBlock(doc, block, action) {
  const ours = doc.slice(block.oursStart, block.oursEnd);
  const theirs = doc.slice(block.theirsStart, block.theirsEnd);
  if (action === 'ours') return ours;
  if (action === 'theirs') return theirs;
  if (action === 'both') {
    // Avoid double newlines if either side already ends with one.
    const oursTrimmed = ours.endsWith('\n') ? ours : ours + '\n';
    return oursTrimmed + theirs;
  }
  // Unknown action — no-op (return the original block so we don't
  // accidentally clobber the user's file).
  return doc.slice(block.start, block.end);
}
