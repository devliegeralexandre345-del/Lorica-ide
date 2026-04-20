// src/components/SnippetPalette.jsx
//
// Snippet picker with a preview pane + AI-generate mode. The built-in
// snippets still live in `utils/snippets` per language; the "AI" tab
// asks the model for a snippet that matches a natural-language prompt
// (e.g. "fetch JSON with error handling") and streams the result for
// review before inserting.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Code2, Search, X, Sparkles, Loader2 } from 'lucide-react';
import { getSnippetsForExtension } from '../utils/snippets';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK  = 'https://api.deepseek.com/v1/chat/completions';
const MODELS = { anthropic: 'claude-3-5-haiku-20241022', deepseek: 'deepseek-chat' };

async function genSnippet({ prompt, language, provider, apiKey, signal }) {
  const model = MODELS[provider] || MODELS.anthropic;
  const sys = `You write a single code snippet for a developer's IDE. Output ONLY the raw code — no fences, no commentary, no explanations. Language: ${language || 'auto-detect'}. Keep it short (under 20 lines). Idiomatic for the language.`;
  const userMsg = `Snippet request: ${prompt}`;
  try {
    let text = '';
    if (provider === 'anthropic') {
      const r = await tauriFetch(ANTHROPIC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: 500, system: sys, messages: [{ role: 'user', content: userMsg }] }),
        signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      text = (data?.content || []).map((b) => b.text || '').join('');
    } else {
      const r = await fetch(DEEPSEEK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }),
        signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      text = data?.choices?.[0]?.message?.content || '';
    }
    // Strip any code fences the model slipped in.
    return text.replace(/^\s*```[\w+-]*\n?/, '').replace(/```\s*$/, '').trim();
  } catch (e) {
    throw e;
  }
}

