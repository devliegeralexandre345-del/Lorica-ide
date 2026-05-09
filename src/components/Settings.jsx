import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, X, Key, Moon, Palette, Sun, Clock, Shield, Save, Map, Brain, Keyboard, Edit, AlertTriangle, Check, XCircle, Sparkles, Info, Rocket, Github, RotateCcw, Users, Mic } from 'lucide-react';
import { THEMES } from '../utils/themes';
import { DEFAULT_SHORTCUTS, getAllShortcuts, loadCustomShortcuts, saveCustomShortcuts, isValidShortcut, findConflicts, eventToShortcut } from '../utils/keymap';
import { APP_VERSION } from '../version';
import { FEATURES, FEATURE_CATEGORIES, featureStats } from '../utils/features';
import {
  isCoauthorTrailerEnabled,
  setCoauthorTrailerEnabled,
  providerCoauthor,
} from '../utils/aiCoauthor';
import {
  isVoiceFeatureEnabled,
  setVoiceFeatureEnabled,
  isVoiceSupported,
} from '../utils/voiceInput';
import { listOllamaModels, listOpenRouterModels, PROVIDER_DEFAULT_MODELS } from '../utils/aiProviders';

export default function Settings({ state, dispatch, actions }) {
  const [apiKey, setApiKey] = useState(state.aiApiKey);
  const [deepseekKey, setDeepseekKey] = useState(state.aiDeepseekKey);
  const [openRouterKey, setOpenRouterKey] = useState(state.aiOpenRouterKey || '');
  const [openRouterSaved, setOpenRouterSaved] = useState(false);
  const [openRouterModels, setOpenRouterModels] = useState([]);
  const [openRouterModelFilter, setOpenRouterModelFilter] = useState('');
  const [openRouterProbing, setOpenRouterProbing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deepseekSaved, setDeepseekSaved] = useState(false);
  // AI co-author trailer — opt-in append of `Co-authored-by:` to commits
  // when an AI edit happened in the last 30 minutes. Persisted to
  // localStorage by setCoauthorTrailerEnabled().
  const [coauthorOn, setCoauthorOn] = useState(() => isCoauthorTrailerEnabled());
  // Web Speech API dictation in the agent input. Off by default — opt-in
  // because the API hands audio to the platform speech engine (on-device
  // on macOS, Edge speech on Windows; not available on Linux WebView2).
  const [voiceOn, setVoiceOn] = useState(() => isVoiceFeatureEnabled());
  const voiceSupported = isVoiceSupported();

  // Ollama (local LLM) provider — Wave 11. URL + model are configured
  // here; the model picker probes `/api/tags` to enumerate what the user
  // has actually pulled. Failure to reach the server is silent on first
  // open — we surface it only when the user clicks Refresh explicitly.
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState(state.aiOllamaUrl || 'http://localhost:11434');
  const [ollamaModels, setOllamaModels] = useState([]);
  const [ollamaProbing, setOllamaProbing] = useState(false);
  const [ollamaProbeError, setOllamaProbeError] = useState(null);

  const refreshOllamaModels = async () => {
    setOllamaProbing(true);
    setOllamaProbeError(null);
    try {
      const list = await listOllamaModels(ollamaUrlDraft);
      setOllamaModels(list);
      if (list.length === 0) {
        setOllamaProbeError('No models found — is Ollama running? Try `ollama list` in a terminal.');
      }
    } catch (e) {
      setOllamaProbeError(String(e?.message || e));
    } finally {
      setOllamaProbing(false);
    }
  };

  // Auto-probe once when the Ollama provider becomes active so the user
  // sees their installed models without having to click Refresh.
  useEffect(() => {
    if (state.aiProvider === 'ollama' && ollamaModels.length === 0 && !ollamaProbing) {
      refreshOllamaModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.aiProvider]);

  // Dynamic shortcuts state
  const [customShortcuts, setCustomShortcuts] = useState({});
  const [editingAction, setEditingAction] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [shortcutsLoaded, setShortcutsLoaded] = useState(false);

  useEffect(() => {
    // Load custom shortcuts from localStorage on mount
    const loaded = loadCustomShortcuts();
    setCustomShortcuts(loaded);
    const conflicts = findConflicts(loaded);
    setConflicts(conflicts);
    setShortcutsLoaded(true);
  }, []);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showSettings', value: false });

  const startEditing = (actionId) => {
    setEditingAction(actionId);
    setCapturing(true);
  };

  const cancelEditing = () => {
    setEditingAction(null);
    setCapturing(false);
  };

  const saveShortcut = (actionId, shortcut) => {
    if (!isValidShortcut(shortcut)) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'error', message: 'Invalid shortcut format' } });
      return;
    }

    const updated = { ...customShortcuts, [actionId]: shortcut };
    const newConflicts = findConflicts(updated);
    
    if (newConflicts.length > 0) {
      setConflicts(newConflicts);
      dispatch({ type: 'ADD_TOAST', toast: { 
        type: 'warning', 
        message: `Shortcut conflicts detected: ${newConflicts[0].description1} vs ${newConflicts[0].description2}` 
      } });
    } else {
      setConflicts([]);
    }

    setCustomShortcuts(updated);
    saveCustomShortcuts(updated);
    setEditingAction(null);
    setCapturing(false);
    
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Shortcut saved' } });
  };

  const resetShortcut = (actionId) => {
    const updated = { ...customShortcuts };
    delete updated[actionId];
    setCustomShortcuts(updated);
    saveCustomShortcuts(updated);
    const newConflicts = findConflicts(updated);
    setConflicts(newConflicts);
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Shortcut reset to default' } });
  };

  const resetAllShortcuts = () => {
    setCustomShortcuts({});
    saveCustomShortcuts({});
    setConflicts([]);
    dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'All shortcuts reset to defaults' } });
  };

  const handleKeyCapture = (e) => {
    if (!capturing || !editingAction) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Don't capture Escape for cancel - we'll handle separately
    if (e.key === 'Escape') {
      cancelEditing();
      return;
    }
    
    const shortcut = eventToShortcut(e);
    saveShortcut(editingAction, shortcut);
  };

  // Effect to attach/detach global key listener for capturing
  useEffect(() => {
    if (capturing) {
      window.addEventListener('keydown', handleKeyCapture, true);
      return () => window.removeEventListener('keydown', handleKeyCapture, true);
    }
  }, [capturing, editingAction]);

  // Save the key into the encrypted vault so it survives relaunch. The
  // old code only dispatched into React state — that's in-memory and
  // vanishes on reload. We still dispatch for the current session, but
  // the canonical store is now the vault.
  const persistKeyToVault = async (vaultKey, value, displayName) => {
    // If the vault is locked or not yet initialised, warn the user
    // instead of silently losing the key.
    if (!state.vaultUnlocked) {
      dispatch({ type: 'ADD_TOAST', toast: {
        type: 'warning',
        message: `${displayName} not persisted — unlock the vault first to save it permanently.`,
        duration: 4000,
      }});
      return false;
    }
    try {
      const res = await window.lorica.security.addSecret(vaultKey, value);
      if (res?.success === false) {
        dispatch({ type: 'ADD_TOAST', toast: {
          type: 'error',
          message: `Vault save failed: ${res.error || 'unknown'}`,
        }});
        return false;
      }
      return true;
    } catch (e) {
      dispatch({ type: 'ADD_TOAST', toast: {
        type: 'error',
        message: `Vault save error: ${String(e)}`,
      }});
      return false;
    }
  };

  const saveApiKey = async () => {
    dispatch({ type: 'SET_AI_KEY', key: apiKey });
    const persisted = await persistKeyToVault('anthropic_api_key', apiKey, 'Anthropic API key');
    setSaved(true);
    dispatch({ type: 'ADD_TOAST', toast: {
      type: persisted ? 'success' : 'info',
      message: persisted ? 'API key saved to vault' : 'API key saved (session only)',
    }});
    setTimeout(() => setSaved(false), 2000);
  };

  const saveDeepseekKey = async () => {
    dispatch({ type: 'SET_DEEPSEEK_KEY', key: deepseekKey });
    const persisted = await persistKeyToVault('deepseek_api_key', deepseekKey, 'DeepSeek API key');
    setDeepseekSaved(true);
    dispatch({ type: 'ADD_TOAST', toast: {
      type: persisted ? 'success' : 'info',
      message: persisted ? 'DeepSeek key saved to vault' : 'DeepSeek key saved (session only)',
    }});
    setTimeout(() => setDeepseekSaved(false), 2000);
  };

  const saveOpenRouterKey = async () => {
    dispatch({ type: 'SET_OPENROUTER_KEY', key: openRouterKey });
    const persisted = await persistKeyToVault('openrouter_api_key', openRouterKey, 'OpenRouter API key');
    setOpenRouterSaved(true);
    dispatch({ type: 'ADD_TOAST', toast: {
      type: persisted ? 'success' : 'info',
      message: persisted ? 'OpenRouter key saved to vault' : 'OpenRouter key saved (session only)',
    }});
    setTimeout(() => setOpenRouterSaved(false), 2000);
    // Trigger a model-catalog refresh now that we have a key.
    refreshOpenRouterModels();
  };

  const refreshOpenRouterModels = async () => {
    setOpenRouterProbing(true);
    try {
      const list = await listOpenRouterModels({ apiKey: openRouterKey || state.aiOpenRouterKey });
      setOpenRouterModels(list);
    } finally {
      setOpenRouterProbing(false);
    }
  };

  // Auto-fetch the OpenRouter catalog the first time the user lands on
  // the OpenRouter provider — saves a manual click. Empty list is fine
  // (catalog endpoint is open without a key).
  useEffect(() => {
    if (state.aiProvider === 'openrouter' && openRouterModels.length === 0 && !openRouterProbing) {
      refreshOpenRouterModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.aiProvider]);

  const themeIcons = { midnight: Moon, hacker: Palette, arctic: Sun };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div className="w-[480px] max-h-[80vh] bg-lorica-panel border border-lorica-border rounded-xl shadow-2xl flex flex-col animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-lorica-border">
          <div className="flex items-center gap-2">
            <SettingsIcon size={16} className="text-lorica-accent" />
            <span className="text-sm font-semibold text-lorica-text">Settings</span>
          </div>
          <button onClick={close} className="text-lorica-textDim hover:text-lorica-text"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* AI Provider Selection */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
              <Brain size={14} className="text-lorica-accent" />
              AI Provider
            </label>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => dispatch({ type: 'SET_AI_PROVIDER', provider: 'anthropic' })}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  state.aiProvider === 'anthropic'
                    ? 'bg-lorica-accent text-lorica-bg'
                    : 'bg-lorica-bg border border-lorica-border text-lorica-textDim hover:text-lorica-text'
                }`}
              >
                Anthropic Claude
              </button>
              <button
                onClick={() => dispatch({ type: 'SET_AI_PROVIDER', provider: 'deepseek' })}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  state.aiProvider === 'deepseek'
                    ? 'bg-lorica-accent text-lorica-bg'
                    : 'bg-lorica-bg border border-lorica-border text-lorica-textDim hover:text-lorica-text'
                }`}
              >
                DeepSeek
              </button>
              <button
                onClick={() => dispatch({ type: 'SET_AI_PROVIDER', provider: 'ollama' })}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  state.aiProvider === 'ollama'
                    ? 'bg-lorica-accent text-lorica-bg'
                    : 'bg-lorica-bg border border-lorica-border text-lorica-textDim hover:text-lorica-text'
                }`}
                title="Run AI fully locally via Ollama — zero network egress"
              >
                Ollama (local)
              </button>
              <button
                onClick={() => dispatch({ type: 'SET_AI_PROVIDER', provider: 'openrouter' })}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  state.aiProvider === 'openrouter'
                    ? 'bg-lorica-accent text-lorica-bg'
                    : 'bg-lorica-bg border border-lorica-border text-lorica-textDim hover:text-lorica-text'
                }`}
                title="OpenRouter — BYOK aggregator giving access to 100+ models under one key"
              >
                OpenRouter
              </button>
            </div>

            {/* Conditionally show API key input based on provider */}
            {state.aiProvider === 'openrouter' ? (
              <div className="space-y-3">
                <div className="px-3 py-2 rounded-lg bg-cyan-400/10 border border-cyan-400/30 text-[10px] text-cyan-200">
                  <strong>BYOK aggregator.</strong> One API key gives you access to
                  100+ models (Claude, GPT-4o, Llama, Qwen, Gemini, …). Get a key
                  at <code>openrouter.ai/keys</code>. Same OpenAI-compatible
                  protocol as DeepSeek + Ollama.
                </div>

                <div>
                  <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
                    <Key size={14} className="text-lorica-accent" />
                    OpenRouter API Key
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={openRouterKey}
                      onChange={(e) => setOpenRouterKey(e.target.value)}
                      placeholder="sk-or-..."
                      className="flex-1 bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent font-mono"
                    />
                    <button
                      onClick={saveOpenRouterKey}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        openRouterSaved ? 'bg-lorica-success/20 text-lorica-success' : 'bg-lorica-accent text-lorica-bg hover:bg-lorica-accent/80'
                      }`}
                    >
                      {openRouterSaved ? '✓ Saved' : 'Save'}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Model</label>
                    <button
                      onClick={refreshOpenRouterModels}
                      disabled={openRouterProbing}
                      className="text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40"
                    >
                      {openRouterProbing ? 'Probing…' : `Refresh (${openRouterModels.length})`}
                    </button>
                  </div>
                  <input
                    value={openRouterModelFilter}
                    onChange={(e) => setOpenRouterModelFilter(e.target.value)}
                    placeholder="Filter… (e.g. claude, llama, qwen)"
                    className="w-full mb-2 bg-lorica-bg border border-lorica-border rounded-lg px-3 py-1.5 text-[11px] text-lorica-text outline-none focus:border-lorica-accent"
                  />
                  {openRouterModels.length > 0 ? (
                    <select
                      value={state.aiOpenRouterModel || PROVIDER_DEFAULT_MODELS.openrouter}
                      onChange={(e) => dispatch({ type: 'SET_OPENROUTER_MODEL', model: e.target.value })}
                      className="w-full bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent font-mono"
                    >
                      {openRouterModels
                        .filter((m) => {
                          const q = openRouterModelFilter.trim().toLowerCase();
                          if (!q) return true;
                          return (m.id || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q);
                        })
                        .slice(0, 200)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.id}
                            {m.context_length ? ` — ${(m.context_length / 1000).toFixed(0)}k ctx` : ''}
                            {m.pricing?.prompt ? ` — $${(parseFloat(m.pricing.prompt) * 1_000_000).toFixed(2)}/M tok` : ''}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      value={state.aiOpenRouterModel || ''}
                      onChange={(e) => dispatch({ type: 'SET_OPENROUTER_MODEL', model: e.target.value })}
                      placeholder="anthropic/claude-3.5-haiku"
                      className="w-full bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent font-mono"
                    />
                  )}
                  <p className="text-[10px] text-lorica-textDim mt-1">
                    Model id format: <code>provider/model-name</code> (e.g.
                    <code> anthropic/claude-3.5-sonnet</code>,
                    <code> openai/gpt-4o-mini</code>,
                    <code> meta-llama/llama-3.1-405b</code>). Pricing is per
                    million tokens; full catalog at <code>openrouter.ai/models</code>.
                  </p>
                </div>
              </div>
            ) : state.aiProvider === 'ollama' ? (
              <div className="space-y-3">
                <div className="px-3 py-2 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-[10px] text-emerald-200">
                  <strong>Privacy mode</strong> — every request stays on your machine.
                  No API key, no network egress. Make sure Ollama is running:{' '}
                  <code className="text-[9px] px-1 py-0.5 bg-lorica-bg/50 border border-emerald-400/20 rounded">ollama serve</code>.
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Server URL</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={ollamaUrlDraft}
                      onChange={(e) => setOllamaUrlDraft(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="flex-1 bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent font-mono"
                    />
                    <button
                      onClick={() => {
                        dispatch({ type: 'SET_OLLAMA_URL', url: ollamaUrlDraft });
                        refreshOllamaModels();
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-semibold bg-lorica-accent text-lorica-bg hover:bg-lorica-accent/80 transition-colors"
                    >
                      Save & probe
                    </button>
                  </div>
                  <p className="text-[10px] text-lorica-textDim mt-1">
                    Default <code className="text-[9px]">http://localhost:11434</code>. Point at a remote Ollama on your LAN if needed.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Model</label>
                    <button
                      onClick={refreshOllamaModels}
                      disabled={ollamaProbing}
                      className="text-[10px] text-lorica-textDim hover:text-lorica-accent disabled:opacity-40"
                    >
                      {ollamaProbing ? 'Probing…' : 'Refresh'}
                    </button>
                  </div>
                  {ollamaModels.length > 0 ? (
                    <select
                      value={state.aiOllamaModel || PROVIDER_DEFAULT_MODELS.ollama}
                      onChange={(e) => dispatch({ type: 'SET_OLLAMA_MODEL', model: e.target.value })}
                      className="w-full bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent font-mono"
                    >
                      {ollamaModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}{typeof m.size === 'number' ? ` — ${(m.size / 1e9).toFixed(1)} GB` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={state.aiOllamaModel || ''}
                      onChange={(e) => dispatch({ type: 'SET_OLLAMA_MODEL', model: e.target.value })}
                      placeholder="llama3.1:8b"
                      className="w-full bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent font-mono"
                    />
                  )}
                  {ollamaProbeError && (
                    <p className="text-[10px] text-amber-300 mt-1">{ollamaProbeError}</p>
                  )}
                  <p className="text-[10px] text-lorica-textDim mt-1">
                    For tool-using agents pick a model with function-calling support
                    (Llama 3.1+, Qwen 2.5+, Mistral). Smaller models (≤7B) work for inline
                    completions but may struggle with the agent loop.
                  </p>
                </div>
              </div>
            ) : state.aiProvider === 'anthropic' ? (
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
                  <Key size={14} className="text-lorica-accent" />
                  Anthropic API Key
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="flex-1 bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent font-mono"
                  />
                  <button
                    onClick={saveApiKey}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      saved ? 'bg-lorica-success/20 text-lorica-success' : 'bg-lorica-accent text-lorica-bg hover:bg-lorica-accent/80'
                    }`}
                  >
                    {saved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
                <p className="text-[10px] text-lorica-textDim mt-1">Required for AI Copilot. Get yours at console.anthropic.com</p>
              </div>
            ) : (
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
                  <Key size={14} className="text-lorica-accent" />
                  DeepSeek API Key
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={deepseekKey}
                    onChange={(e) => setDeepseekKey(e.target.value)}
                    placeholder="sk-..."
                    className="flex-1 bg-lorica-bg border border-lorica-border rounded-lg px-3 py-2 text-xs text-lorica-text outline-none focus:border-lorica-accent font-mono"
                  />
                  <button
                    onClick={saveDeepseekKey}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      deepseekSaved ? 'bg-lorica-success/20 text-lorica-success' : 'bg-lorica-accent text-lorica-bg hover:bg-lorica-accent/80'
                    }`}
                  >
                    {deepseekSaved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
                <p className="text-[10px] text-lorica-textDim mt-1">Get your API key at platform.deepseek.com</p>
              </div>
            )}
          </div>

          {/* Inline AI tab-completion */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
              <Sparkles size={14} className="text-lorica-accent" />
              Inline AI completion
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const next = !state.aiInlineEnabled;
                  dispatch({ type: 'SET_AI_INLINE_ENABLED', value: next });
                  if (next) {
                    const key = state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;
                    if (!key) {
                      dispatch({
                        type: 'ADD_TOAST',
                        toast: {
                          type: 'warning',
                          message: `Active mais aucune clé ${state.aiProvider === 'anthropic' ? 'Anthropic' : 'DeepSeek'} — renseigne-la ci-dessus.`,
                          duration: 4500,
                        },
                      });
                    } else {
                      dispatch({
                        type: 'ADD_TOAST',
                        toast: {
                          type: 'success',
                          message: 'Inline AI activé. Alt+\\ pour forcer une suggestion.',
                          duration: 3500,
                        },
                      });
                    }
                  }
                }}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                  state.aiInlineEnabled ? 'bg-lorica-accent' : 'bg-lorica-border'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  state.aiInlineEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
              <span className="text-xs text-lorica-textDim">
                {state.aiInlineEnabled ? 'Suggestions fantômes actives' : 'Désactivé'}
              </span>
            </div>
            <p className="text-[10px] text-lorica-textDim mt-1">
              <kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border text-[9px]">Tab</kbd> pour accepter •{' '}
              <kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border text-[9px]">Esc</kbd> pour rejeter •{' '}
              <kbd className="px-1 py-0.5 rounded bg-lorica-bg border border-lorica-border text-[9px]">Alt+\</kbd> pour forcer maintenant.
              Utilise un petit modèle rapide (Haiku 3.5 / DeepSeek-Chat).
            </p>
          </div>

          {/* AI co-author trailer — auto-append `Co-authored-by:` to a
              commit message when an AI edit happened recently. Off by
              default; the trailer only fires when an inline AI edit or an
              agent write_file happened in the last 30 minutes. */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
              <Users size={14} className="text-lorica-accent" />
              AI co-author commit trailer
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const next = !coauthorOn;
                  setCoauthorOn(next);
                  setCoauthorTrailerEnabled(next);
                  dispatch({
                    type: 'ADD_TOAST',
                    toast: {
                      type: 'info',
                      message: next
                        ? `Co-authored-by trailer ON — recent AI edits credit ${providerCoauthor(state.aiProvider).name}.`
                        : 'Co-authored-by trailer OFF.',
                      duration: 2500,
                    },
                  });
                }}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                  coauthorOn ? 'bg-lorica-accent' : 'bg-lorica-border'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  coauthorOn ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
              <span className="text-xs text-lorica-textDim">
                {coauthorOn
                  ? `Auto-credits ${providerCoauthor(state.aiProvider).name} on AI-touched commits`
                  : 'Off'}
              </span>
            </div>
            <p className="text-[10px] text-lorica-textDim mt-1">
              When ON, commits made via the Git panel within 30 minutes of an
              inline AI edit (Ctrl+K) or agent edit auto-append{' '}
              <code className="text-[9px] px-1 py-0.5 bg-lorica-bg border border-lorica-border rounded">
                Co-authored-by: {providerCoauthor(state.aiProvider).name} &lt;{providerCoauthor(state.aiProvider).email}&gt;
              </code>.
              An existing trailer the user typed is never duplicated. Terminal{' '}
              <code className="text-[9px] px-1 py-0.5 bg-lorica-bg border border-lorica-border rounded">git commit</code>{' '}
              is not intercepted.
            </p>
          </div>

          {/* Voice dictation — Web Speech API gated behind a toggle so the
              mic icon doesn't appear in the agent input until the user
              explicitly opts in. The platform speech engine handles audio
              (local on macOS / Edge on Windows). Hidden entirely when the
              browser doesn't expose SpeechRecognition (e.g. Linux). */}
          {voiceSupported && (
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
                <Mic size={14} className="text-lorica-accent" />
                Voice dictation in agent input
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const next = !voiceOn;
                    setVoiceOn(next);
                    setVoiceFeatureEnabled(next);
                    dispatch({
                      type: 'ADD_TOAST',
                      toast: {
                        type: 'info',
                        message: next
                          ? 'Voice dictation ON — mic icon appears in the agent input.'
                          : 'Voice dictation OFF.',
                        duration: 2500,
                      },
                    });
                  }}
                  className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${voiceOn ? 'bg-lorica-accent' : 'bg-lorica-border'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${voiceOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-xs text-lorica-textDim">
                  {voiceOn ? 'Mic button shown in the AI Copilot input' : 'Hidden'}
                </span>
              </div>
              <p className="text-[10px] text-lorica-textDim mt-1">
                Uses the browser&apos;s SpeechRecognition API. macOS and Edge route audio to the
                local OS speech engine; first use prompts for microphone permission.
              </p>
            </div>
          )}

          {/* Theme */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
              <Palette size={14} className="text-lorica-accent" />
              Theme
            </label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(THEMES).map(([key, theme]) => {
                const Icon = themeIcons[key] || Moon;
                return (
                  <button
                    key={key}
                    onClick={() => dispatch({ type: 'SET_THEME', theme: key })}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                      state.theme === key
                        ? 'border-lorica-accent bg-lorica-accent/10'
                        : 'border-lorica-border hover:border-lorica-accent/30'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded-full" style={{ background: theme.accent }} />
                      <div className="w-3 h-3 rounded-full" style={{ background: theme.bg }} />
                      <div className="w-3 h-3 rounded-full" style={{ background: theme.panel }} />
                    </div>
                    <span className="text-[10px] text-lorica-text">{theme.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Auto-Save — uses actions prop */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
              <Save size={14} className="text-lorica-accent" />
              Auto-Save
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (actions && actions.toggleAutoSave) {
                    actions.toggleAutoSave();
                  } else {
                    dispatch({ type: 'SET_AUTO_SAVE', value: !state.autoSave });
                  }
                }}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                  state.autoSave ? 'bg-lorica-accent' : 'bg-lorica-border'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  state.autoSave ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
              <span className="text-xs text-lorica-textDim">
                {state.autoSave ? 'Activé' : 'Désactivé'}
              </span>
            </div>
            {state.autoSave && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] text-lorica-textDim">Délai :</span>
                {[500, 1000, 2000, 5000].map((ms) => (
                  <button
                    key={ms}
                    onClick={() => dispatch({ type: 'SET_AUTO_SAVE_DELAY', delay: ms })}
                    className={`px-2 py-1 rounded text-[10px] transition-colors ${
                      state.autoSaveDelay === ms
                        ? 'bg-lorica-accent text-lorica-bg'
                        : 'bg-lorica-bg border border-lorica-border text-lorica-textDim hover:text-lorica-text'
                    }`}
                  >
                    {ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Minimap — uses actions prop */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
              <Map size={14} className="text-lorica-accent" />
              Minimap
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (actions && actions.toggleMinimap) {
                    actions.toggleMinimap();
                  } else {
                    dispatch({ type: 'SET_MINIMAP', value: !(state.showMinimap !== false) });
                  }
                }}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                  state.showMinimap !== false ? 'bg-lorica-accent' : 'bg-lorica-border'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  state.showMinimap !== false ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
              <span className="text-xs text-lorica-textDim">
                {state.showMinimap !== false ? 'Visible' : 'Masquée'}
              </span>
            </div>
          </div>

          {/* v2.2 features toggle matrix — every feature that has a
              global visibility / auto-run flag lives here so the user can
              tune Lorica from a single place. */}
          <div className="space-y-3 border-t border-lorica-border pt-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-lorica-text">
              <Sparkles size={14} className="text-lorica-accent" />
              Features
            </div>
            <FeatureToggleGrid state={state} dispatch={dispatch} />
          </div>

          {/* Auto-lock */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
              <Clock size={14} className="text-lorica-accent" />
              Auto-lock Timeout
            </label>
            <div className="flex items-center gap-2">
              {[0, 2, 5, 10, 30].map((min) => (
                <button
                  key={min}
                  onClick={() => dispatch({ type: 'SET_AUTO_LOCK', minutes: min })}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    state.autoLockMinutes === min
                      ? 'bg-lorica-accent text-lorica-bg'
                      : 'bg-lorica-bg border border-lorica-border text-lorica-textDim hover:text-lorica-text'
                  }`}
                >
                  {min === 0 ? 'Never' : `${min}m`}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Keyboard Shortcuts Management */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-lorica-text mb-2">
              <Keyboard size={14} className="text-lorica-accent" />
              Custom Keyboard Shortcuts
            </label>
            
            {capturing && (
              <div className="mb-3 p-3 bg-lorica-accent/5 border border-lorica-accent/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-lorica-accent animate-pulse" />
                    <span className="text-xs text-lorica-accent font-semibold">Press a key combination...</span>
                  </div>
                  <button
                    onClick={cancelEditing}
                    className="text-[10px] px-2 py-1 bg-lorica-bg border border-lorica-border rounded hover:bg-lorica-panel"
                  >
                    Cancel (Esc)
                  </button>
                </div>
                <p className="text-[10px] text-lorica-textDim mt-1">
                  Press any key combination (e.g., Ctrl+Shift+P). Press Escape to cancel.
                </p>
              </div>
            )}

            {conflicts.length > 0 && (
              <div className="mb-3 p-3 bg-lorica-warning/10 border border-lorica-warning/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={12} className="text-lorica-warning flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-lorica-warning">Shortcut Conflicts Detected</span>
                    <p className="text-[10px] text-lorica-textDim mt-0.5">
                      {conflicts.map((c, idx) => (
                        <span key={idx} className="block">
                          "{c.description1}" and "{c.description2}" both use {c.shortcut}
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-lorica-bg rounded-lg border border-lorica-border overflow-hidden">
              <div className="max-h-48 overflow-y-auto">
                {shortcutsLoaded && Object.entries(getAllShortcuts(customShortcuts)).map(([actionId, shortcut]) => (
                  <div key={actionId} className="flex items-center justify-between px-3 py-2 border-b border-lorica-border last:border-b-0 hover:bg-lorica-panel/30">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-lorica-textDim">{shortcut.description}</div>
                      <div className="text-[9px] text-lorica-textDim/60 mt-0.5">
                        Action: {shortcut.action}
                        {shortcut.custom && <span className="ml-2 px-1 py-0.5 bg-lorica-accent/20 text-lorica-accent rounded text-[8px]">CUSTOM</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 bg-lorica-panel border border-lorica-border rounded text-lorica-accent font-mono text-[9px] min-w-[60px] text-center">
                        {editingAction === actionId ? (
                          <span className="text-lorica-accent animate-pulse">...</span>
                        ) : (
                          shortcut.key
                        )}
                      </kbd>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditing(actionId)}
                          className="p-1 text-lorica-textDim hover:text-lorica-accent transition-colors"
                          title="Edit shortcut"
                          disabled={capturing}
                        >
                          <Edit size={10} />
                        </button>
                        {shortcut.custom && (
                          <button
                            onClick={() => resetShortcut(actionId)}
                            className="p-1 text-lorica-textDim hover:text-lorica-warning transition-colors"
                            title="Reset to default"
                            disabled={capturing}
                          >
                            <XCircle size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="px-3 py-2 border-t border-lorica-border bg-lorica-panel/50 flex justify-between">
                <div className="text-[10px] text-lorica-textDim">
                  {Object.keys(customShortcuts).length} custom shortcut(s)
                </div>
                <button
                  onClick={resetAllShortcuts}
                  className="text-[10px] px-2 py-1 bg-lorica-bg border border-lorica-border rounded hover:bg-lorica-panel hover:text-lorica-warning transition-colors"
                  disabled={Object.keys(customShortcuts).length === 0}
                >
                  Reset All
                </button>
              </div>
            </div>

            <div className="mt-2 text-[10px] text-lorica-textDim">
              <p>• Click the edit icon to change a shortcut</p>
              <p>• Custom shortcuts are saved automatically</p>
              <p>• Conflicts are highlighted in orange</p>
            </div>
          </div>

          {/* About — version, release notes shortcut, credits. Sits at
              the bottom so it doesn't compete with the configurable
              sections above. */}
          <div className="space-y-3 border-t border-lorica-border pt-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-lorica-text">
              <Info size={14} className="text-lorica-accent" />
              About
            </div>
            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-[11px]">
              <span className="text-lorica-textDim">Version</span>
              <span className="text-lorica-text font-mono">v{APP_VERSION}</span>
              <span className="text-lorica-textDim">Stack</span>
              <span className="text-lorica-text">Tauri 2 · React 18 · CodeMirror 6 · xterm.js</span>
              <span className="text-lorica-textDim">Storage</span>
              <span className="text-lorica-text">All data local — no telemetry</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { dispatch({ type: 'SET_PANEL', panel: 'showReleaseNotes', value: true }); close(); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-lorica-accent/40 bg-lorica-accent/10 text-[11px] text-lorica-accent hover:bg-lorica-accent/20"
              >
                <Rocket size={11} /> What's new in v{APP_VERSION}
              </button>
              <button
                onClick={() => { dispatch({ type: 'SET_PANEL', panel: 'showKeyboardCheatsheet', value: true }); close(); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-lorica-border text-[11px] text-lorica-textDim hover:text-lorica-text"
              >
                <Keyboard size={11} /> Keyboard shortcuts
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-lorica-border text-center">
          <span className="text-[10px] text-lorica-textDim">Lorica v{APP_VERSION} — Secure · AI-Powered · Native</span>
        </div>
      </div>
    </div>
  );
}

// ── Feature toggle grid ──────────────────────────────────────────────
// Full feature catalog toggle — drives the soft extension system.
// Disabled features disappear from the Omnibar and stop responding to
// their keyboard shortcuts. Grouped by category so the user can see
// the shape of what Lorica offers at a glance.
function FeatureToggleGrid({ state, dispatch }) {
  const enabled = state.enabledFeatures || {};
  const stats = featureStats(enabled);

  const toggle = (id) => {
    dispatch({
      type: 'SET_FEATURE_ENABLED',
      featureId: id,
      enabled: !enabled[id],
    });
  };

  // Group features by category, then by the category-order declared in
  // FEATURE_CATEGORIES (keeps Productivity above Diagnostics above the
  // niche ones).
  const grouped = Object.values(FEATURES).reduce((acc, f) => {
    (acc[f.category] ||= []).push(f);
    return acc;
  }, {});
  const orderedCats = Object.entries(FEATURE_CATEGORIES)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id, meta]) => [id, meta]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-lorica-textDim">
        <span>{stats.on} of {stats.total} features enabled · commands for disabled features disappear from the Omnibar.</span>
        <button
          onClick={() => dispatch({ type: 'RESET_FEATURES' })}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-lorica-border/40 hover:text-lorica-text"
          title="Reset to recommended defaults"
        >
          <RotateCcw size={10} /> Reset
        </button>
      </div>

      {orderedCats.map(([catId, catMeta]) => {
        const items = grouped[catId] || [];
        if (!items.length) return null;
        return (
          <div key={catId}>
            <div className="text-[9px] uppercase tracking-widest text-lorica-textDim font-semibold mb-1">
              {catMeta.label}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {items.map((f) => {
                const on = !!enabled[f.id];
                return (
                  <button
                    key={f.id}
                    onClick={() => toggle(f.id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded border border-lorica-border hover:border-lorica-accent/40 transition-colors text-left"
                    title={f.desc}
                  >
                    <span className={`relative inline-block w-7 h-3.5 rounded-full transition-colors flex-shrink-0 ${
                      on ? 'bg-lorica-accent' : 'bg-lorica-border'
                    }`}>
                      <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
                        on ? 'translate-x-3.5' : 'translate-x-0.5'
                      }`} />
                    </span>
                    <span className="text-[11px] text-lorica-text truncate">{f.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

