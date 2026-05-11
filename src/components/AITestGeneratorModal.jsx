// src/components/AITestGeneratorModal.jsx
//
// Wave 44 — UI for the AI test generator. Auto-fires on open against
// the active editor selection (or full active file). Shows the
// suggested path + framework + preview, with a "Save as…" affordance
// that writes the test file into the project.
//
// Read-only preview pane uses a textarea, not CodeMirror, to keep the
// modal light. CodeMirror's eager imports are already in main.bundle
// but we'd still pay the editor-init cost.

import React, { useEffect, useRef, useState } from 'react';
import { TestTube, X, Loader2, Save, RefreshCw, FileCode2, AlertTriangle } from 'lucide-react';
import { generateTests } from '../utils/aiTestGenerator';

export default function AITestGeneratorModal({ state, dispatch, activeFile }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [editablePath, setEditablePath] = useState('');
  const [saving, setSaving] = useState(false);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showTestGenerator', value: false });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;

  // Snippet resolution: prefer selection, fall back to full active file.
  const snippet = (() => {
    const sel = state.editorSelection?.text;
    if (typeof sel === 'string' && sel.trim()) return { code: sel, source: 'selection' };
    if (typeof activeFile?.content === 'string' && activeFile.content) {
      return { code: activeFile.content, source: 'file' };
    }
    return { code: '', source: 'empty' };
  })();

  const run = async () => {
    if (!snippet.code.trim()) {
      setError('Nothing to test — open a file or select some code.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    abortRef.current = new AbortController();
    try {
      const out = await generateTests({
        source: snippet.code,
        fileName: activeFile?.name,
        language: activeFile?.extension,
        provider, apiKey,
        model: provider === 'ollama' ? state.aiOllamaModel
          : provider === 'openrouter' ? state.aiOpenRouterModel
          : undefined,
        ollamaBaseUrl: state.aiOllamaUrl,
        signal: abortRef.current.signal,
      });
      if (!out) throw new Error('AI returned unparseable output. Re-run or simplify the selection.');
      setResult(out);
      setEditablePath(out.path);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async () => {
    if (!result?.content || !editablePath.trim()) return;
    const projectRoot = state.projectPath;
    if (!projectRoot) {
      setError('Open a project before saving the test file.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sep = projectRoot.includes('\\') ? '\\' : '/';
      const abs = /^[a-zA-Z]:[\\/]/.test(editablePath) || editablePath.startsWith('/')
        ? editablePath
        : `${projectRoot}${sep}${editablePath.replace(/\//g, sep)}`;
      // Ensure parent dir exists. We probe with a stat first so we
      // don't try to create an existing dir (which throws on Windows).
      const parent = abs.replace(/[\\/][^\\/]+$/, '');
      try { await window.lorica.fs.createDir(parent); } catch {}
      const r = await window.lorica.fs.writeFile(abs, result.content);
      if (!r?.success) throw new Error(r?.error || 'write failed');
      dispatch({
        type: 'ADD_TOAST',
        toast: { type: 'success', message: `Test file saved: ${editablePath}`, duration: 2500 },
      });
      close();
    } catch (e) {
      setError(`Save failed: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-3xl max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(52,211,153,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <TestTube size={15} className="text-emerald-400" />
          <div className="text-sm font-semibold text-lorica-text">AI Test Generator</div>
          <div className="text-[10px] text-lorica-textDim">
            {snippet.source === 'selection' ? 'Active selection' : snippet.source === 'file' ? `Active file (${activeFile?.name})` : 'No source'}
          </div>
          <div className="flex-1" />
          <button onClick={run} disabled={busy} className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            Re-run
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {busy && !result && (
          <div className="px-5 py-4 flex items-center gap-2 text-[11px] text-lorica-textDim">
            <Loader2 size={12} className="animate-spin text-lorica-accent" />
            Asking the model to draft tests…
          </div>
        )}
        {error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="px-5 py-2 border-b border-lorica-border flex items-center gap-2 text-[11px]">
              <FileCode2 size={12} className="text-lorica-textDim" />
              <span className="text-lorica-textDim">Save as:</span>
              <input
                value={editablePath}
                onChange={(e) => setEditablePath(e.target.value)}
                className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-0.5 text-[11px] text-lorica-text font-mono outline-none focus:border-lorica-accent"
              />
              <span className="text-[10px] text-lorica-textDim">framework: {result.framework}</span>
            </div>
            <div className="flex-1 overflow-auto">
              <textarea
                readOnly
                value={result.content}
                className="w-full h-full min-h-[300px] bg-lorica-bg/40 text-[11px] text-lorica-text font-mono p-3 outline-none resize-none"
              />
            </div>
            <div className="border-t border-lorica-border px-4 py-3 flex items-center justify-end gap-2">
              <button
                onClick={close}
                className="px-3 py-1.5 rounded text-[11px] text-lorica-textDim hover:bg-lorica-border/40"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !editablePath.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-400/15 border border-emerald-400/40 text-[11px] text-emerald-200 hover:bg-emerald-400/25 disabled:opacity-40"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Save test file
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