export default function SnippetPalette({ activeFile, dispatch, onInsert, state }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mode, setMode] = useState('library'); // 'library' | 'ai'
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [mode]);

  const ext = activeFile?.extension || '';
  const provider = state?.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state?.aiApiKey : state?.aiDeepseekKey;

  const allSnippets = useMemo(() => {
    const snippets = getSnippetsForExtension(ext);
    return Object.values(snippets);
  }, [ext]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allSnippets;
    const q = query.toLowerCase();
    return allSnippets.filter((s) =>
      s.prefix.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
    );
  }, [allSnippets, query]);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showSnippets', value: false });

  const insertSnippet = (snippet) => {
    const expanded = snippet.body.replace(/\$\{\d+:?([^}]*)}/g, '$1');
    if (onInsert) onInsert(expanded);
    close();
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Inserted: ${snippet.label}`, duration: 1500 } });
  };

  const insertAi = () => {
    if (!aiResult) return;
    if (onInsert) onInsert(aiResult);
    close();
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'AI snippet inserted', duration: 1500 } });
  };

  const runAiGen = async () => {
    if (!aiPrompt.trim() || !apiKey) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setAiBusy(true); setAiError(''); setAiResult('');
    try {
      const text = await genSnippet({ prompt: aiPrompt, language: ext, provider, apiKey, signal: abortRef.current.signal });
      setAiResult(text || '(empty response)');
    } catch (e) {
      if (e.name !== 'AbortError') setAiError(e.message || String(e));
    } finally { setAiBusy(false); }
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (mode !== 'library') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered.length > 0) insertSnippet(filtered[Math.min(selectedIdx, filtered.length - 1)]);
  };

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => {
    if (mode !== 'library') return;
    if (listRef.current?.children[selectedIdx]) {
      listRef.current.children[selectedIdx].scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx, mode]);

  const selectedSnippet = filtered[Math.min(selectedIdx, filtered.length - 1)];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 lorica-modal-overlay" onClick={close}>
      <div className="w-[720px] bg-lorica-panel border border-lorica-border rounded-2xl shadow-2xl overflow-hidden animate-fadeIn flex flex-col max-h-[70vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-lorica-border shrink-0">
          <Code2 size={16} className="text-lorica-accent" />
          <div className="flex rounded border border-lorica-border overflow-hidden">
            <button
              onClick={() => setMode('library')}
              className={`px-2 py-0.5 text-[10px] ${mode === 'library' ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-textDim'}`}
            >
              Library
            </button>
            <button
              onClick={() => setMode('ai')}
              className={`px-2 py-0.5 text-[10px] border-l border-lorica-border flex items-center gap-1 ${mode === 'ai' ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-textDim'}`}
            >
              <Sparkles size={9} /> AI
            </button>
          </div>
          {mode === 'library' ? (
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder={`Snippets for .${ext || '?'}...`}
              className="flex-1 bg-transparent text-sm text-lorica-text outline-none placeholder:text-lorica-textDim/50"
            />
          ) : (
            <input
              ref={inputRef}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !aiBusy) runAiGen(); if (e.key === 'Escape') close(); }}
              placeholder={`Describe what you need for .${ext || '?'}…`}
              className="flex-1 bg-transparent text-sm text-lorica-text outline-none placeholder:text-lorica-textDim/50"
            />
          )}
          <span className="text-[10px] text-lorica-textDim">
            {mode === 'library' ? filtered.length : aiBusy ? 'generating…' : (aiResult ? 'ready' : 'enter to run')}
          </span>
        </div>

        {mode === 'library' ? (
          <div className="flex-1 flex overflow-hidden">
            <div ref={listRef} className="w-64 overflow-y-auto py-1 border-r border-lorica-border shrink-0">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-lorica-textDim">
                  {allSnippets.length === 0 ? `No snippets for .${ext}` : 'No matches'}
                </div>
              ) : (
                filtered.map((snippet, i) => (
                  <button
                    key={snippet.prefix}
                    className={`w-full flex items-start gap-2 px-3 py-1.5 transition-colors text-left ${
                      i === selectedIdx ? 'bg-lorica-accent/10' : 'hover:bg-lorica-panel/80'
                    }`}
                    onClick={() => insertSnippet(snippet)}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    <kbd className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      i === selectedIdx ? 'bg-lorica-accent/20 text-lorica-accent' : 'bg-lorica-bg text-lorica-textDim'
                    }`}>{snippet.prefix}</kbd>
                    <span className={`text-[11px] truncate ${i === selectedIdx ? 'text-lorica-accent' : 'text-lorica-text'}`}>{snippet.label}</span>
                  </button>
                ))
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {selectedSnippet ? (
                <div className="p-3">
                  <div className="text-[10px] text-lorica-textDim mb-1">{selectedSnippet.label}</div>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap text-lorica-text bg-lorica-bg/60 border border-lorica-border rounded p-2">
                    {selectedSnippet.body.replace(/\$\{\d+:?([^}]*)}/g, '$1')}
                  </pre>
                </div>
              ) : (
                <div className="p-6 text-[11px] text-lorica-textDim text-center">Pick a snippet to preview it here.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {!apiKey && (
              <div className="px-4 py-3 text-[11px] text-amber-400 border-b border-lorica-border">
                Configure an API key in Settings to use AI snippet generation.
              </div>
            )}
            {aiError && <div className="px-4 py-2 text-[11px] text-red-400">{aiError}</div>}
            <div className="flex-1 overflow-y-auto p-3">
              {aiBusy ? (
                <div className="flex items-center gap-2 text-[11px] text-lorica-textDim">
                  <Loader2 size={12} className="animate-spin text-lorica-accent" />
                  Generating snippet for .{ext}…
                </div>
              ) : aiResult ? (
                <pre className="text-[11px] font-mono whitespace-pre-wrap text-lorica-text bg-lorica-bg/60 border border-lorica-border rounded p-2">
                  {aiResult}
                </pre>
              ) : (
                <div className="text-[11px] text-lorica-textDim">
                  Type what you need and press Enter. Examples:
                  <ul className="mt-2 space-y-1 list-disc pl-4">
                    <li>"fetch JSON with error handling and retry"</li>
                    <li>"debounce hook for React"</li>
                    <li>"parse CSV with headers"</li>
                  </ul>
                </div>
              )}
            </div>
            {aiResult && !aiBusy && (
              <div className="px-4 py-2 border-t border-lorica-border flex justify-end gap-2">
                <button onClick={runAiGen} className="px-2 py-1 rounded border border-lorica-border text-[11px] text-lorica-textDim hover:text-lorica-text">
                  Regenerate
                </button>
                <button onClick={insertAi} className="px-3 py-1 rounded bg-lorica-accent/20 border border-lorica-accent/40 text-lorica-accent text-[11px] font-semibold hover:bg-lorica-accent/30">
                  Insert
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
