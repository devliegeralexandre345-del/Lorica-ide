// src/components/SandboxPanel.jsx
//
// One modal, three modes — all backed by the same Web Worker sandbox:
//
//   • "Run" (In-Sandbox Execution #10) — paste code, or pre-seed with the
//     current selection, optionally let AI generate sample inputs from
//     the function signature, see output + logs + probes.
//
//   • "Replay" (Function Replay #7) — first run captures inputs/outputs
//     as fixtures (per-function). Subsequent runs after code changes
//     highlight "behavior diffs": same input, different output = your
//     refactor changed observable behavior.
//
//   • "Probes" (Live Values #1) — user inserts `// @probe <label>` on
//     any assignment; the sandbox records every value that flows through
//     during a run. Shown as a timeline with min/max/distribution when
//     multiple runs are captured.
//
// Fixtures and probe history are stored in
// `<project>/.lorica/sandbox/fixtures.json` so they survive restarts
// and can optionally be committed.

import React, { useEffect, useRef, useState } from 'react';
import {
  Play, X, FileCode, History, Activity, Sparkles, Loader2, Save,
  AlertTriangle, CheckCircle2, TrendingUp, RotateCcw,
} from 'lucide-react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { runSandbox, runPythonSandbox, instrumentProbes, isPyodideCached } from '../utils/sandbox';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK  = 'https://api.deepseek.com/v1/chat/completions';
const MODELS = { anthropic: 'claude-3-5-haiku-20241022', deepseek: 'deepseek-chat' };

