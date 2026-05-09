// src/components/SmartPasteModal.jsx
//
// "Smart paste" UX (Wave 11.3). Reads the clipboard, detects the
// source language, asks the active AI provider to translate it into
// the target language (= the active file's language), shows a side-by-
// side preview, and inserts the translation at the cursor on confirm.
//
// Why it's a modal instead of a CodeMirror inline overlay:
//   • The translation is a non-trivial write — we want the user to see
//     and approve before it lands. Same pattern as ApplyCodeModal.
//   • A side-by-side diff is too much for an in-editor toolbar.
//   • We don't want to fight with the editor's selection state.

import React, { useEffect, useRef, useState } from 'react';
import {
  X, Wand2, ArrowRight, Loader2, AlertTriangle, Check, Clipboard, Languages,
} from 'lucide-react';
import { detectLanguage, shouldOfferTranslation, translateSnippet } from '../utils/aiSmartPaste';
import { isKeyless } from '../utils/aiProviders';

const PRETTY_LANG = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript',
  rust: 'Rust', go: 'Go', java: 'Java', csharp: 'C#', cpp: 'C++',
  sql: 'SQL', bash: 'Bash',
};

const pretty = (l) => PRETTY_LANG[l] || (l ? l.charAt(0).toUpperCase() + l.slice(1) : 'unknown');

export default function SmartPasteModal({ state, dispatch, activeFile, onInsert }) {
  const [clipboard, setClipboard] = useState('');
  const [clipboardError, setClipboardError] = useState(null);
  const [detected, setDetected] = useState(null);
  const [targetLang, setTargetLang] = useState(activeFile?.extension || '');
  const [translation, setTranslation] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState(null);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showSmartPaste', value: false });
  };

  // On mount: read the clipboard once. The clipboard API requires a
  // user gesture; opening this modal counts (it was opened in response
  // to a click / keypress). On Linux WebKit2GTK clipboard reads can
  // throw — we catch and surface.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (cancelled) return;
        setClipboard(text || '');
        const det = detectLanguage(text || '');
        setDetected(det);
      } catch (e) {
        if (!cancelled) setClipboardError(String(e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Track active-file extension changes (in case the user opens a file
  // before clicking Translate).
  useEffect(() => {
    if (activeFile?.extension && !targetLang) setTargetLang(activeFile.extension);
  }, [activeFile, targetLang]);

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic'
    ? state.aiApiKey
    : provider === 'deepseek'
    ? state.aiDeepseekKey
    : provider === 'openrouter'
    ? state.aiOpenRouterKey
    : null;
  const providerReady = isKeyless(provider) || !!apiKey;

  const offer = shouldOfferTranslation(detected, targetLang);

  const doTranslate = async () => {
    if (!clipboard || !targetLang) return;
    setTranslating(true);
    setTranslateError(null);
    setTranslation('');
    abortRef.current = new AbortController();
    try {
      const out = await translateSnippet({
        code: clipboard,
        fromLang: detected?.lang || 'unknown',
        toLang: targetLang,
        provider,
        apiKey,
        state,
        signal: abortRef.current.signal,
      });
      setTranslation(out);
    } catch (e) {
      setTranslateError(String(e?.message || e));
    } finally {
      setTranslating(false);
    }
  };

  const insert = () => {
    if (!translation) return;
    if (typeof onInsert === 'function') onInsert(translation);
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'success', message: 'Smart-pasted translated snippet at cursor', duration: 2000 },
    });
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-4xl max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(167,139,250,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Wand2 size={15} className="text-purple-400" />
          <div className="text-sm font-semibold text-lorica-text">Smart Paste</div>
          <div className="text-[10px] text-lorica-textDim">Translate the clipboard into the active file's language with AI.</div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {clipboardError && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-amber-300 bg-amber-400/10 border-b border-amber-400/30">
            <AlertTriangle size={12} />
            Clipboard unavailable: {clipboardError}
          </div>
        )}

        {/* Source / target language indicators */}
        <div className="px-5 py-3 border-b border-lorica-border flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1.5">
            <Clipboard size={12} className="text-lorica-textDim" />
            <span className="text-lorica-textDim">Source:</span>
            <span className="font-semibold text-lorica-text">{pretty(detected?.lang)}</span>
            {detected && (
              <span className="text-[9px] text-lorica-textDim ml-1">
                ({Math.round(detected.confidence * 100)}% conf.)
              </span>
            )}
          </div>
          <ArrowRight size={11} className="text-lorica-textDim" />
          <div className="flex items-center gap-1.5">
            <Languages size={12} className="text-lorica-accent" />
            <span className="text-lorica-textDim">Target:</span>
            <input
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value.trim())}
              className="bg-lorica-bg border border-lorica-border rounded px-2 py-0.5 text-[11px] text-lorica-text font-mono outline-none focus:border-lorica-accent w-24"
              placeholder="rs"
            />
            <span className="text-lorica-text">{pretty(targetLang)}</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={doTranslate}
            disabled={!clipboard || !targetLang || translating || !providerReady}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-400/15 border border-purple-400/40 text-[11px] text-purple-200 hover:bg-purple-400/25 disabled:opacity-40"
            title={!providerReady ? `Configure ${provider} API key in Settings` : ''}
          >
            {translating ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            {translating ? 'Translating…' : offer ? `Translate to ${pretty(targetLang)}` : 'Translate'}
          </button>
        </div>

        {/* Side-by-side preview */}
        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-px bg-lorica-border">
          <div className="bg-lorica-bg/60 flex flex-col">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold border-b border-lorica-border">
              Clipboard
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono text-lorica-text whitespace-pre-wrap">
              {clipboard || (clipboardError ? '' : '(empty)')}
            </pre>
          </div>
          <div className="bg-lorica-bg/60 flex flex-col">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold border-b border-lorica-border">
              Translated ({pretty(targetLang)})
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono text-lorica-text whitespace-pre-wrap">
              {translateError
                ? <span className="text-red-300">Error: {translateError}</span>
                : translation
                ? translation
                : <span className="text-lorica-textDim">{translating ? 'Calling AI…' : 'Click Translate to convert.'}</span>}
            </pre>
          </div>
        </div>

        <div className="border-t border-lorica-border px-4 py-3 shrink-0 flex items-center gap-2">
          {!providerReady && (
            <div className="text-[10px] text-amber-300 flex items-center gap-1">
              <AlertTriangle size={10} />
              Configure your {provider} provider in Settings to enable translation.
            </div>
          )}
          <div className="flex-1" />
          <button
            onClick={close}
            className="px-3 py-1.5 rounded text-[11px] text-lorica-textDim hover:bg-lorica-border/40"
          >
            Cancel
          </button>
          <button
            onClick={insert}
            disabled={!translation}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-lorica-accent/15 border border-lorica-accent/40 text-[11px] text-lorica-accent hover:bg-lorica-accent/25 disabled:opacity-40"
          >
            <Check size={11} />
            Insert at cursor
          </button>
        </div>
      </div>
    </div>
  );
}
