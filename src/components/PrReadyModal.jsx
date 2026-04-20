// src/components/PrReadyModal.jsx
//
// The "ready to push?" pre-flight modal. Pulls the PR context from
// cmd_git_pr_context (we already have this backend) and runs the check
// battery in parallel. Each row has a live status (pending → running →
// pass/warn/fail) plus a "Fix with agent" button that pre-fills the
// Agent Copilot with a concrete instruction.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Loader2, CheckCircle2, AlertTriangle, XCircle, X, Sparkles, Network, Activity, FileText } from 'lucide-react';
import { CHECKS as BUILTIN_CHECKS, runPrReadyChecks, loadCustomChecks, mergeChecks } from '../utils/prReadyChecks';
import { forecastChangeImpact } from '../utils/changeImpact';
import { buildProjectGraph } from '../utils/projectGraph';

const STATUS_META = {
  pending:  { color: 'text-lorica-textDim', bg: 'bg-lorica-border/30 border-lorica-border', Icon: Loader2, pulse: false },
  running:  { color: 'text-lorica-accent', bg: 'bg-lorica-accent/10 border-lorica-accent/40', Icon: Loader2, pulse: true },
  pass:     { color: 'text-emerald-400',   bg: 'bg-emerald-400/10 border-emerald-400/40',   Icon: CheckCircle2, pulse: false },
  warn:     { color: 'text-amber-400',     bg: 'bg-amber-400/10 border-amber-400/40',      Icon: AlertTriangle, pulse: false },
  fail:     { color: 'text-red-400',       bg: 'bg-red-400/10 border-red-400/40',          Icon: XCircle, pulse: false },
};

