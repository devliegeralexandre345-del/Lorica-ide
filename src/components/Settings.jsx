import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, X, Key, Moon, Palette, Sun, Clock, Shield, Save, Map, Brain, Keyboard, Edit, AlertTriangle, Check, XCircle, Sparkles } from 'lucide-react';
import { THEMES } from '../utils/themes';
import { DEFAULT_SHORTCUTS, getAllShortcuts, loadCustomShortcuts, saveCustomShortcuts, isValidShortcut, findConflicts, eventToShortcut } from '../utils/keymap';

export default function Settings({ state, dispatch, actions }) {
  const [apiKey, setApiKey] = useState(state.aiApiKey);
  const [deepseekKey, setDeepseekKey] = useState(state.aiDeepseekKey);
  const [saved, setSaved] = useState(false);
  const [deepseekSaved, setDeepseekSaved] = useState(false);

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

  const saveApiKey = () => {
    dispatch({ type: 'SET_AI_KEY', key: apiKey });
    setSaved(true);
    if (actions) actions.saveActive && dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'API Key sauvegardée' } });
    setTimeout(() => setSaved(false), 2000);
  };

  const saveDeepseekKey = () => {
    dispatch({ type: 'SET_DEEPSEEK_KEY', key: deepseekKey });
    setDeepseekSaved(true);
    if (actions) actions.saveActive && dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'DeepSeek API Key sauvegardée' } });
    setTimeout(() => setDeepseekSaved(false), 2000);
  };

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
            </div>

            {/* Conditionally show API key input based on provider */}
            {state.aiProvider === 'anthropic' ? (
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
        </div>

        <div className="px-5 py-3 border-t border-lorica-border text-center">
          <span className="text-[10px] text-lorica-textDim">Lorica v2.0.0 — Built with ⚡ by AI</span>
        </div>
      </div>
    </div>
  );
}

