import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Copy, Loader2, RefreshCw, GitPullRequest, Check } from 'lucide-react';
import { generatePrDescription } from '../utils/aiPrDescription';

/**
 * PR Description modal — launched from GitPanel. Fetches branch context
 * (commits + diff since divergence from main/master), asks the fast model
 * for a ready-to-paste markdown body, and lets the user copy or regenerate.
 */
export default function PrDescriptionModal({ state, dispatch, onClose }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);

  const provider = state.aiProvider || 'anthropic';
  const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;

  const run = useCallback(async () => {
    if (!state.projectPath) return;
    if (!apiKey) {
      setError(`Configure ta clé ${provider === 'anthropic' ? 'Anthropic' : 'DeepSeek'} dans les Paramètres.`);
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const ctxRes = await window.lorica.git.prContext(state.projectPath);
      if (ctrl.signal.aborted) return;
      if (!ctxRes || ctxRes.success === false) {
        setError(ctxRes?.error || 'Cannot read branch context.');
        setLoading(false);
        return;
      }
      const ctx = ctxRes.data || ctxRes;
      setContext(ctx);

      if (!ctx.commits || ctx.commits.length === 0) {
        setText('');
        setError(`Aucun commit entre ${ctx.baseBranch || 'main'} et ${ctx.currentBranch}. Rien à décrire.`);
        setLoading(false);
        return;
      }

      const body = await generatePrDescription({
        context: ctx,
        provider,
        apiKey,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setText(body || '');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [state.projectPath, apiKey, provider]);

  useEffect(() => {
    run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      dispatch({
        type: 'ADD_TOAST',
        toast: { type: 'success', message: 'Description PR copiée', duration: 2000 },
      });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      dispatch({
        type: 'ADD_TOAST',
        toast: { type: 'error', message: 'Copie impossible — sélectionne et fais Ctrl+C' },
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[720px] max-w-[92vw] max-h-[80vh] flex flex-col bg-lorica-surface border border-lorica-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-lorica-border bg-lorica-panel/60">
          <div className="flex items-center gap-2 text-xs font-semibold text-lorica-text">
            <GitPullRequest size={14} className="text-purple-400" />
            Description de PR générée par l'IA
            {context && (
              <span className="text-[10px] font-normal text-lorica-textDim ml-2">
                {context.currentBranch} ← {context.baseBranch}
                {' · '}
                {context.commits?.length || 0} commit{(context.commits?.length || 0) > 1 ? 's' : ''}
                {context.filesChanged?.length ? `, ${context.filesChanged.length} fichier${context.filesChanged.length > 1 ? 's' : ''}` : ''}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-lorica-textDim hover:text-lorica-text"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-lorica-textDim">
              <Loader2 size={14} className="animate-spin text-purple-400" />
              {context ? 'Rédaction de la description…' : 'Analyse de la branche…'}
            </div>
          )}

          {!loading && error && (
            <div className="p-3 text-xs text-red-400 bg-red-900/10 border border-red-500/30 rounded">
              {error}
            </div>
          )}

          {!loading && !error && text && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full min-h-[340px] font-mono text-[11px] leading-relaxed text-lorica-text bg-lorica-bg border border-lorica-border rounded p-3 outline-none focus:border-lorica-accent resize-y"
              spellCheck={false}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-lorica-border bg-lorica-panel/60">
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-lorica-textDim hover:text-lorica-text disabled:opacity-50 transition-colors"
            title="Regenerate"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Régénérer
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-[11px] text-lorica-textDim hover:text-lorica-text transition-colors"
            >
              Fermer
            </button>
            <button
              onClick={handleCopy}
              disabled={!text || loading}
              className="flex items-center gap-1.5 px-3 py-1 text-[11px] bg-purple-500/20 text-purple-300 rounded hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
