// src/components/ImageToCodeModal.jsx
//
// Wave 63 — UI for image-to-code. The user drops a file, pastes from
// clipboard (Cmd+V / Ctrl+V), or picks from a file dialog. The image
// previews; on "Transcribe" we send it to the vision API and show
// the result in a read-only textarea. "Insert at cursor" routes the
// text through the existing `lorica:insertAtCursor` event so the
// active editor receives it without touching CM internals.

import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X, Loader2, Sparkles, AlertTriangle, ClipboardPaste, Upload, Copy } from 'lucide-react';
import { transcribeImage } from '../utils/aiImageToCode';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('file read failed'));
    fr.readAsDataURL(file);
  });
}

export default function ImageToCodeModal({ state, dispatch, activeFile }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showImageToCode', value: false });
  };

  const provider = state.aiProvider || 'anthropic';
  const apiKey = state.aiApiKey;

  // Clipboard paste handler. Listens on the document so the user can
  // Cmd+V / Ctrl+V anywhere inside the modal.
  useEffect(() => {
    const onPaste = async (e) => {
      const items = e?.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type?.startsWith('image/')) {
          const blob = it.getAsFile();
          if (blob) {
            try {
              const url = await fileToDataUrl(blob);
              setDataUrl(url);
              setError(null);
              setResult('');
            } catch (err) {
              setError(String(err?.message || err));
            }
            e.preventDefault();
            return;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const pickFile = () => fileInputRef.current?.click();
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type?.startsWith('image/')) {
      setError('Pick an image file (PNG / JPG / WebP).');
      return;
    }
    try {
      setDataUrl(await fileToDataUrl(f));
      setError(null);
      setResult('');
    } catch (err) {
      setError(String(err?.message || err));
    }
  };

  const run = async () => {
    if (!dataUrl) { setError('Drop an image first.'); return; }
    setBusy(true);
    setError(null);
    setResult('');
    abortRef.current = new AbortController();
    try {
      const out = await transcribeImage({
        dataUrl,
        languageHint: activeFile?.extension,
        provider, apiKey,
        signal: abortRef.current.signal,
      });
      if (!out) throw new Error('No code detected in the image.');
      setResult(out);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    if (!result) return;
    window.dispatchEvent(new CustomEvent('lorica:insertAtCursor', { detail: { text: result } }));
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Transcribed code inserted at cursor', duration: 2500 } });
    close();
  };

  const copyOut = async () => {
    try { await navigator.clipboard.writeText(result); }
    catch {}
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Copied to clipboard', duration: 1500 } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div className="w-full max-w-3xl max-h-[88vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(244,114,182,0.18)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <ImageIcon size={15} className="text-pink-400" />
          <div className="text-sm font-semibold text-lorica-text">Image → Code (AI vision)</div>
          <div className="text-[10px] text-lorica-textDim">Paste, drop, or pick a screenshot of code.</div>
          <div className="flex-1" />
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        {provider !== 'anthropic' && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/30">
            <AlertTriangle size={12} />
            Image-to-code needs the Anthropic provider. Current: {provider}.
          </div>
        )}

        <div className="px-5 py-3 grid grid-cols-2 gap-3 flex-1 overflow-hidden">
          {/* Left: image preview / drop zone */}
          <div
            className="rounded-lg border-2 border-dashed border-lorica-border bg-lorica-bg/40 flex flex-col items-center justify-center min-h-[260px] p-3 text-[11px] text-lorica-textDim relative cursor-pointer hover:border-pink-400/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const f = e.dataTransfer?.files?.[0];
              if (f?.type?.startsWith('image/')) {
                try { setDataUrl(await fileToDataUrl(f)); setError(null); setResult(''); }
                catch (err) { setError(String(err?.message || err)); }
              }
            }}
            onClick={pickFile}
          >
            {dataUrl ? (
              <img src={dataUrl} alt="paste preview" className="max-w-full max-h-[260px] rounded" />
            ) : (
              <>
                <Upload size={20} className="mb-2 opacity-60" />
                <div>Click to pick, drop an image, or Ctrl+V to paste.</div>
                <div className="mt-1 opacity-60">PNG / JPG / WebP up to ~4 MB.</div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFile}
            />
          </div>

          {/* Right: result */}
          <div className="rounded-lg border border-lorica-border bg-lorica-bg/40 flex flex-col min-h-[260px]">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-lorica-border text-[10px] text-lorica-textDim">
              Result
              <div className="flex-1" />
              {result && (
                <button onClick={copyOut} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-lorica-textDim hover:text-lorica-accent" title="Copy to clipboard">
                  <Copy size={9} />
                </button>
              )}
            </div>
            <textarea
              readOnly
              value={result}
              placeholder={busy ? 'Transcribing…' : 'Run transcription to see the code here.'}
              className="flex-1 bg-transparent text-[11px] text-lorica-text font-mono p-3 outline-none resize-none"
            />
          </div>
        </div>

        {error && (
          <div className="px-5 py-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border-t border-red-500/30">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        <div className="border-t border-lorica-border px-4 py-3 flex items-center gap-2">
          <button
            onClick={pickFile}
            className="flex items-center gap-1 px-3 py-1.5 rounded border border-lorica-border text-[11px] text-lorica-textDim hover:text-lorica-text"
          >
            <ClipboardPaste size={11} /> Pick file
          </button>
          <div className="flex-1" />
          <button
            onClick={run}
            disabled={!dataUrl || busy || provider !== 'anthropic'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-pink-400/15 border border-pink-400/40 text-[11px] text-pink-200 hover:bg-pink-400/25 disabled:opacity-40"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Transcribe
          </button>
          <button
            onClick={insert}
            disabled={!result}
            className="px-3 py-1.5 rounded bg-emerald-400/15 border border-emerald-400/40 text-[11px] text-emerald-200 hover:bg-emerald-400/25 disabled:opacity-40"
          >
            Insert at cursor
          </button>
        </div>
      </div>
    </div>
  );
}
