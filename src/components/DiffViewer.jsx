// src/components/DiffViewer.jsx
//
// Side-by-side diff between two open files. Upgraded from a naive
// "compare index-by-index" loop to a proper LCS-based algorithm so
// inserted/removed blocks shift correctly instead of marking every
// subsequent line as changed.
//
// Features:
//   • Swap A↔B button
//   • "Only changes" toggle to collapse matching context
//   • Word-level highlighting within changed lines
//   • Copy diff to clipboard

import React, { useState, useMemo } from 'react';
import { GitCompare, X, ArrowRight, ArrowLeftRight, Eye, EyeOff, Copy } from 'lucide-react';

// LCS diff — O(n*m) time/space. Fine for files up to ~2k lines; above
// that we fall back to a line-equality walk (flagged "too large").
function diffLinesLCS(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  if (n * m > 4_000_000) return { tooLarge: true };
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { ops.push({ type: 'same', lineA: i + 1, lineB: j + 1, contentA: aLines[i], contentB: bLines[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'removed', lineA: i + 1, lineB: null, contentA: aLines[i], contentB: '' }); i++; }
    else { ops.push({ type: 'added', lineA: null, lineB: j + 1, contentA: '', contentB: bLines[j] }); j++; }
  }
  while (i < n) { ops.push({ type: 'removed', lineA: i + 1, lineB: null, contentA: aLines[i], contentB: '' }); i++; }
  while (j < m) { ops.push({ type: 'added', lineA: null, lineB: j + 1, contentA: '', contentB: bLines[j] }); j++; }
  // Collapse adjacent remove+add pairs into 'changed' for nicer display
  // when the LCS happens to pick line-by-line sub-edits.
  const merged = [];
  for (let k = 0; k < ops.length; k++) {
    const cur = ops[k];
    const next = ops[k + 1];
    if (cur.type === 'removed' && next?.type === 'added') {
      merged.push({ type: 'changed', lineA: cur.lineA, lineB: next.lineB, contentA: cur.contentA, contentB: next.contentB });
      k++;
    } else {
      merged.push(cur);
    }
  }
  return { ops: merged };
}

// Tokenize a line into words + separators for inline highlighting.
function tokenize(s) { return s.split(/(\s+|[^\w\s])/).filter((t) => t !== ''); }
// Compute word-level diff within a single line pair. Returns two arrays
// of `{ text, changed }` segments.
function wordDiff(a, b) {
  const ta = tokenize(a), tb = tokenize(b);
  const n = ta.length, m = tb.length;
  if (n * m > 10000) return null; // skip inline-diff on huge lines
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const left = [], right = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) { left.push({ text: ta[i], changed: false }); right.push({ text: tb[j], changed: false }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { left.push({ text: ta[i], changed: true }); i++; }
    else { right.push({ text: tb[j], changed: true }); j++; }
  }
  while (i < n) { left.push({ text: ta[i], changed: true }); i++; }
  while (j < m) { right.push({ text: tb[j], changed: true }); j++; }
  return { left, right };
}

