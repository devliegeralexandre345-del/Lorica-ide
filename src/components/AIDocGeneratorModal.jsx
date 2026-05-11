// src/components/AIDocGeneratorModal.jsx
//
// Wave 45 — UI for the AI documentation generator. Reads the active
// file, asks the AI for a Markdown reference page, renders the
// result with MarkdownMessage, and offers to save it next to the
// source as `<fileName>.md`. Save is opt-in — the modal stays as a
// "preview before writing" surface.

import React, { useEffect, useRef, useState } from 'react';
import { FileText, X, Loader2, Save, Copy, RefreshCw, Download } from 'lucide-react';
import { generateDocs } from '../utils/aiDocGenerator';
import MarkdownMessage from './MarkdownMessage';

export default function AIDocGeneratorModal({ state, dispatch, activeFile }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [markdown, setMarkdown] = useState('');
  const [savePath, setSavePath] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showDocGenerator', value: false });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;

  // Default save path: same folder as the source, basename + `.md`.
  useEffect(() => {
    if (!activeFile?.path) return;
    const p = activeFile.path.replace(/\\/g, '/');
    const lastSlash = p.lastIndexOf('/');
    const dir = lastSlash >= 0 ? p.slice(0, lastSlash) : '';
    const base = (activeFile.name || 'file').replace(/\.[^.]+$/, '');
    const next = dir ? `${dir}/${base}.md` : `${base}.md`;
    setSavePath(next);
  }, [activeFile]);

  const run = async () => {
    if (!activeFile?.content) {
      setError('Open a file first.');
      return;
    }
    setBusy(true);
    setError(null);
    setMarkdown('');
    abortRef.current = new AbortController();
    try {
      const md = await generateDocs({
        source: activeFile.content,
        fileName: activeFile.name,
        language: activeFile.extension,
        provider, apiKey,
        model: provider === 'ollama' ? state.aiOllamaModel
          : provider === 'openrouter' ? state.aiOpenRouterModel
          : undefined,
        ollamaBaseUrl: state.aiOllamaUrl,
        signal: abortRef.current.signal,
      });
      setMarkdown(md);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const copy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const downloadFile = () => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = (activeFile?.name || 'docs').replace(/\.[^.]+$/, '');
    a.download = `${base}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const saveToProject = async () => {
    if (!markdown || !savePath.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await window.lorica.fs.writeFile(savePath, markdown);
      if (!r?.success) throw new Error(r?.error || 'write failed');
      dispatch({
        type: 'ADD_TOAST',
        toast: { type: 'success', message: `Docs saved: ${savePath}`, duration: 2500 },
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
      <div className="w-full max-w-3xl max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(167,139,250,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <FileText size={15} className="text-violet-400" />
          <div className="text-sm font-semibold text-lorica-text">AI Doc Generator</div>
          <div className="text-[10px] text-lorica-textDim">{activeFile?.name || 'no file'}</div>
          <div className="flex-1" />
          <button onClick={run} disabled={busy} className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            Re-run
          </button>
          <button onClick={copy} disabled={!markdown} className={`flex items-center gap-1 text-[10px] ${copied ? 'text-emerald-300' : 'text-lorica-textDim hover:text-lorica-accent'} disabled:opacity-40`}>
            <Copy size={11} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={downloadFile} disabled={!markdown} className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40">
            <Download size={11} />
            Download
          </button>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {busy && !markdown ? (
            <div className="flex items-center gap-2 text-[11px] text-lorica-textDim">
              <Loader2 size={12} className="animate-spin text-lorica-accent" />
              Reading {activeFile?.name} and drafting docs…
            </div>
          ) : markdown ? (
            <div className="text-[12px]">
              <MarkdownMessage content={markdown} />
            </div>
          ) : (
            <div className="text-[11px] text-lorica-textDim">No docs yet.</div>
          )}
        </div>

        {markdown && (
          <div className="border-t border-lorica-border px-4 py-3 flex items-center gap-2">
            <input
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              placeholder="path/to/save.md"
              className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] text-lorica-text font-mono outline-none focus:border-lorica-accent"
            />
            <button
              onClick={saveToProject}
              disabled={saving || !savePath.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-violet-400/15 border border-violet-400/40 text-[11px] text-violet-200 hover:bg-violet-400/25 disabled:opacity-40"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Save in project
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
