// src/components/SemanticTypesPanel.jsx
//
// Manage the semantic-types store: see every brand the AI inferred, how
// many files each appears in, where the mismatches are. Actions:
//   • Re-analyze the active file on demand
//   • Re-analyze everything (batch across all supported files)
//   • Export brands to TypeScript (writes a drop-in .ts file)
//   • Toggle auto-inference on save
//   • Clear the store
//
// The panel is a modal (opens from Dock / Omnibar). It's the "control
// room" for semantic types; the actual warnings show up in the editor.

import React, { useMemo, useState } from 'react';
import {
  Layers, X, Play, Zap, FileCode, Download, Trash2, Loader2,
  AlertTriangle, RefreshCw, Sparkles,
} from 'lucide-react';
import {
  inferSemanticTypes, loadSemanticStore, saveSemanticStore,
  exportBrandsToTypescript, summarizeStore,
} from '../utils/semanticTypes';

const SUPPORTED_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);

function collectFiles(tree, acc = []) {
  for (const n of tree || []) {
    if (n.isDirectory) collectFiles(n.children, acc);
    else {
      const ext = n.name.includes('.') ? n.name.split('.').pop().toLowerCase() : '';
      if (SUPPORTED_EXT.has(ext)) acc.push(n);
    }
  }
  return acc;
}

