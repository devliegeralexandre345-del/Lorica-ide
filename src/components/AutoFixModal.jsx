// src/components/AutoFixModal.jsx
//
// Presents the recent terminal error context to the user, asks the agent
// for a concrete fix, and — on approval — applies the file changes and
// re-runs the last terminal command. Everything happens in one modal so
// the user sees: error → proposed explanation → proposed patch → result.
//
// Safety: we NEVER write files silently. The model's proposed fix is
// shown as a diff (before/after) per file, and the "Apply & rerun"
// button is only enabled once the user has reviewed at least one patch.
// The re-run uses cmd_run_command (same path as the agent's run_command
// tool) so it respects the project cwd.

import React, { useEffect, useRef, useState } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  Wand2, X, Loader2, Play, Check, AlertTriangle, RefreshCw, Terminal as TermIcon,
  History, CheckCircle2, XCircle,
} from 'lucide-react';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT  = 'https://api.deepseek.com/v1/chat/completions';
// Escalation ladder — we start with the fast model; if it can't propose a
// confident fix (low confidence or parse fails), we escalate to the
// strong model. Opus is only used for the retry-after-failure path.
const MODEL_LADDER = {
  anthropic: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
  deepseek:  ['deepseek-chat', 'deepseek-reasoner', 'deepseek-reasoner'],
};
const MAX_RETRIES = 3;
const HISTORY_KEY = 'lorica.autofix.history.v1';

const SYSTEM_PROMPT = [
  'You diagnose a terminal error and propose a minimal fix.',
  'You are given: the recent terminal output, the last command the user ran, and optional file excerpts.',
  'Output STRICT JSON, no prose, no markdown fences:',
  '{',
  '  "diagnosis": "<1-3 sentences plain-English>",',
  '  "confidence": "high"|"medium"|"low",',
  '  "patches": [',
  '    { "path": "<absolute or project-relative file path>",',
  '      "explanation": "<one sentence why this change>",',
  '      "find": "<exact block to replace, single newline-joined>",',
  '      "replace": "<new block>" }',
  '  ],',
  '  "rerun": true|false,',
  '  "rerunCommand": "<optional override — null to reuse the last command>"',
  '}',
  '',
  'Rules:',
  '  • Prefer find/replace over full-file rewrites — small, targeted patches.',
  '  • If the error clearly comes from a missing install (package not found), use an EMPTY patches list and provide `rerunCommand` that installs it.',
  '  • If you cannot determine the fix confidently, return empty patches with confidence "low" and no rerun.',
  '  • "find" must be an exact substring of the current file (the IDE will verify).',
].join('\n');

async function robustFetch(url, opts, preferNative) {
  const init = { ...opts };
  if (preferNative) {
    try { return await fetch(url, init); } catch { return tauriFetch(url, init); }
  }
  try { return await tauriFetch(url, init); } catch { return fetch(url, init); }
}

function parseFix(text) {
  if (!text) return null;
  let t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try {
    const obj = JSON.parse(t.slice(s, e + 1));
    return {
      diagnosis: obj.diagnosis || '',
      confidence: ['high', 'medium', 'low'].includes(obj.confidence) ? obj.confidence : 'medium',
      patches: Array.isArray(obj.patches) ? obj.patches : [],
      rerun: !!obj.rerun,
      rerunCommand: typeof obj.rerunCommand === 'string' ? obj.rerunCommand : null,
    };
  } catch { return null; }
}

// Extract potential file paths from the terminal output so we can send
// their content to the model. We look for strings ending in a source-
// looking extension and take the top few unique hits.
function extractFilePaths(text) {
  const hits = new Set();
  const re = /[A-Za-z0-9_./\\-]+\.(?:rs|ts|tsx|js|jsx|mjs|py|go|rb|c|cc|cpp|h|hpp|cs|java|kt|swift|sh|bash|json|toml|yaml|yml)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.add(m[0]);
    if (hits.size >= 10) break;
  }
  return Array.from(hits);
}

