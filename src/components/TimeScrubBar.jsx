// src/components/TimeScrubBar.jsx
//
// A thin slider over the active file's snapshot history. Scrub left to
// travel back in time; the editor swaps in the historical content.
// Clicking a specific snapshot "pins" that moment; a "Return to present"
// button restores the live buffer. A second button "Fork from here"
// copies the historical content into a new untitled buffer so you can
// recover an old version without blowing away the current one.
//
// Not shown unless the user opts in (state.showTimeScrub). We don't want
// the bar competing for vertical space in the default layout.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { Clock, ChevronLeft, ChevronRight, X, GitFork, Eye, Sparkles, Loader2 } from 'lucide-react';
import { readSnapshotHistory } from '../hooks/useTimeScrub';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK  = 'https://api.deepseek.com/v1/chat/completions';
const MODELS = { anthropic: 'claude-3-5-haiku-20241022', deepseek: 'deepseek-chat' };

// Minimal LCS-based line-diff — good enough for a side-by-side viewer
// without pulling in a dep. We only diff up to 2k lines per side; beyond
// that we fall back to "too large" with a link to the full rewrite.
function diffLines(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  if (n > 2000 || m > 2000) return { tooLarge: true };
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { ops.push({ k: 'eq', a: aLines[i], i, j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ k: 'del', a: aLines[i], i }); i++; }
    else { ops.push({ k: 'add', b: bLines[j], j }); j++; }
  }
  while (i < n) ops.push({ k: 'del', a: aLines[i], i: i++ });
  while (j < m) ops.push({ k: 'add', b: bLines[j], j: j++ });
  return { ops };
}

// Ask LLM to pick the right snapshot index given a free-text intent.
async function pickSnapshotByIntent({ intent, snapshots, provider, apiKey }) {
  if (!apiKey) return null;
  const samples = snapshots.slice(0, 40).map((s, i) => ({
    idx: i,
    ago: Math.round((Date.now() - s.t) / 60000) + 'm',
    reason: s.reason,
    head: (s.content || '').slice(0, 200).replace(/\s+/g, ' '),
  }));
  const system = 'Pick the snapshot that best matches the user\'s intent to rewind to. Return STRICT JSON: {"idx": <0-indexed snapshot idx or -1 for "stay present">, "why": "<one sentence>"}';
  const msg = `Intent: ${intent}\n\nSnapshots (newest first):\n${samples.map((s) => `[${s.idx}] ${s.ago} ago · reason=${s.reason} · ${s.head}`).join('\n')}`;
  const model = MODELS[provider] || MODELS.anthropic;
  try {
    const r = provider === 'anthropic'
      ? await tauriFetch(ANTHROPIC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model, max_tokens: 300, system, messages: [{ role: 'user', content: msg }] }),
        })
      : await fetch(DEEPSEEK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'system', content: system }, { role: 'user', content: msg }] }),
        });
    if (!r.ok) return null;
    const data = await r.json();
    const text = provider === 'anthropic'
      ? (data?.content || []).map((b) => b.text || '').join('')
      : (data?.choices?.[0]?.message?.content || '');
    const t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    return JSON.parse(t.slice(s, e + 1));
  } catch { return null; }
}

function fmtAgo(t) {
  const d = Date.now() - t;
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
  return new Date(t).toLocaleDateString();
}