export default function PrReadyModal({ state, dispatch }) {
  const [prContext, setPrContext] = useState(null);
  const [error, setError] = useState('');
  const [checks, setChecks] = useState(BUILTIN_CHECKS);
  const [results, setResults] = useState(
    () => Object.fromEntries(BUILTIN_CHECKS.map((c) => [c.id, { status: 'pending' }]))
  );

  // Merge built-in + custom checks whenever the project changes.
  useEffect(() => {
    (async () => {
      const custom = await loadCustomChecks(state.projectPath);
      const merged = mergeChecks(BUILTIN_CHECKS, custom);
      setChecks(merged);
      setResults(Object.fromEntries(merged.map((c) => [c.id, { status: 'pending' }])));
    })();
  }, [state.projectPath]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('checks'); // 'checks' | 'impact' | 'arch'
  const [impact, setImpact] = useState(null);     // result of forecastChangeImpact
  const [impactBusy, setImpactBusy] = useState(false);
  const [archDiff, setArchDiff] = useState(null); // {before, after, added, removed, changed}
  const [archBusy, setArchBusy] = useState(false);
  const abortRef = useRef(null);

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showPrReady', value: false });
  };

  const run = async () => {
    if (!state.projectPath) return;
    if (!apiKey) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Configure an API key first', duration: 3500 } });
      return;
    }
    setBusy(true);
    setError('');
    setResults(Object.fromEntries(checks.map((c) => [c.id, { status: 'running' }])));
    abortRef.current = new AbortController();

    // 1. Pull PR context (current branch's commits + diff vs base).
    let ctx;
    try {
      const r = await window.lorica.git.prContext(state.projectPath, null);
      if (!r?.success) throw new Error(r?.error || 'no PR context');
      ctx = r.data;
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
      setResults(Object.fromEntries(checks.map((c) => [c.id, { status: 'pending' }])));
      return;
    }
    setPrContext(ctx);

    // 2. Run all checks concurrently.
    try {
      await runPrReadyChecks({
        prContext: ctx,
        provider, apiKey,
        checks, // pass merged built-in + custom check list
        signal: abortRef.current.signal,
        onUpdate: (id, res) => {
          setResults((prev) => ({ ...prev, [id]: res }));
        },
      });
    } finally {
      setBusy(false);
    }
  };

  // Auto-run on open.
  useEffect(() => {
    if (state.showPrReady) run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.showPrReady]);

  // Change-impact forecast — lazy on first tab visit.
  const runImpact = async () => {
    if (!prContext || !apiKey) return;
    setImpactBusy(true);
    try {
      // Collect a sample of project file paths so the model can pick tests.
      const projectFiles = [];
      const walk = (nodes) => {
        for (const n of nodes || []) {
          if (n.isDirectory) walk(n.children);
          else if (!n.name.startsWith('.')) projectFiles.push(n.path);
          if (projectFiles.length >= 500) return;
        }
      };
      walk(state.fileTree);
      const res = await forecastChangeImpact({
        prContext, projectFiles,
        provider, apiKey,
        signal: abortRef.current?.signal,
      });
      setImpact(res || { tests_at_risk: [], files_at_risk: [], summary: 'No forecast available.' });
    } catch (e) {
      setImpact({ tests_at_risk: [], files_at_risk: [], summary: `Error: ${e.message}` });
    } finally { setImpactBusy(false); }
  };

  // Architectural diff — compute the project graph at HEAD, then at the
  // base branch, diff the edge sets. Both builds hit disk; the base-branch
  // build is approximate: we checkout on-read isn't available here, so we
  // fall back to "graph AFTER this PR vs no PR" using git ls-files of the
  // base. As a first pass we just show HEAD graph + annotate the nodes that
  // correspond to changed files. This surfaces *where the change lands*
  // which is 80% of what the user cares about in a visual review.
  const runArch = async () => {
    if (!prContext || archBusy) return;
    setArchBusy(true);
    try {
      const graph = await buildProjectGraph(state.fileTree, state.projectPath, state.openFiles, { maxFiles: 150 });
      const changed = new Set(
        (prContext.files_changed || []).map((p) => {
          if (!state.projectPath) return p;
          const sep = state.projectPath.includes('\\') ? '\\' : '/';
          return `${state.projectPath}${sep}${p}`.replace(/\\/g, '/').toLowerCase();
        })
      );
      // Annotate nodes: touched if path is in changed set; neighbors get
      // a secondary tier so we can visualize the blast radius.
      const touched = new Set();
      const neighbors = new Set();
      for (const n of graph.nodes) {
        if (changed.has(n.path.replace(/\\/g, '/').toLowerCase())) touched.add(n.id);
      }
      for (const e of graph.edges) {
        if (touched.has(e.from)) neighbors.add(e.to);
        if (touched.has(e.to)) neighbors.add(e.from);
      }
      setArchDiff({
        graph,
        touched, neighbors,
        // Quick metrics the user actually cares about.
        metrics: {
          touchedCount: touched.size,
          neighborsCount: [...neighbors].filter((id) => !touched.has(id)).length,
          edgesInvolved: graph.edges.filter((e) => touched.has(e.from) || touched.has(e.to)).length,
          totalFiles: graph.nodes.length,
        },
      });
    } catch (e) {
      setArchDiff({ error: e.message });
    } finally { setArchBusy(false); }
  };

  useEffect(() => {
    if (tab === 'impact' && prContext && !impact && !impactBusy) runImpact();
    if (tab === 'arch' && prContext && !archDiff && !archBusy) runArch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, prContext]);

  const fixWithAgent = (check) => {
    const r = results[check.id];
    if (!r?.fixPrompt) return;
    const text = `Address the following pre-PR issue on the current branch (${prContext?.current_branch || 'HEAD'}):\n\n**Check**: ${check.label}\n**Issue**: ${r.detail}\n\n**Proposed fix**:\n${r.fixPrompt}\n\nDo the minimum needed to turn this check green. Read relevant files first.`;
    dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
    dispatch({ type: 'AGENT_PREFILL_INPUT', text });
    close();
  };

  // Score: treats pass as 1, warn as 0.5, fail as 0. Running = null.
  const summary = checks.reduce((acc, c) => {
    const s = results[c.id]?.status;
    if (s === 'pass') acc.pass++;
    else if (s === 'warn') acc.warn++;
    else if (s === 'fail') acc.fail++;
    else if (s === 'running') acc.running++;
    return acc;
  }, { pass: 0, warn: 0, fail: 0, running: 0 });

  const ready = !busy && summary.fail === 0 && summary.pass + summary.warn === checks.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div
        className="w-full max-w-3xl max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_50px_rgba(0,212,255,0.2)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <ShieldCheck size={15} className={ready ? 'text-emerald-400' : 'text-lorica-accent'} />
          <div className="text-sm font-semibold text-lorica-text">PR Ready?</div>
          <div className="text-[10px] text-lorica-textDim">
            {prContext
              ? <>Branch <b className="text-lorica-accent">{prContext.current_branch}</b> → <b>{prContext.base_branch}</b> · {prContext.commits?.length || 0} commits · {prContext.files_changed?.length || 0} files</>
              : (busy ? 'Loading diff…' : 'Not yet analyzed')}
          </div>
          <div className="flex-1" />
          <button
            onClick={run}
            disabled={busy}
            className="px-3 py-1 rounded text-[11px] font-semibold bg-lorica-accent/15 border border-lorica-accent/40 text-lorica-accent hover:bg-lorica-accent/25 transition-colors disabled:opacity-40"
          >
            {busy ? 'Running…' : 'Re-run'}
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {error && (
          <div className="px-5 py-3 text-[11px] text-red-400 border-b border-red-500/20 bg-red-500/5">
            Can't get PR context: {error}. Are you on a feature branch (not main/master)?
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-lorica-border shrink-0">
          {[
            { id: 'checks', label: 'Checks',       Icon: ShieldCheck },
            { id: 'impact', label: 'Impact',       Icon: Activity },
            { id: 'arch',   label: 'Architecture', Icon: Network },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[11px] transition-colors ${
                tab === t.id
                  ? 'text-lorica-accent border-b-2 border-lorica-accent bg-lorica-accent/5'
                  : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/30'
              }`}
            >
              <t.Icon size={11} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'checks' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {checks.map((c) => {
            const r = results[c.id] || { status: 'pending' };
            const meta = STATUS_META[r.status] || STATUS_META.pending;
            const Icon = meta.Icon;
            return (
              <div
                key={c.id}
                className={`rounded-lg border ${meta.bg} p-3`}
              >
                <div className="flex items-start gap-2">
                  <Icon size={14} className={`${meta.color} shrink-0 mt-0.5 ${meta.pulse ? 'animate-spin' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[12px] font-semibold ${meta.color}`}>{c.label}</div>
                    {r.detail && (
                      <div className="text-[11px] text-lorica-text/90 mt-0.5">{r.detail}</div>
                    )}
                  </div>
                  {r.fixPrompt && (r.status === 'warn' || r.status === 'fail') && (
                    <button
                      onClick={() => fixWithAgent(c)}
                      className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-lorica-accent/40 text-lorica-accent hover:bg-lorica-accent/10 transition-colors"
                    >
                      <Sparkles size={10} /> Fix with agent
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}

        {tab === 'impact' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {impactBusy && (
              <div className="flex items-center gap-2 p-4 text-[11px] text-lorica-textDim">
                <Loader2 size={14} className="animate-spin text-lorica-accent" />
                Predicting downstream impact of this PR…
              </div>
            )}
            {!impactBusy && !impact && (
              <div className="text-[11px] text-lorica-textDim">Switch to this tab to run the forecast.</div>
            )}
            {impact && (
              <>
                <div className="rounded-lg border border-lorica-accent/30 bg-lorica-accent/5 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-lorica-accent/80 mb-1">Forecast summary</div>
                  <div className="text-[12px] text-lorica-text leading-relaxed">{impact.summary}</div>
                </div>
                <RiskList
                  title="Tests at risk"
                  icon={FileText}
                  items={impact.tests_at_risk}
                  dispatch={dispatch}
                  onClose={close}
                />
                <RiskList
                  title="Files at risk"
                  icon={AlertTriangle}
                  items={impact.files_at_risk}
                  dispatch={dispatch}
                  onClose={close}
                />
                {impact.tests_at_risk.length + impact.files_at_risk.length === 0 && (
                  <div className="p-4 text-center text-[11px] text-emerald-400">
                    Nothing predicted to break. Low blast radius.
                  </div>
                )}
                <div className="text-[10px] text-lorica-textDim italic">
                  Forecast is a reasoning pass — not a test run. Use it to prioritize, not to replace CI.
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'arch' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {archBusy && (
              <div className="flex items-center gap-2 p-4 text-[11px] text-lorica-textDim">
                <Loader2 size={14} className="animate-spin text-lorica-accent" />
                Building architectural diff…
              </div>
            )}
            {archDiff?.error && (
              <div className="p-3 text-[11px] text-red-400">Error: {archDiff.error}</div>
            )}
            {archDiff && !archDiff.error && (
              <>
                <div className="grid grid-cols-4 gap-3 px-5 py-3 border-b border-lorica-border">
                  <Metric label="Files touched"   value={archDiff.metrics.touchedCount} color="text-amber-400" />
                  <Metric label="Neighbors hit"   value={archDiff.metrics.neighborsCount} color="text-sky-400" />
                  <Metric label="Edges involved" value={archDiff.metrics.edgesInvolved} color="text-lorica-accent" />
                  <Metric label="Project total"   value={archDiff.metrics.totalFiles} color="text-lorica-textDim" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <ArchMiniGraph graph={archDiff.graph} touched={archDiff.touched} neighbors={archDiff.neighbors} />
                </div>
                <div className="px-5 py-2 border-t border-lorica-border text-[10px] text-lorica-textDim flex items-center gap-3">
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> touched</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-sky-400" /> neighbor (in blast radius)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-lorica-border" /> unaffected</span>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 px-5 py-2.5 border-t border-lorica-border bg-lorica-panel/60 text-[10px]">
          {summary.pass > 0 && <span className="text-emerald-400">{summary.pass} pass</span>}
          {summary.warn > 0 && <span className="text-amber-400">{summary.warn} warn</span>}
          {summary.fail > 0 && <span className="text-red-400">{summary.fail} fail</span>}
          {summary.running > 0 && <span className="text-lorica-accent">{summary.running} running…</span>}
          <div className="flex-1" />
          <span className={`font-semibold ${ready ? 'text-emerald-400' : summary.fail > 0 ? 'text-red-400' : 'text-lorica-textDim'}`}>
            {ready ? '✓ Ready to push' : summary.fail > 0 ? '✗ Blocked — fix fails first' : busy ? 'Analyzing…' : 'Incomplete'}
          </span>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-lorica-textDim">{label}</div>
    </div>
  );
}

function RiskList({ title, icon: Icon, items, dispatch, onClose }) {
  if (!items || items.length === 0) return null;
  const openFile = (p) => {
    window.lorica.fs.readFile(p).then((r) => {
      if (!r?.success) return;
      const name = p.split(/[\\/]/).pop();
      const ext = name.includes('.') ? name.split('.').pop() : '';
      dispatch({
        type: 'OPEN_FILE',
        file: { path: p, name, extension: ext, content: r.data.content, dirty: false },
      });
      onClose();
    });
  };
  return (
    <div className="rounded-lg border border-lorica-border overflow-hidden">
      <div className="px-3 py-2 border-b border-lorica-border bg-lorica-panel/60 flex items-center gap-2">
        <Icon size={11} className="text-amber-400" />
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">{title}</span>
        <span className="ml-auto text-[10px] text-lorica-textDim">{items.length}</span>
      </div>
      {items.map((r, i) => (
        <div key={i} className="px-3 py-2 border-b border-lorica-border/50 last:border-b-0 flex items-start gap-2">
          <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${
            r.confidence === 'high' ? 'text-red-400 border-red-400/40 bg-red-400/10' :
            r.confidence === 'medium' ? 'text-amber-400 border-amber-400/40 bg-amber-400/10' :
            'text-lorica-textDim border-lorica-border'
          }`}>
            {r.confidence || 'med'}
          </span>
          <div className="flex-1 min-w-0">
            <button onClick={() => openFile(r.path)} className="text-[11px] text-lorica-accent font-mono truncate hover:underline text-left">
              {r.path}
            </button>
            <div className="text-[11px] text-lorica-text/90 mt-0.5">{r.reason}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Compact architectural graph — reuses the project graph but scales down.
// We don't run the expensive force layout here; the graph is already laid
// out by buildProjectGraph + layoutGraph when opened from Code Canvas, but
// this panel calls buildProjectGraph with `iterations=0`-equivalent so we
// render it on a simple circular layout. Cheap + legible.
function ArchMiniGraph({ graph, touched, neighbors }) {
  const width = 800, height = 360;
  const cx = width / 2, cy = height / 2;
  const radius = Math.min(cx, cy) - 30;
  // Deterministic circular placement ordered by importance (touched first).
  const nodes = useMemo(() => {
    const sorted = [...graph.nodes].sort((a, b) => {
      const aTouched = touched.has(a.id), bTouched = touched.has(b.id);
      if (aTouched !== bTouched) return aTouched ? -1 : 1;
      const aNei = neighbors.has(a.id), bNei = neighbors.has(b.id);
      if (aNei !== bNei) return aNei ? -1 : 1;
      return b.degree - a.degree;
    });
    return sorted.map((n, i) => {
      const t = (i / sorted.length) * 2 * Math.PI;
      return { ...n, x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) };
    });
  }, [graph.nodes, touched, neighbors]);
  const index = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
      {graph.edges.map((e, i) => {
        const a = index.get(e.from);
        const b = index.get(e.to);
        if (!a || !b) return null;
        const active = touched.has(e.from) || touched.has(e.to);
        return (
          <line
            key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={active ? '#fbbf24' : 'var(--color-border)'}
            strokeOpacity={active ? 0.6 : 0.12}
            strokeWidth={active ? 1.2 : 0.5}
          />
        );
      })}
      {nodes.map((n) => {
        const isTouched = touched.has(n.id);
        const isNeighbor = !isTouched && neighbors.has(n.id);
        const color = isTouched ? '#fbbf24' : isNeighbor ? '#38bdf8' : 'var(--color-border)';
        const r = isTouched ? 6 : isNeighbor ? 4 : 2.5;
        return (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={r} fill={color} fillOpacity={isTouched ? 0.95 : isNeighbor ? 0.7 : 0.3} />
            {isTouched && (
              <text
                x={n.x} y={n.y - r - 3}
                textAnchor="middle"
                fontSize="8"
                fontFamily="JetBrains Mono, monospace"
                fill="#fbbf24"
              >
                {n.label.slice(0, 18)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