function fixturesPath(projectPath) {
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath}${sep}.lorica${sep}sandbox${sep}fixtures.json`;
}

async function loadFixtures(projectPath) {
  const p = fixturesPath(projectPath);
  if (!p) return {};
  try {
    const r = await window.lorica.fs.readFile(p);
    if (!r?.success) return {};
    return JSON.parse(r.data.content);
  } catch { return {}; }
}

async function saveFixtures(projectPath, data) {
  const p = fixturesPath(projectPath);
  if (!p) return;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  try { await window.lorica.fs.createDir(`${projectPath}${sep}.lorica${sep}sandbox`); } catch {}
  try { await window.lorica.fs.writeFile(p, JSON.stringify(data, null, 2)); } catch {}
}

// Hash function code body to key fixtures. Same signature ≠ same behavior,
// but for replay we want "has the code changed" — so we use the FULL
// code text (not just signature). When code changes, the hash changes
// and the replay compares cached (old) outputs vs new outputs.
function hashCode(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// Derive a stable function name / "id" from the first declaration we see.
function deriveFnId(code) {
  const m = code.match(/function\s+(\w+)/) ||
            code.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function)/) ||
            code.match(/export\s+(?:default\s+)?function\s+(\w+)/);
  return m ? m[1] : null;
}

async function askAIForInputs({ code, provider, apiKey }) {
  if (!apiKey) return null;
  const model = MODELS[provider] || MODELS.anthropic;
  const sys = [
    'You generate sample inputs for a JavaScript function.',
    'Return STRICT JSON: an array of 3 distinct argument arrays that exercise edge cases.',
    'Format: [[arg1_for_case1, arg2_for_case1, ...], [arg1_for_case2, ...], ...]',
    'No prose, no fences.',
  ].join('\n');
  const msg = 'Generate 3 sample input arrays for this function:\n\n```js\n' + code + '\n```';
  try {
    let text;
    if (provider === 'anthropic') {
      const r = await tauriFetch(ANTHROPIC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: 600, system: sys, messages: [{ role: 'user', content: msg }] }),
      });
      const data = await r.json();
      text = (data?.content || []).map((b) => b.text || '').join('');
    } else {
      const r = await fetch(DEEPSEEK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'system', content: sys }, { role: 'user', content: msg }] }),
      });
      const data = await r.json();
      text = data?.choices?.[0]?.message?.content || '';
    }
    text = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const s = text.indexOf('['); const e = text.lastIndexOf(']');
    if (s < 0 || e < 0) return null;
    const parsed = JSON.parse(text.slice(s, e + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export default function SandboxPanel({ state, dispatch }) {
  const [tab, setTab] = useState('run'); // 'run' | 'replay' | 'probes'
  const [language, setLanguage] = useState('js'); // 'js' | 'py'
  const [code, setCode] = useState('');
  const [argsJson, setArgsJson] = useState('[]');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [fixtures, setFixtures] = useState({});       // { fnId: { codeHash, cases: [{input, output, ms}] } }
  const [diffs, setDiffs] = useState(null);           // replay diff result
  const [probeRuns, setProbeRuns] = useState([]);     // [{probes: [...], at}]
  const [pyLoading, setPyLoading] = useState(false);
  const codeRef = useRef(null);

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;
  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showSandbox', value: false });

  // Seed the code area with the active file's selection or full content.
  // Also pick the sandbox language from the file's extension so Python
  // files land in the Python runtime by default.
  useEffect(() => {
    if (!state.showSandbox) return;
    const active = state.openFiles[state.activeFileIndex];
    if (active && !code) {
      if (active.extension === 'py') {
        setLanguage('py');
        setCode(active.content || '');
      } else {
        setLanguage('js');
        const isJs = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(active.extension);
        setCode(isJs ? active.content : '// Paste a JS or Python function here.\n\n' + (active.content || ''));
      }
    }
    (async () => {
      const f = await loadFixtures(state.projectPath);
      setFixtures(f);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.showSandbox]);

  const callCodeFor = (rawCode, argsArray) => {
    // Wrap the user's function so we can invoke it with `args`. We pick
    // the last declared function; otherwise eval the raw code as-is
    // (treating it as a statement / expression).
    const name = deriveFnId(rawCode);
    if (!name) return rawCode;
    return `${rawCode}\nreturn ${name}(...(args || []));`;
  };

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      let args;
      try { args = argsJson.trim() ? JSON.parse(argsJson) : []; }
      catch (e) {
        setResult({ ok: false, error: { name: 'InputError', message: 'Invalid JSON in Inputs: ' + e.message } });
        setRunning(false);
        return;
      }
      let res;
      if (language === 'py') {
        // First run pulls Pyodide down (~6 MB) — show a loader so the
        // user knows something is happening.
        if (!isPyodideCached()) setPyLoading(true);
        res = await runPythonSandbox({ code, args, timeoutMs: 8000 });
        setPyLoading(false);
      } else {
        const instrumented = instrumentProbes(code);
        const full = callCodeFor(instrumented, args);
        res = await runSandbox({ code: full, args, timeoutMs: 3000 });
      }
      setResult(res);

      if (res.probes?.length) {
        setProbeRuns((runs) => [{ at: Date.now(), probes: res.probes, args }, ...runs].slice(0, 20));
      }
    } finally { setRunning(false); setPyLoading(false); }
  };

  const generateInputs = async () => {
    if (!apiKey) return;
    setRunning(true);
    const samples = await askAIForInputs({ code, provider, apiKey });
    setRunning(false);
    if (!samples || samples.length === 0) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'AI input generation failed', duration: 2500 } });
      return;
    }
    setArgsJson(JSON.stringify(samples[0], null, 2));
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: `${samples.length} sample inputs ready — applied #1`, duration: 2500 } });
  };

  // --- Replay ---
  const runReplay = async () => {
    const fnId = deriveFnId(code);
    if (!fnId) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Could not identify a top-level function in this code.', duration: 2500 } });
      return;
    }
    setRunning(true);
    setDiffs(null);
    const bucket = fixtures[fnId];
    const newHash = hashCode(code);
    // If we've never captured anything, offer to do a fresh capture using
    // the current argsJson (or AI-generated ones as a fallback).
    if (!bucket || !bucket.cases || bucket.cases.length === 0) {
      let inputs;
      try { inputs = argsJson.trim() ? JSON.parse(argsJson) : []; } catch { inputs = []; }
      const inputSets = Array.isArray(inputs[0]) ? inputs : [inputs];
      const cases = [];
      for (const inp of inputSets.slice(0, 5)) {
        const instrumented = instrumentProbes(code);
        const full = callCodeFor(instrumented, inp);
        const res = await runSandbox({ code: full, args: inp, timeoutMs: 3000 });
        cases.push({ input: inp, output: res.ok ? res.result : { __error: res.error?.message }, ms: res.ms });
      }
      const next = { ...fixtures, [fnId]: { codeHash: newHash, cases, capturedAt: Date.now() } };
      setFixtures(next);
      await saveFixtures(state.projectPath, next);
      setDiffs({ kind: 'captured', fnId, cases });
      setRunning(false);
      return;
    }
    // Have a baseline; re-run with the SAME inputs and diff.
    const diffs = [];
    for (const c of bucket.cases) {
      const instrumented = instrumentProbes(code);
      const full = callCodeFor(instrumented, c.input);
      const res = await runSandbox({ code: full, args: c.input, timeoutMs: 3000 });
      const newOutput = res.ok ? res.result : { __error: res.error?.message };
      const changed = JSON.stringify(c.output) !== JSON.stringify(newOutput);
      diffs.push({ input: c.input, before: c.output, after: newOutput, changed, msBefore: c.ms, msAfter: res.ms });
    }
    setDiffs({
      kind: 'diff',
      fnId,
      codeChanged: bucket.codeHash !== newHash,
      diffs,
    });
    setRunning(false);
  };

  const rebaseline = async () => {
    const fnId = deriveFnId(code);
    if (!fnId || !diffs) return;
    const newHash = hashCode(code);
    const cases = diffs.diffs.map((d) => ({ input: d.input, output: d.after, ms: d.msAfter }));
    const next = { ...fixtures, [fnId]: { codeHash: newHash, cases, capturedAt: Date.now() } };
    setFixtures(next);
    await saveFixtures(state.projectPath, next);
    setDiffs({ kind: 'captured', fnId, cases });
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'New baseline captured', duration: 2000 } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-5xl h-full max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_50px_rgba(0,212,255,0.2)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <FileCode size={14} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Sandbox</div>
          <div className="text-[10px] text-lorica-textDim">Execute · Replay · Probe · isolated runtime</div>
          <div className="flex items-center gap-0 ml-3 rounded border border-lorica-border overflow-hidden">
            <button
              onClick={() => setLanguage('js')}
              className={`px-2 py-0.5 text-[10px] transition-colors ${language === 'js' ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-text'}`}
            >
              JS
            </button>
            <button
              onClick={() => setLanguage('py')}
              className={`px-2 py-0.5 text-[10px] transition-colors border-l border-lorica-border ${language === 'py' ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-text'}`}
              title={isPyodideCached() ? 'Python via Pyodide' : 'Python via Pyodide (~6 MB, downloads on first run)'}
            >
              Py {!isPyodideCached() && <span className="text-lorica-textDim/60">·dl</span>}
            </button>
          </div>
          {pyLoading && (
            <div className="flex items-center gap-1 text-[10px] text-lorica-accent">
              <Loader2 size={10} className="animate-spin" />
              Downloading Pyodide…
            </div>
          )}
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="flex border-b border-lorica-border shrink-0">
          {[
            { id: 'run',    label: 'Run',    Icon: Play },
            { id: 'replay', label: 'Replay', Icon: History },
            { id: 'probes', label: 'Probes', Icon: Activity },
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

        <div className="flex-1 flex overflow-hidden">
          {/* Code + inputs */}
          <div className="flex-1 flex flex-col border-r border-lorica-border">
            <div className="px-3 py-1.5 border-b border-lorica-border text-[9px] uppercase tracking-widest text-lorica-textDim">Code</div>
            <textarea
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              className="flex-1 bg-lorica-bg border-0 font-mono text-[12px] text-lorica-text outline-none p-3 resize-none"
            />
            <div className="px-3 py-1.5 border-t border-lorica-border text-[9px] uppercase tracking-widest text-lorica-textDim flex items-center gap-2">
              Inputs (JSON array)
              <button
                onClick={generateInputs}
                disabled={!apiKey || running}
                className="ml-auto flex items-center gap-1 text-[10px] text-lorica-accent hover:bg-lorica-accent/10 px-1.5 py-0.5 rounded disabled:opacity-30"
              >
                <Sparkles size={10} /> AI-generate
              </button>
            </div>
            <textarea
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              spellCheck={false}
              className="h-24 bg-lorica-bg border-0 font-mono text-[11px] text-lorica-text outline-none p-3 resize-none"
              placeholder='[arg1, arg2, ...]'
            />
          </div>

          {/* Output pane (changes per tab) */}
          <div className="w-[45%] flex flex-col">
            {tab === 'run' && (
              <>
                <div className="px-3 py-1.5 border-b border-lorica-border text-[9px] uppercase tracking-widest text-lorica-textDim flex items-center gap-2">
                  Result
                  {result && <span className="text-lorica-textDim text-[10px]">· {Math.round(result.ms)}ms</span>}
                </div>
                <RunResult result={result} />
              </>
            )}
            {tab === 'replay' && <ReplayPane diffs={diffs} running={running} onRebaseline={rebaseline} />}
            {tab === 'probes' && <ProbesPane probeRuns={probeRuns} />}
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-2.5 border-t border-lorica-border bg-lorica-panel/60">
          <div className="text-[10px] text-lorica-textDim flex-1">
            {tab === 'run' && 'Click Run to execute in the sandbox.'}
            {tab === 'replay' && 'Replay captures inputs/outputs on first run, then diffs when code changes. Perfect for "did my refactor change observable behavior?"'}
            {tab === 'probes' && 'Annotate code with `// @probe <label>` on an assignment to record that value every run. Multiple runs build a distribution.'}
          </div>
          {tab === 'run' && (
            <button
              onClick={run}
              disabled={running || !code.trim()}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-lorica-accent/20 border border-lorica-accent/50 text-lorica-accent text-[11px] font-semibold hover:bg-lorica-accent/30 disabled:opacity-40"
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Run
            </button>
          )}
          {tab === 'replay' && (
            <button
              onClick={runReplay}
              disabled={running || !code.trim()}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-lorica-accent/20 border border-lorica-accent/50 text-lorica-accent text-[11px] font-semibold hover:bg-lorica-accent/30 disabled:opacity-40"
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : <History size={11} />}
              {diffs?.kind === 'captured' ? 'Re-run + diff' : 'Capture/replay'}
            </button>
          )}
          {tab === 'probes' && (
            <button
              onClick={run}
              disabled={running || !code.trim()}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-lorica-accent/20 border border-lorica-accent/50 text-lorica-accent text-[11px] font-semibold hover:bg-lorica-accent/30 disabled:opacity-40"
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />}
              Run + probe
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RunResult({ result }) {
  if (!result) return <div className="flex-1 p-4 text-[11px] text-lorica-textDim">No result yet.</div>;
  if (!result.ok) {
    return (
      <div className="flex-1 p-3 overflow-y-auto space-y-2">
        <div className="rounded border border-red-400/40 bg-red-400/5 p-3">
          <div className="text-[11px] font-semibold text-red-400 flex items-center gap-1 mb-1">
            <AlertTriangle size={12} /> {result.error?.name || 'Error'}
          </div>
          <div className="text-[11px] text-lorica-text">{result.error?.message}</div>
          {result.error?.stack && (
            <pre className="mt-2 text-[10px] text-lorica-textDim whitespace-pre-wrap">{result.error.stack}</pre>
          )}
        </div>
        {result.logs?.length > 0 && <LogBlock logs={result.logs} />}
      </div>
    );
  }
  return (
    <div className="flex-1 p-3 overflow-y-auto space-y-2">
      <div className="rounded border border-emerald-400/30 bg-emerald-400/5 p-3">
        <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-1">Return value</div>
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-lorica-text">
          {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
        </pre>
      </div>
      {result.probes?.length > 0 && (
        <div className="rounded border border-sky-400/30 bg-sky-400/5 p-3">
          <div className="text-[10px] uppercase tracking-widest text-sky-400 mb-1">Probes ({result.probes.length})</div>
          <div className="space-y-1 text-[11px] font-mono">
            {result.probes.map((p, i) => (
              <div key={i} className="flex gap-2"><span className="text-sky-300">{p.label}</span><span className="text-lorica-text">= {JSON.stringify(p.value)}</span></div>
            ))}
          </div>
        </div>
      )}
      {result.logs?.length > 0 && <LogBlock logs={result.logs} />}
    </div>
  );
}

function LogBlock({ logs }) {
  return (
    <div className="rounded border border-lorica-border p-3">
      <div className="text-[10px] uppercase tracking-widest text-lorica-textDim mb-1">Logs</div>
      <pre className="text-[11px] font-mono text-lorica-text whitespace-pre-wrap">
        {logs.join('\n')}
      </pre>
    </div>
  );
}

function ReplayPane({ diffs, running, onRebaseline }) {
  if (running) return <div className="flex-1 flex items-center justify-center text-[11px] text-lorica-textDim"><Loader2 size={14} className="animate-spin mr-2" /> Running…</div>;
  if (!diffs) return <div className="flex-1 p-3 text-[11px] text-lorica-textDim">
    First run captures. Second run (after code changes) diffs behavior.
    <div className="mt-2 opacity-70">Tip: set your Inputs as <code>[[a,b],[c,d]]</code> to capture multiple fixtures.</div>
  </div>;
  if (diffs.kind === 'captured') {
    return (
      <div className="flex-1 p-3 overflow-y-auto space-y-2">
        <div className="text-[11px] text-emerald-400">
          ✓ Baseline captured for <code>{diffs.fnId}</code>: {diffs.cases.length} case{diffs.cases.length === 1 ? '' : 's'}.
        </div>
        {diffs.cases.map((c, i) => (
          <div key={i} className="rounded border border-lorica-border p-2 text-[10px] font-mono">
            <div className="text-lorica-textDim">input:</div>
            <pre className="whitespace-pre-wrap text-lorica-text">{JSON.stringify(c.input)}</pre>
            <div className="text-lorica-textDim mt-1">output:</div>
            <pre className="whitespace-pre-wrap text-lorica-accent">{JSON.stringify(c.output)}</pre>
          </div>
        ))}
      </div>
    );
  }
  // diff
  const changed = diffs.diffs.filter((d) => d.changed);
  return (
    <div className="flex-1 p-3 overflow-y-auto space-y-2">
      <div className={`text-[11px] font-semibold ${changed.length === 0 ? 'text-emerald-400' : 'text-amber-400'} flex items-center gap-1.5`}>
        {changed.length === 0
          ? <><CheckCircle2 size={12} /> Behavior preserved ({diffs.diffs.length} cases identical)</>
          : <><AlertTriangle size={12} /> {changed.length}/{diffs.diffs.length} cases diverged</>}
      </div>
      {changed.length > 0 && (
        <button onClick={onRebaseline} className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent">
          <Save size={10} /> Accept as new baseline
        </button>
      )}
      {diffs.diffs.map((d, i) => (
        <div key={i} className={`rounded border ${d.changed ? 'border-amber-400/40 bg-amber-400/5' : 'border-lorica-border'} p-2 text-[10px] font-mono`}>
          <div className="text-lorica-textDim">input:</div>
          <pre className="whitespace-pre-wrap text-lorica-text">{JSON.stringify(d.input)}</pre>
          {d.changed ? (
            <>
              <div className="text-red-400 mt-1">before:</div>
              <pre className="whitespace-pre-wrap text-red-300">{JSON.stringify(d.before)}</pre>
              <div className="text-emerald-400 mt-1">after:</div>
              <pre className="whitespace-pre-wrap text-emerald-300">{JSON.stringify(d.after)}</pre>
            </>
          ) : (
            <>
              <div className="text-emerald-400 mt-1">output (unchanged):</div>
              <pre className="whitespace-pre-wrap text-lorica-text">{JSON.stringify(d.after)}</pre>
            </>
          )}
          <div className="text-lorica-textDim/60 mt-1">{Math.round(d.msBefore)}ms → {Math.round(d.msAfter)}ms</div>
        </div>
      ))}
    </div>
  );
}

function ProbesPane({ probeRuns }) {
  if (!probeRuns || probeRuns.length === 0) {
    return (
      <div className="flex-1 p-4 text-[11px] text-lorica-textDim">
        <div>No probes recorded yet.</div>
        <div className="mt-2 opacity-80">Annotate code:</div>
        <pre className="mt-1 p-2 bg-lorica-bg/60 rounded font-mono text-[11px] text-lorica-text">{'let balance = account - fees;  // @probe balance'}</pre>
      </div>
    );
  }
  // Aggregate by label across runs for a mini-distribution.
  const agg = new Map();
  for (const run of probeRuns) {
    for (const p of run.probes) {
      if (!agg.has(p.label)) agg.set(p.label, []);
      agg.get(p.label).push(p.value);
    }
  }
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="text-[10px] text-lorica-textDim">
        {probeRuns.length} run{probeRuns.length === 1 ? '' : 's'} · {agg.size} probe labels
      </div>
      {[...agg.entries()].map(([label, values]) => (
        <div key={label} className="rounded border border-sky-400/30 bg-sky-400/5 p-3">
          <div className="flex items-center gap-2 text-[11px]">
            <TrendingUp size={11} className="text-sky-400" />
            <span className="text-sky-400 font-semibold">{label}</span>
            <span className="text-lorica-textDim text-[10px]">{values.length} samples</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {values.slice(-10).map((v, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono">
                {typeof v === 'object' ? JSON.stringify(v).slice(0, 50) : String(v)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
