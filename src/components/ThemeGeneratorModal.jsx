// src/components/ThemeGeneratorModal.jsx
//
// Wave 33 — UI for the AI theme generator. Free-text prompt, "Generate"
// button, live colour-swatch preview, "Save" persists into a per-user
// custom-themes localStorage list and switches to it.
//
// Saved themes don't survive a fresh install (they're not part of
// THEMES at module-eval time). They live in `lorica.themes.custom`
// and are merged into the active theme map at boot — see App.jsx.

import React, { useState } from 'react';
import { Wand2, X, Loader2, Save, Eye, AlertTriangle } from 'lucide-react';
import { generateTheme, themeKeyForName, isValidThemeShape } from '../utils/aiThemeGenerator';
import { THEMES } from '../utils/themes';

const CUSTOM_KEY = 'lorica.themes.custom';

function loadCustom() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveCustom(map) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(map)); } catch {}
}

export default function ThemeGeneratorModal({ state, dispatch }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(null);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showThemeGenerator', value: false });

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;
  const keyOk = provider === 'ollama' ? true : !!apiKey;

  const generate = async () => {
    if (!prompt.trim()) return;
    if (!keyOk) {
      setError('Configure your AI provider in Settings first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await generateTheme({
        description: prompt,
        provider, apiKey,
        ollamaBaseUrl: state.aiOllamaUrl,
        model: provider === 'ollama' ? state.aiOllamaModel
          : provider === 'openrouter' ? state.aiOpenRouterModel
          : undefined,
      });
      if (!result) throw new Error('AI returned an unparseable response. Try again or rephrase.');
      setTheme(result);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!theme || !isValidThemeShape(theme)) return;
    const existingKeys = Object.keys(THEMES).concat(Object.keys(loadCustom()));
    const key = themeKeyForName(theme.name, existingKeys);
    const next = { ...loadCustom(), [key]: theme };
    saveCustom(next);
    dispatch({ type: 'SET_THEME', theme: key });
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'success', message: `Theme "${theme.name}" saved & activated`, duration: 2500 },
    });
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-2xl lorica-glass rounded-2xl shadow-[0_0_60px_rgba(168,85,247,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Wand2 size={15} className="text-purple-400" />
          <div className="text-sm font-semibold text-lorica-text">AI Theme Generator</div>
          <div className="text-[10px] text-lorica-textDim">Describe a vibe → get a Lorica theme.</div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. tokyo at midnight, neon pink accents, deep purple base"
            className="w-full bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-[12px] text-lorica-text outline-none focus:border-purple-400/50 resize-none"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                generate();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={generate}
              disabled={!prompt.trim() || busy || !keyOk}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-400/15 border border-purple-400/40 text-[11px] text-purple-200 hover:bg-purple-400/25 disabled:opacity-40"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
              {busy ? 'Generating…' : 'Generate'}
            </button>
            <span className="text-[10px] text-lorica-textDim">
              <kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border text-[9px]">Ctrl/Cmd+Enter</kbd>
            </span>
            <div className="flex-1" />
            {!keyOk && (
              <span className="flex items-center gap-1 text-[10px] text-amber-300">
                <AlertTriangle size={10} />
                Configure {provider} provider first
              </span>
            )}
          </div>
          {error && (
            <div className="px-3 py-2 rounded bg-red-400/10 border border-red-400/30 text-[10px] text-red-300">{error}</div>
          )}
        </div>

        {theme && (
          <div className="border-t border-lorica-border px-5 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <Eye size={12} className="text-lorica-accent" />
              <span className="text-[11px] font-semibold text-lorica-text">Preview: {theme.name}</span>
              <div className="flex-1" />
              <button
                onClick={save}
                className="flex items-center gap-1 px-3 py-1 rounded bg-lorica-accent/15 border border-lorica-accent/40 text-[11px] text-lorica-accent hover:bg-lorica-accent/25"
              >
                <Save size={11} />
                Save & activate
              </button>
            </div>

            <div
              className="rounded-lg border p-4"
              style={{
                background: theme.bg,
                color: theme.text,
                borderColor: theme.border,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="text-xs font-semibold">{theme.name}</div>
                <span className="text-[10px]" style={{ color: theme.textDim }}>preview</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] mb-3">
                {[
                  ['bg', theme.bg], ['surface', theme.surface],
                  ['panel', theme.panel], ['border', theme.border],
                  ['accent', theme.accent], ['text', theme.text],
                  ['textDim', theme.textDim],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm border" style={{ background: v, borderColor: theme.border }} />
                    <span style={{ color: theme.textDim }}>{k}</span>
                    <span className="font-mono" style={{ color: theme.text }}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px]" style={{ color: theme.textDim }}>Logo bars:</span>
                {(theme.logoBars || []).slice(0, 5).map((c, i) => (
                  <span key={i} className="w-4 h-4 rounded-sm" style={{ background: c }} />
                ))}
              </div>
              <div className="mt-3" style={{ background: theme.surface, padding: 8, borderRadius: 6, color: theme.text, fontSize: 11 }}>
                <span style={{ color: theme.accent }}>const</span>{' '}
                <span>greet</span>{' '}=&nbsp;
                <span style={{ color: theme.accent }}>(name)</span>{' '}=&gt;&nbsp;
                <span>`hello ${'$'}{'{'}name{'}'}`</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