function resolvePath(maybePath, projectPath) {
  if (!maybePath) return null;
  if (/^[a-zA-Z]:[\\/]/.test(maybePath) || maybePath.startsWith('/')) return maybePath;
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath}${sep}${maybePath.replace(/^\.\//, '')}`;
}

function loadFixHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveFixHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 30))); } catch {}
}

export default function AutoFixModal({ state, dispatch }) {
  const [stage, setStage] = useState('idle'); // idle | analyzing | ready | applying | rerunning | done | error
  const [fix, setFix] = useState(null);
  const [verifiedPatches, setVerifiedPatches] = useState([]); // { patch, currentContent, canApply }
  const [error, setError] = useState('');
  const [rerunResult, setRerunResult] = useState(null); // { exit_code, stdout, stderr }
  const [modelTier, setModelTier] = useState(0); // index into MODEL_LADDER
  const [retryCount, setRetryCount] = useState(0);
  const [history, setHistory] = useState(() => loadFixHistory());
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef(null);

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showAutoFix', value: false });
  };

  const analyze = async (tier = modelTier) => {
    if (!apiKey) {
      setError('Configure an API key first (Settings).');
      setStage('error');
      return;
    }
    setStage('analyzing');
    setError('');
    setFix(null);
    setVerifiedPatches([]);
    setRerunResult(null);
    abortRef.current = new AbortController();
    setModelTier(tier);

    // Pull the relevant files the error mentions so the model can propose
    // exact find/replace patches. Cap at 5 files × 8 KB to keep the
    // prompt bounded.
    const tail = state.terminalTail || '';
    const paths = extractFilePaths(tail).slice(0, 5);
    const fileExcerpts = [];
    for (const p of paths) {
      const abs = resolvePath(p, state.projectPath);
      if (!abs) continue;
      try {
        const r = await window.lorica.fs.readFile(abs);
        if (r?.success) {
          fileExcerpts.push({ path: abs, content: (r.data.content || '').slice(0, 8000) });
        }
      } catch {}
    }

    const userMsg = [
      `Last command: ${state.terminalLastCommand || '(unknown)'}`,
      `Project path: ${state.projectPath || '(none)'}`,
      '',
      '=== Recent terminal output (tail) ===',
      tail.slice(-6000),
      '',
      '=== File excerpts ===',
      fileExcerpts.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n') || '(none)',
      '',
      'Return the JSON-only response now.',
    ].join('\n');

    try {
      const ladder = MODEL_LADDER[provider] || MODEL_LADDER.anthropic;
      const model = ladder[Math.min(tier, ladder.length - 1)];
      let text = '';
      if (provider === 'anthropic') {
        const body = {
          model, max_tokens: 2500, temperature: 0.1,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMsg }],
        };
        const r = await robustFetch(ANTHROPIC_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        }, false);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        text = (data?.content || []).map((b) => b.text || '').join('');
      } else {
        const body = {
          model, max_tokens: 2500, temperature: 0.1,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
        };
        const r = await robustFetch(DEEPSEEK_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        }, true);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        text = data?.choices?.[0]?.message?.content || '';
      }
      const parsed = parseFix(text);
      if (!parsed) throw new Error('Model returned unparseable output');
      setFix(parsed);

      // Verify that each patch's `find` exists in the target file —
      // otherwise the apply would silently no-op. We keep the result so
      // the UI can warn on unverifiable patches.
      const checked = [];
      for (const p of parsed.patches) {
        const abs = resolvePath(p.path, state.projectPath);
        if (!abs) { checked.push({ patch: p, canApply: false, reason: 'no project path' }); continue; }
        try {
          const r = await window.lorica.fs.readFile(abs);
          if (!r?.success) { checked.push({ patch: p, canApply: false, reason: 'read failed' }); continue; }
          const content = r.data.content;
          const hit = content.includes(p.find);
          checked.push({
            patch: { ...p, absPath: abs },
            currentContent: content,
            canApply: hit,
            reason: hit ? null : 'find-text not found',
          });
        } catch (e) {
          checked.push({ patch: p, canApply: false, reason: e.message });
        }
      }
      setVerifiedPatches(checked);
      setStage('ready');
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message || String(e));
        setStage('error');
      }
    }
  };

  // Auto-run analysis when opened.
  useEffect(() => {
    if (state.showAutoFix) analyze();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.showAutoFix]);

  const apply = async () => {
    if (!fix) return;
    setStage('applying');
    let written = 0;
    for (const v of verifiedPatches) {
      if (!v.canApply) continue;
      const abs = v.patch.absPath;
      const next = v.currentContent.replace(v.patch.find, v.patch.replace);
      try {
        const r = await window.lorica.fs.writeFile(abs, next);
        if (r?.success) {
          written++;
          // Refresh the tab if it's open.
          const name = abs.split(/[\\/]/).pop();
          const ext = name.includes('.') ? name.split('.').pop() : '';
          dispatch({
            type: 'OPEN_FILE',
            file: { path: abs, name, extension: ext, content: next, dirty: false },
          });
        }
      } catch {}
    }
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Applied ${written} patch${written === 1 ? '' : 'es'}`, duration: 2000 } });

    if (fix.rerun || fix.rerunCommand) {
      setStage('rerunning');
      const cmd = fix.rerunCommand || state.terminalLastCommand;
      if (!cmd) { setStage('done'); return; }
      try {
        const r = await window.lorica.terminal.runCommand(cmd, state.projectPath);
        const data = r?.success ? r.data : { exit_code: -1, stdout: '', stderr: r?.error || 'rerun failed' };
        setRerunResult(data);
        const succeeded = data.exit_code === 0;

        // Record history entry.
        const entry = {
          id: `${Date.now()}-${Math.random()}`,
          at: Date.now(),
          tier: modelTier,
          succeeded,
          command: cmd,
          diagnosis: fix.diagnosis,
          patches: (verifiedPatches || []).filter((v) => v.canApply).map((v) => v.patch.path),
          exit_code: data.exit_code,
        };
        const nextHistory = [entry, ...history].slice(0, 30);
        setHistory(nextHistory);
        saveFixHistory(nextHistory);

        // On success → optionally write a short note to the Project Brain
        // so the learning persists across sessions. Best-effort; failures
        // here don't affect the fix flow.
        if (succeeded && state.projectPath) {
          try {
            const { saveBrainEntry } = await import('../utils/projectBrain');
            await saveBrainEntry(state.projectPath, {
              title: `Fix: ${truncate(fix.diagnosis, 60)}`,
              type: 'fact',
              tags: ['auto-fix', 'recipe'],
              body: `## Trigger\nCommand: \`${cmd}\`\nError symptom: ${truncate(fix.diagnosis, 200)}\n\n## Fix\n${fix.patches.map((p) => `- \`${p.path}\`: ${p.explanation || '(no explanation)'}`).join('\n')}\n\n## Why it works\n${fix.diagnosis}\n\n_Recorded by Auto-Fix on ${new Date().toISOString()}_`,
            });
          } catch { /* silent */ }
        }

        if (!succeeded && modelTier < (MODEL_LADDER[provider]?.length || 3) - 1 && retryCount < MAX_RETRIES) {
          // Escalate: next tier of the model ladder, retry analyze.
          setRetryCount((n) => n + 1);
          dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: `Still failing. Escalating to stronger model…`, duration: 2500 } });
          await new Promise((r) => setTimeout(r, 400));
          await analyze(modelTier + 1);
          return;
        }
      } catch (e) {
        setRerunResult({ exit_code: -1, stdout: '', stderr: e.message });
      }
      setStage('done');
    } else {
      setStage('done');
    }
  };

  const truncate = (s, n) => {
    const t = (s || '').trim().replace(/\s+/g, ' ');
    return t.length > n ? t.slice(0, n) + '…' : t;
  };

  const sendToAgent = () => {
    const text = `The terminal errored on \`${state.terminalLastCommand || '(last command)'}\`. Here's the tail:\n\n\`\`\`\n${(state.terminalTail || '').slice(-3000)}\n\`\`\`\n\nPlease diagnose and fix. Read any mentioned files before changing them.`;
    dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
    dispatch({ type: 'AGENT_PREFILL_INPUT', text });
    close();
  };

  const canApplyAny = verifiedPatches.some((v) => v.canApply);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div
        className="w-full max-w-4xl max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_50px_rgba(248,113,113,0.15)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Wand2 size={15} className="text-red-300" />
          <div className="text-sm font-semibold text-lorica-text">Auto-Fix</div>
          <div className="text-[10px] text-lorica-textDim">
            Agent reads the terminal tail, proposes a targeted fix, and re-runs the command.
          </div>
          <div className="flex-1" />
          {fix && (
            <span className={`text-[10px] px-2 py-0.5 rounded border ${
              fix.confidence === 'high' ? 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10' :
              fix.confidence === 'medium' ? 'text-amber-400 border-amber-400/40 bg-amber-400/10' :
              'text-lorica-textDim border-lorica-border'
            }`}>
              {fix.confidence} confidence · tier {modelTier + 1}
            </span>
          )}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
              showHistory ? 'bg-lorica-accent/15 text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40'
            }`}
          >
            <History size={11} /> History ({history.length})
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {showHistory && (
          <div className="border-b border-lorica-border max-h-48 overflow-y-auto bg-lorica-bg/40">
            {history.length === 0 && (
              <div className="p-3 text-[11px] text-lorica-textDim text-center">No fixes attempted yet.</div>
            )}
            {history.map((h) => (
              <div key={h.id} className="flex items-start gap-2 px-3 py-1.5 border-b border-lorica-border/30 text-[11px]">
                {h.succeeded
                  ? <CheckCircle2 size={11} className="text-emerald-400 shrink-0 mt-0.5" />
                  : <XCircle size={11} className="text-red-400 shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-lorica-accent truncate">{h.command}</code>
                    <span className="text-[9px] text-lorica-textDim ml-auto shrink-0">
                      tier {h.tier + 1} · {new Date(h.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-lorica-text/80 line-clamp-2">{h.diagnosis}</div>
                  {h.patches?.length > 0 && (
                    <div className="text-[9px] text-lorica-textDim mt-0.5 truncate">Patched: {h.patches.join(', ')}</div>
                  )}
                </div>
              </div>
            ))}
            {history.length > 0 && (
              <button
                onClick={() => { setHistory([]); saveFixHistory([]); }}
                className="w-full px-3 py-1.5 text-[10px] text-lorica-textDim hover:text-red-400"
              >
                Clear history
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Last command + tail preview */}
          <div className="rounded-lg border border-lorica-border bg-lorica-bg/40 p-3">
            <div className="flex items-center gap-2 text-[10px] text-lorica-textDim mb-1">
              <TermIcon size={10} /> Last command
            </div>
            <code className="text-[11px] text-lorica-accent font-mono break-all">
              {state.terminalLastCommand || '(none captured yet — run something in the terminal first)'}
            </code>
            {state.terminalTail && (
              <details className="mt-2">
                <summary className="text-[10px] text-lorica-textDim cursor-pointer hover:text-lorica-text">
                  Show tail ({state.terminalTail.length} chars)
                </summary>
                <pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap break-words bg-lorica-bg/60 p-2 rounded max-h-40 overflow-y-auto text-lorica-text/80">
                  {state.terminalTail.slice(-3000)}
                </pre>
              </details>
            )}
          </div>

          {stage === 'analyzing' && (
            <div className="flex items-center gap-2 p-4 text-[11px] text-lorica-textDim">
              <Loader2 size={14} className="animate-spin text-red-300" />
              Reading error, loading related files, and diagnosing…
            </div>
          )}

          {stage === 'error' && (
            <div className="p-3 text-[11px] text-red-400 border border-red-500/30 bg-red-500/5 rounded">
              {error}
              <button onClick={analyze} className="ml-3 underline">Retry</button>
            </div>
          )}

          {fix && (stage === 'ready' || stage === 'applying' || stage === 'rerunning' || stage === 'done') && (
            <>
              <div className="rounded-lg border border-lorica-border p-3">
                <div className="text-[10px] uppercase tracking-widest text-lorica-textDim mb-1">Diagnosis</div>
                <div className="text-[12px] text-lorica-text leading-relaxed">{fix.diagnosis}</div>
              </div>

              {fix.patches.length === 0 && (
                <div className="text-[11px] text-lorica-textDim italic">
                  No file patches — the fix is in the command itself.
                </div>
              )}

              {verifiedPatches.map((v, i) => (
                <div key={i} className={`rounded-lg border ${v.canApply ? 'border-lorica-border' : 'border-amber-400/40 bg-amber-400/5'} overflow-hidden`}>
                  <div className="px-3 py-2 border-b border-lorica-border/50 flex items-center gap-2">
                    <span className={`text-[10px] font-mono truncate flex-1 ${v.canApply ? 'text-lorica-accent' : 'text-amber-400'}`}>
                      {v.patch.path}
                    </span>
                    {v.canApply
                      ? <Check size={11} className="text-emerald-400" />
                      : <AlertTriangle size={11} className="text-amber-400" />}
                  </div>
                  {v.patch.explanation && (
                    <div className="px-3 py-1.5 text-[11px] text-lorica-text">{v.patch.explanation}</div>
                  )}
                  {!v.canApply && (
                    <div className="px-3 py-1.5 text-[10px] text-amber-400 bg-amber-400/5 border-t border-amber-400/20">
                      Cannot auto-apply: {v.reason}. Use "Send to agent" for manual fix.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-px bg-lorica-border/30">
                    <pre className="bg-red-500/5 p-2 text-[10px] font-mono whitespace-pre-wrap break-words text-red-300 overflow-x-auto max-h-40">
                      {v.patch.find}
                    </pre>
                    <pre className="bg-emerald-500/5 p-2 text-[10px] font-mono whitespace-pre-wrap break-words text-emerald-300 overflow-x-auto max-h-40">
                      {v.patch.replace}
                    </pre>
                  </div>
                </div>
              ))}

              {fix.rerunCommand && (
                <div className="text-[11px] text-lorica-textDim">
                  Will re-run: <code className="text-lorica-accent">{fix.rerunCommand}</code>
                </div>
              )}

              {rerunResult && (
                <div className={`rounded-lg border p-3 ${rerunResult.exit_code === 0 ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-red-400/40 bg-red-400/5'}`}>
                  <div className="text-[10px] uppercase tracking-widest mb-1">
                    Re-run · exit {rerunResult.exit_code}
                  </div>
                  <pre className="text-[10px] font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto text-lorica-text/90">
                    {rerunResult.stdout}{rerunResult.stderr ? '\n' + rerunResult.stderr : ''}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-lorica-border bg-lorica-panel/60">
          <button onClick={sendToAgent} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40 transition-colors">
            <Wand2 size={11} /> Send to agent instead
          </button>
          <div className="flex-1" />
          {stage === 'ready' && (
            <>
              <button onClick={analyze} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40 transition-colors">
                <RefreshCw size={11} /> Re-analyze
              </button>
              <button
                onClick={apply}
                disabled={!canApplyAny && !(fix.rerun || fix.rerunCommand)}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-red-500/20 border border-red-400/40 text-red-300 text-[11px] font-semibold hover:bg-red-500/30 transition-colors disabled:opacity-40"
              >
                <Play size={11} /> Apply {canApplyAny ? `${verifiedPatches.filter((v) => v.canApply).length} patch${verifiedPatches.filter((v) => v.canApply).length === 1 ? '' : 'es'}` : ''}{fix.rerun || fix.rerunCommand ? ' & rerun' : ''}
              </button>
            </>
          )}
          {(stage === 'applying' || stage === 'rerunning') && (
            <div className="text-[11px] text-lorica-textDim flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" />
              {stage === 'applying' ? 'Applying…' : 'Re-running…'}
            </div>
          )}
          {stage === 'done' && (
            <>
              <button onClick={close} className="px-3 py-1 rounded text-[11px] bg-lorica-accent/20 border border-lorica-accent/40 text-lorica-accent font-semibold hover:bg-lorica-accent/30 transition-colors">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