export default function SemanticTypesPanel({ state, dispatch }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // {done, total, path}
  const [selectedBrand, setSelectedBrand] = useState(null);
  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showSemanticTypes', value: false });
  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;

  const summary = useMemo(() => summarizeStore(state.semanticTypes), [state.semanticTypes]);
  const activeFile = state.openFiles[state.activeFileIndex];

  const analyzeActive = async () => {
    if (!activeFile || !apiKey) return;
    setBusy(true);
    try {
      const r = await inferSemanticTypes({
        filePath: activeFile.path,
        code: activeFile.content,
        provider, apiKey,
      });
      if (r) {
        const store = await loadSemanticStore(state.projectPath);
        store[activeFile.path] = {
          inferredAt: Date.now(),
          brands: r.brands, mismatches: r.mismatches,
        };
        await saveSemanticStore(state.projectPath, store);
        dispatch({ type: 'SET_SEMANTIC_TYPES', store });
        dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Found ${r.brands.length} brands, ${r.mismatches.length} mismatches`, duration: 3000 } });
      }
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Inference failed: ${e.message}`, duration: 4000 } });
    } finally { setBusy(false); }
  };

  const analyzeAll = async () => {
    if (!state.projectPath || !apiKey) return;
    const files = collectFiles(state.fileTree).slice(0, 80);
    setBusy(true);
    setProgress({ done: 0, total: files.length, path: '' });
    const store = await loadSemanticStore(state.projectPath);
    // Process in small batches so the UI progress animates smoothly.
    const BATCH = 3;
    let done = 0;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      await Promise.all(batch.map(async (f) => {
        setProgress({ done, total: files.length, path: f.name });
        try {
          // Read file content fresh — we can't assume it's open.
          const fr = await window.lorica.fs.readFile(f.path);
          if (!fr?.success) { done++; return; }
          const r = await inferSemanticTypes({
            filePath: f.path, code: fr.data.content,
            provider, apiKey,
          });
          if (r) {
            store[f.path] = {
              inferredAt: Date.now(),
              brands: r.brands, mismatches: r.mismatches,
            };
          }
        } catch { /* skip file */ }
        done++;
        setProgress({ done, total: files.length, path: f.name });
      }));
    }
    await saveSemanticStore(state.projectPath, store);
    dispatch({ type: 'SET_SEMANTIC_TYPES', store });
    setProgress(null);
    setBusy(false);
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Analyzed ${files.length} files`, duration: 3000 } });
  };

  const exportTs = async () => {
    if (!state.projectPath) return;
    const ts = exportBrandsToTypescript(state.semanticTypes);
    const sep = state.projectPath.includes('\\') ? '\\' : '/';
    const path = `${state.projectPath}${sep}.lorica${sep}brands.ts`;
    try {
      await window.lorica.fs.createDir(`${state.projectPath}${sep}.lorica`);
      await window.lorica.fs.writeFile(path, ts);
      dispatch({ type: 'OPEN_FILE', file: { path, name: 'brands.ts', extension: 'ts', content: ts, dirty: false } });
      close();
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: `Export failed: ${e.message}`, duration: 3000 } });
    }
  };

  const clearStore = async () => {
    if (!confirm('Clear all semantic-type data for this project?')) return;
    await saveSemanticStore(state.projectPath, {});
    dispatch({ type: 'SET_SEMANTIC_TYPES', store: {} });
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Semantic store cleared', duration: 1500 } });
  };

  const brandFiles = selectedBrand
    ? summary.brands.find((b) => b.name === selectedBrand)?.files || []
    : [];
  const brandMismatches = selectedBrand
    ? Object.entries(state.semanticTypes || {}).flatMap(([path, entry]) =>
        (entry.mismatches || [])
          .filter((m) => m.expected === selectedBrand || m.actual === selectedBrand)
          .map((m) => ({ path, ...m }))
      )
    : [];

  const openAtLine = (path, line) => {
    window.lorica.fs.readFile(path).then((r) => {
      if (!r?.success) return;
      const name = path.split(/[\\/]/).pop();
      const ext = name.includes('.') ? name.split('.').pop() : '';
      dispatch({
        type: 'OPEN_FILE',
        file: { path, name, extension: ext, content: r.data.content, dirty: false, pendingGoto: { line } },
      });
      close();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-5xl h-full max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_50px_rgba(56,189,248,0.2)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Layers size={15} className="text-sky-400" />
          <div className="text-sm font-semibold text-lorica-text">Semantic Types</div>
          <div className="text-[10px] text-lorica-textDim">{summary.files} files · {summary.brands.length} brands · {summary.totalMismatches} mismatches</div>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-[10px] text-lorica-textDim cursor-pointer">
            <input
              type="checkbox"
              checked={!!state.semanticAutoEnabled}
              onChange={() => dispatch({ type: 'TOGGLE_SEMANTIC_AUTO' })}
              className="accent-sky-400"
            />
            Auto-infer on save
          </label>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-2 border-b border-lorica-border bg-lorica-panel/40">
          <button onClick={analyzeActive} disabled={busy || !activeFile || !apiKey}
            className="flex items-center gap-1 px-2 py-1 rounded bg-sky-500/15 border border-sky-400/40 text-sky-300 text-[11px] hover:bg-sky-500/25 disabled:opacity-40">
            <Play size={10} /> Analyze active file
          </button>
          <button onClick={analyzeAll} disabled={busy || !apiKey}
            className="flex items-center gap-1 px-2 py-1 rounded bg-sky-500/15 border border-sky-400/40 text-sky-300 text-[11px] hover:bg-sky-500/25 disabled:opacity-40">
            <Zap size={10} /> Analyze entire project
          </button>
          <button onClick={exportTs} disabled={summary.brands.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded border border-lorica-border text-[11px] text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/40 disabled:opacity-40">
            <Download size={10} /> Export brands.ts
          </button>
          <div className="flex-1" />
          <button onClick={clearStore} disabled={summary.files === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-lorica-textDim hover:text-red-400 disabled:opacity-30">
            <Trash2 size={10} /> Clear
          </button>
          {busy && (
            <div className="flex items-center gap-1.5 text-[11px] text-sky-400">
              <Loader2 size={11} className="animate-spin" />
              {progress
                ? <>{progress.done}/{progress.total} · {progress.path.slice(-24)}</>
                : 'Analyzing…'}
            </div>
          )}
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Brand list */}
          <div className="w-64 border-r border-lorica-border overflow-y-auto shrink-0">
            <div className="px-3 py-2 text-[9px] uppercase tracking-widest text-lorica-textDim font-semibold border-b border-lorica-border">Brands</div>
            {summary.brands.length === 0 && (
              <div className="p-3 text-[11px] text-lorica-textDim">No brands inferred yet.</div>
            )}
            {summary.brands.map((b) => (
              <button
                key={b.name}
                onClick={() => setSelectedBrand(b.name === selectedBrand ? null : b.name)}
                className={`w-full text-left px-3 py-1.5 border-b border-lorica-border/40 transition-colors ${
                  selectedBrand === b.name ? 'bg-sky-400/15' : 'hover:bg-lorica-border/30'
                }`}
              >
                <div className={`text-[11px] font-mono font-semibold ${selectedBrand === b.name ? 'text-sky-400' : 'text-lorica-text'}`}>
                  {b.name}
                </div>
                <div className="text-[9px] text-lorica-textDim">{b.count} file{b.count === 1 ? '' : 's'}</div>
              </button>
            ))}
          </div>

          {/* Right pane: brand detail OR all mismatches */}
          <div className="flex-1 overflow-y-auto">
            {selectedBrand ? (
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-lorica-textDim">Brand</div>
                  <div className="text-sm font-mono font-semibold text-sky-400">{selectedBrand}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-lorica-textDim mb-1">
                    Appears in {brandFiles.length} file{brandFiles.length === 1 ? '' : 's'}
                  </div>
                  <div className="space-y-1">
                    {brandFiles.map((f) => (
                      <button key={f} onClick={() => openAtLine(f, 1)} className="w-full text-left text-[11px] font-mono text-lorica-accent hover:underline truncate">
                        {f.split(/[\\/]/).pop()}
                      </button>
                    ))}
                  </div>
                </div>
                {brandMismatches.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-amber-400 mb-1 flex items-center gap-1">
                      <AlertTriangle size={10} /> {brandMismatches.length} mismatch{brandMismatches.length === 1 ? '' : 'es'} involving this brand
                    </div>
                    <div className="space-y-1">
                      {brandMismatches.map((m, i) => (
                        <button
                          key={i}
                          onClick={() => openAtLine(m.path, m.line)}
                          className="w-full text-left rounded border border-amber-400/30 bg-amber-400/5 p-2 hover:bg-amber-400/10 transition-colors"
                        >
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-lorica-accent font-mono">{m.path.split(/[\\/]/).pop()}:{m.line}</span>
                            <span className="text-amber-400">{m.expected || '?'} ← {m.actual || '?'}</span>
                          </div>
                          <div className="text-[11px] text-lorica-text mt-0.5">{m.message}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <AllMismatches store={state.semanticTypes} openAtLine={openAtLine} />
            )}
          </div>
        </div>

        <div className="flex items-center px-5 py-2 border-t border-lorica-border text-[10px] text-lorica-textDim">
          <Sparkles size={10} className="mr-1 text-sky-400" />
          Brands are AI-inferred from naming and data flow. Edit/ignore by annotating <code>// @sem-ignore</code> at the mismatch line.
        </div>
      </div>
    </div>
  );
}

function AllMismatches({ store, openAtLine }) {
  const all = [];
  for (const [path, entry] of Object.entries(store || {})) {
    for (const m of (entry.mismatches || [])) all.push({ path, ...m });
  }
  all.sort((a, b) => (a.severity === 'warning' ? -1 : 1));
  if (all.length === 0) {
    return <div className="p-6 text-center text-[11px] text-emerald-400">No mismatches found across the analyzed files.</div>;
  }
  return (
    <div className="p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-lorica-textDim">All mismatches</div>
      {all.map((m, i) => (
        <button
          key={i}
          onClick={() => openAtLine(m.path, m.line)}
          className="w-full text-left rounded border border-amber-400/30 bg-amber-400/5 p-2 hover:bg-amber-400/10 transition-colors"
        >
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-lorica-accent font-mono">{m.path.split(/[\\/]/).pop()}:{m.line}</span>
            <span className="text-amber-400">expected {m.expected || '?'}, got {m.actual || '?'}</span>
          </div>
          <div className="text-[11px] text-lorica-text mt-0.5">{m.message}</div>
        </button>
      ))}
    </div>
  );
}