export default function TimeScrubBar({ state, dispatch }) {
  const file = state.openFiles[state.activeFileIndex];
  const [history, setHistory] = useState([]);
  const [idx, setIdx] = useState(-1); // -1 = present; 0..N-1 = past
  const [showDiff, setShowDiff] = useState(false);
  const [intent, setIntent] = useState('');
  const [intentBusy, setIntentBusy] = useState(false);
  const [intentAnswer, setIntentAnswer] = useState(null);
  const liveContentRef = useRef(null); // saved live buffer while scrubbing
  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;

  // Reload history when active file changes or when the panel is toggled on.
  useEffect(() => {
    if (!state.showTimeScrub || !file?.path || !state.projectPath) { setHistory([]); setIdx(-1); return; }
    (async () => {
      const h = await readSnapshotHistory(state.projectPath, file.path);
      setHistory(h);
      setIdx(-1);
    })();
  }, [state.showTimeScrub, file?.path, state.projectPath]);

  // When the user slides, swap content in place. Keep live content in
  // the ref so we can restore without another backend call.
  useEffect(() => {
    if (!file || !state.showTimeScrub) return;
    if (idx === -1) {
      if (liveContentRef.current != null && file.content !== liveContentRef.current) {
        dispatch({
          type: 'UPDATE_FILE_CONTENT',
          index: state.activeFileIndex,
          content: liveContentRef.current,
        });
      }
      liveContentRef.current = null;
      return;
    }
    const snap = history[idx];
    if (!snap) return;
    if (liveContentRef.current == null) liveContentRef.current = file.content;
    if (file.content !== snap.content) {
      dispatch({
        type: 'UPDATE_FILE_CONTENT',
        index: state.activeFileIndex,
        content: snap.content,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, history, state.showTimeScrub]);

  // ALL hooks must run before any early return — React's rules of hooks
  // require the same hook order on every render. The previous code had
  // `if (!file) return null` above this `useMemo`, which made the hook
  // count vary between renders and crashed with "Rendered more hooks
  // than during the previous render" (triggered e.g. when creating a
  // new file and the active tab briefly had no `file`).
  const currentSnap = idx >= 0 ? history[idx] : null;
  const liveBaseline = liveContentRef.current ?? file?.content ?? '';
  const diff = useMemo(() => {
    if (!showDiff || !currentSnap) return null;
    const aLines = (currentSnap.content || '').split('\n');
    const bLines = (liveBaseline || '').split('\n');
    return diffLines(aLines, bLines);
  }, [showDiff, currentSnap, liveBaseline]);

  // Safe to early-return now — every hook above has been called.
  if (!state.showTimeScrub) return null;
  if (!file) return null;

  const close = () => {
    setIdx(-1); // restores live buffer via the effect above
    dispatch({ type: 'SET_PANEL', panel: 'showTimeScrub', value: false });
  };
  const atPresent = idx === -1;
  const total = history.length;

  const forkIntoNewTab = () => {
    const snap = history[idx];
    if (!snap) return;
    // Open a new untitled buffer with the historical content. We don't
    // touch the live file — that stays intact.
    const name = `(rewind) ${file.name}`;
    dispatch({
      type: 'OPEN_FILE',
      file: { path: `lorica://rewind/${Date.now()}-${file.name}`, name, extension: file.extension, content: snap.content, dirty: true },
    });
    setIdx(-1); // restore live content
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Forked rewind into a new tab', duration: 2000 } });
  };

  const step = (d) => {
    if (total === 0) return;
    const next = idx + d;
    // `-1` is our sentinel for "live"; clamp scrub range to [-1, total-1].
    if (next < -1) setIdx(-1);
    else if (next >= total) setIdx(total - 1);
    else setIdx(next);
  };

  const askIntent = async () => {
    if (!intent.trim() || !history.length || !apiKey) return;
    setIntentBusy(true);
    setIntentAnswer(null);
    const pick = await pickSnapshotByIntent({ intent, snapshots: history, provider, apiKey });
    setIntentBusy(false);
    if (!pick || typeof pick.idx !== 'number') return;
    setIntentAnswer(pick);
    if (pick.idx >= 0 && pick.idx < history.length) setIdx(pick.idx);
    else setIdx(-1);
  };

  return (
    <div className="border-t border-lorica-border bg-lorica-panel/80 backdrop-blur shrink-0">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
      <Clock size={12} className="text-lorica-accent shrink-0" />
      <span className="text-lorica-textDim shrink-0 text-[10px] uppercase tracking-widest font-semibold">Time scrub</span>
      <button onClick={() => step(-1)} disabled={atPresent && idx === -1} className="p-1 rounded text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/40 transition-colors disabled:opacity-30"><ChevronLeft size={12} /></button>
      <input
        type="range"
        min={-1}
        max={Math.max(-1, total - 1)}
        value={idx}
        onChange={(e) => setIdx(parseInt(e.target.value, 10))}
        className="flex-1 accent-lorica-accent"
      />
      <button onClick={() => step(1)} disabled={idx >= total - 1} className="p-1 rounded text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/40 transition-colors disabled:opacity-30"><ChevronRight size={12} /></button>
      <span className="shrink-0 font-mono text-[10px] text-lorica-textDim min-w-[80px] text-right">
        {atPresent
          ? <span className="text-emerald-400">● now</span>
          : <>{fmtAgo(history[idx]?.t || 0)} ({idx + 1}/{total})</>}
      </span>
      {!atPresent && (
        <button
          onClick={forkIntoNewTab}
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-lorica-accent/40 text-lorica-accent hover:bg-lorica-accent/10 text-[10px]"
          title="Open this snapshot as a new tab so you can compare or recover"
        >
          <GitFork size={10} /> Fork
        </button>
      )}
      {!atPresent && (
        <button
          onClick={() => setIdx(-1)}
          className="text-[10px] text-lorica-textDim hover:text-emerald-400"
        >
          Return to present
        </button>
      )}
      {!atPresent && (
        <button
          onClick={() => setShowDiff((v) => !v)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] ${
            showDiff ? 'bg-lorica-accent/15 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim hover:text-lorica-accent'
          }`}
        >
          <Eye size={10} /> Diff
        </button>
      )}
      <button onClick={close} className="p-1 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
        <X size={11} />
      </button>
      </div>

      {/* Intent-based rewind — type a goal, LLM picks the matching snapshot. */}
      {total > 0 && (
        <div className="px-3 pb-1.5 flex items-center gap-1.5">
          <Sparkles size={10} className="text-lorica-accent shrink-0" />
          <input
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && askIntent()}
            placeholder='Rewind by intent — e.g. "before the refactor", "when tests passed"'
            className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] outline-none focus:border-lorica-accent/50"
          />
          <button onClick={askIntent} disabled={intentBusy || !intent.trim() || !apiKey} className="flex items-center gap-1 text-[10px] text-lorica-accent hover:bg-lorica-accent/10 px-2 py-1 rounded disabled:opacity-30">
            {intentBusy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            Rewind
          </button>
          {intentAnswer && (
            <span className="text-[10px] text-lorica-textDim italic">{intentAnswer.why}</span>
          )}
        </div>
      )}

      {/* Side-by-side diff (historical vs live). */}
      {showDiff && diff && !diff.tooLarge && (
        <div className="max-h-64 overflow-y-auto border-t border-lorica-border bg-lorica-bg/40">
          <div className="grid grid-cols-[auto,1fr] gap-x-2 font-mono text-[10px] p-2">
            {diff.ops.map((op, i) => (
              <React.Fragment key={i}>
                <span className={`text-right pr-1 ${
                  op.k === 'add' ? 'text-emerald-400' : op.k === 'del' ? 'text-red-400' : 'text-lorica-textDim/60'
                }`}>
                  {op.k === 'eq' ? '  ' : op.k === 'add' ? '+' : '−'}
                </span>
                <span className={`whitespace-pre ${
                  op.k === 'add' ? 'text-emerald-300 bg-emerald-500/5' :
                  op.k === 'del' ? 'text-red-300 bg-red-500/5' :
                  'text-lorica-text/80'
                }`}>
                  {op.k === 'add' ? op.b : op.a}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
      {showDiff && diff?.tooLarge && (
        <div className="px-3 py-1.5 text-[10px] text-lorica-textDim border-t border-lorica-border">
          Diff skipped — file has more than 2000 lines per side. Use Fork to compare.
        </div>
      )}
    </div>
  );
}