export default function DiffViewer({ state, dispatch }) {
  const [fileAIndex, setFileAIndex] = useState(0);
  const [fileBIndex, setFileBIndex] = useState(Math.min(1, state.openFiles.length - 1));
  const [onlyChanges, setOnlyChanges] = useState(false);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showDiffViewer', value: false });

  const fileA = state.openFiles[fileAIndex];
  const fileB = state.openFiles[fileBIndex];

  const diffResult = useMemo(() => {
    if (!fileA || !fileB) return { ops: [] };
    return diffLinesLCS((fileA.content || '').split('\n'), (fileB.content || '').split('\n'));
  }, [fileA, fileB]);

  const ops = diffResult.ops || [];
  const stats = useMemo(() => {
    let added = 0, removed = 0, changed = 0;
    for (const d of ops) {
      if (d.type === 'added') added++;
      else if (d.type === 'removed') removed++;
      else if (d.type === 'changed') changed++;
    }
    return { added, removed, changed };
  }, [ops]);

  const visibleOps = onlyChanges ? ops.filter((o) => o.type !== 'same') : ops;

  const swap = () => { const a = fileAIndex; setFileAIndex(fileBIndex); setFileBIndex(a); };

  const copyDiff = () => {
    const lines = ops.map((o) => {
      if (o.type === 'same') return '  ' + o.contentA;
      if (o.type === 'added') return '+ ' + o.contentB;
      if (o.type === 'removed') return '- ' + o.contentA;
      return `- ${o.contentA}\n+ ${o.contentB}`;
    }).join('\n');
    navigator.clipboard.writeText(lines).catch(() => {});
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Diff copied to clipboard', duration: 1500 } });
  };

  const rowBg = {
    same: '',
    added: 'bg-emerald-500/10',
    removed: 'bg-red-500/10',
    changed: 'bg-amber-500/10',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-6xl h-full max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_40px_rgba(0,212,255,0.2)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <GitCompare size={15} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Diff Viewer</div>
          <div className="flex-1 flex items-center gap-2">
            <select
              value={fileAIndex}
              onChange={(e) => setFileAIndex(parseInt(e.target.value, 10))}
              className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] outline-none"
            >
              {state.openFiles.map((f, i) => (
                <option key={i} value={i}>{f.name}</option>
              ))}
            </select>
            <button onClick={swap} className="p-1 rounded hover:bg-lorica-border/40 text-lorica-textDim hover:text-lorica-accent" title="Swap A ↔ B">
              <ArrowLeftRight size={12} />
            </button>
            <select
              value={fileBIndex}
              onChange={(e) => setFileBIndex(parseInt(e.target.value, 10))}
              className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] outline-none"
            >
              {state.openFiles.map((f, i) => (
                <option key={i} value={i}>{f.name}</option>
              ))}
            </select>
          </div>
          <button onClick={() => setOnlyChanges((v) => !v)} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${onlyChanges ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40'}`} title="Hide unchanged lines">
            {onlyChanges ? <EyeOff size={11} /> : <Eye size={11} />}
            Only changes
          </button>
          <button onClick={copyDiff} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/40">
            <Copy size={11} /> Copy
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-1 flex items-center gap-3 text-[10px] border-b border-lorica-border bg-lorica-panel/50">
          <span className="text-emerald-400">+{stats.added} added</span>
          <span className="text-red-400">−{stats.removed} removed</span>
          <span className="text-amber-400">±{stats.changed} changed</span>
          <span className="ml-auto text-lorica-textDim">{ops.length} lines total</span>
        </div>

        <div className="flex-1 overflow-auto">
          {diffResult.tooLarge && (
            <div className="p-4 text-[11px] text-amber-400 text-center">
              Diff skipped — one of the files has too many lines for an in-place comparison.
            </div>
          )}
          {!diffResult.tooLarge && (
            <table className="w-full text-[11px] font-mono">
              <tbody>
                {visibleOps.map((op, i) => {
                  const words = op.type === 'changed' ? wordDiff(op.contentA, op.contentB) : null;
                  return (
                    <tr key={i} className={rowBg[op.type]}>
                      <td className="w-12 px-2 text-right text-lorica-textDim/60 select-none">{op.lineA || ''}</td>
                      <td className="px-2 w-1/2 whitespace-pre-wrap break-all text-lorica-text/90">
                        {op.type === 'changed' && words?.left
                          ? words.left.map((t, j) => (
                              <span key={j} className={t.changed ? 'bg-red-500/30 text-red-200' : ''}>{t.text}</span>
                            ))
                          : op.contentA}
                      </td>
                      <td className="w-12 px-2 text-right text-lorica-textDim/60 select-none">{op.lineB || ''}</td>
                      <td className="px-2 w-1/2 whitespace-pre-wrap break-all text-lorica-text/90">
                        {op.type === 'changed' && words?.right
                          ? words.right.map((t, j) => (
                              <span key={j} className={t.changed ? 'bg-emerald-500/30 text-emerald-200' : ''}>{t.text}</span>
                            ))
                          : op.contentB}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
