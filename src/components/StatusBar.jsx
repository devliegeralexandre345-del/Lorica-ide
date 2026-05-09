import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Shield, ShieldAlert, Bot, Music, Maximize, Save, Map, GitBranch, Search, Download, Wifi, WifiOff, Box } from 'lucide-react';
import { getLanguageName } from '../utils/languages';
import { APP_VERSION } from '../version';

// FocusTimer is opt-in (state.showFocusTimer, default false) — lazy so the
// pomodoro logic, lucide glyphs, and localStorage log helpers stay out of
// the initial bundle. The chip that renders it lives inside the status
// bar, which IS eager; so the lazy boundary lives here, not in App.jsx.
const FocusTimer = lazy(() => import(/* webpackChunkName: "focus-timer" */ './FocusTimer'));

// Hook: subscribes to browser online/offline events so the status-bar
// chip can pulse red when network is down. Agent calls will fail in that
// state, so surfacing it is a UX win.
function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export default function StatusBar({ state, activeFile, dispatch, updateInfo, currentVersion, devContainer }) {
  const hasAlerts = state.securityAlerts.length > 0;
  const online = useOnlineStatus();
  const [gitBranch, setGitBranch] = useState('');

  // Fetch git branch on project change
  useEffect(() => {
    if (!state.projectPath) { setGitBranch(''); return; }
    (async () => {
      try {
        const res = await window.lorica.git.status(state.projectPath);
        const data = res?.data || res;
        if (data?.is_repo) setGitBranch(data.branch || '');
        else setGitBranch('');
      } catch { setGitBranch(''); }
    })();
  }, [state.projectPath]);

  return (
    <div className="lorica-statusbar flex items-center justify-between h-7 px-3 bg-lorica-surface border-t border-lorica-border text-[10px] select-none">
      <div className="flex items-center gap-3">
        <button
          onClick={() => dispatch({ type: 'TOGGLE_PANEL', panel: 'showSecretVault' })}
          className={`flex items-center gap-1 transition-colors ${
            hasAlerts ? 'text-lorica-danger animate-pulse-glow' : 'text-lorica-success'
          } hover:opacity-80`}
        >
          {hasAlerts ? <ShieldAlert size={11} /> : <Shield size={11} />}
          {hasAlerts ? `${state.securityAlerts.length} alerts` : 'Secure'}
        </button>

        <span className={`${state.vaultUnlocked ? 'text-lorica-success' : 'text-lorica-textDim'}`}>
          🔐 Vault {state.vaultUnlocked ? 'Unlocked' : 'Locked'}
        </span>

        {state.zenMode && (
          <span className="flex items-center gap-1 text-lorica-accent animate-pulse">
            <Maximize size={10} /> ZEN
          </span>
        )}

        <span className="text-lorica-textDim">{state.statusMessage}</span>

        {/* Wave 36 — left-side extension chip slot. Sits next to the
            secure / vault / status-message cluster so extensions can
            place chips alongside the always-visible system widgets
            instead of being lumped with git/search on the right. */}
        <div id="lorica-ext-statusbar-host-left" className="flex items-center gap-2" />
      </div>

      {/* CENTER: Version & Update button */}
      <div className="flex-1 flex items-center justify-center">
        {updateInfo?.available ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/30">Lorica v{currentVersion}</span>
            <button
              onClick={updateInfo.onInstall}
              disabled={updateInfo.isInstalling}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 border border-blue-500/30 transition-colors"
            >
              <Download size={10} />
              {updateInfo.isInstalling ? 'Installation...' : `Mise à jour v${updateInfo.latestVersion}`}
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-white/30">Lorica v{currentVersion || APP_VERSION}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Extension chip slot — Wave 23. Each loaded extension that
            uses ui.statusBar permission appends its chip into this
            host node via extensionHost.mountStatusBarChip(). The DOM
            children are managed entirely by extensions; React just
            owns the host shell. */}
        <div id="lorica-ext-statusbar-host" className="flex items-center gap-2" />

        {/* Focus/Pomodoro timer — opt-in via state.showFocusTimer */}
        {state.showFocusTimer && (
          <Suspense fallback={null}>
            <FocusTimer state={state} dispatch={dispatch} />
          </Suspense>
        )}

        {/* Network status — only shown when offline (silent when online
            to avoid visual noise). Agent calls will fail in this state. */}
        {!online && (
          <span className="flex items-center gap-1 text-red-400 animate-pulse" title="Offline — AI calls unavailable">
            <WifiOff size={10} /> offline
          </span>
        )}

        {/* Git branch */}
        {gitBranch && (
          <button
            onClick={() => { dispatch({ type: 'SET_PANEL', panel: 'showGit', value: true }); dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: false }); }}
            className="flex items-center gap-1 text-lorica-textDim hover:text-lorica-accent transition-colors"
          >
            <GitBranch size={10} /> {gitBranch}
          </button>
        )}

        {/* Dev container — surfaces .devcontainer/devcontainer.json with a
            one-click "open shell" via docker. Read-only first pass; build
            and compose flows show a tooltip explaining v1 limits. */}
        {devContainer?.info && (
          <button
            onClick={devContainer.openShell}
            title={
              devContainer.info.image
                ? `Open shell in ${devContainer.info.image}`
                : devContainer.info.composeFile
                ? 'Compose-based devcontainer (run manually for now)'
                : devContainer.info.hasBuild
                ? 'Build-based devcontainer (Lorica v2.3 doesn’t run builds yet)'
                : 'Devcontainer config detected — no image declared'
            }
            className="flex items-center gap-1 text-lorica-textDim hover:text-lorica-accent transition-colors"
          >
            <Box size={10} />
            <span className="truncate max-w-[120px]">{devContainer.info.name || devContainer.info.image || 'devcontainer'}</span>
          </button>
        )}

        {/* Search */}
        <button
          onClick={() => { dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: true }); dispatch({ type: 'SET_PANEL', panel: 'showGit', value: false }); }}
          className={`flex items-center gap-1 transition-colors hover:text-lorica-accent ${state.showSearch ? 'text-lorica-accent' : 'text-lorica-textDim'}`}
          title="Search in files (Ctrl+Shift+F)"
        >
          <Search size={10} />
        </button>

        {state.autoSave && (
          <span className="flex items-center gap-1 text-lorica-success" title="Auto-save is enabled">
            <Save size={10} /> Auto
          </span>
        )}

        <button
          onClick={() => dispatch({ type: 'SET_MINIMAP', value: !(state.showMinimap !== false) })}
          className={`flex items-center gap-1 transition-colors hover:text-lorica-accent ${
            state.showMinimap !== false ? 'text-lorica-accent' : 'text-lorica-textDim'
          }`}
          title={state.showMinimap !== false ? 'Hide minimap' : 'Show minimap'}
        >
          <Map size={10} />
        </button>

        <button
          onClick={() => dispatch({ type: 'TOGGLE_PANEL', panel: 'showAIPanel' })}
          className={`flex items-center gap-1 transition-colors hover:text-lorica-accent ${
            state.showAIPanel ? 'text-lorica-accent' : 'text-lorica-textDim'
          }`}
          title={state.aiApiKey ? 'AI Copilot (key configured)' : 'AI Copilot (no key — open Settings)'}
        >
          <Bot size={11} /> AI {state.aiApiKey ? '✓' : '✗'}
        </button>

        <button
          onClick={() => {
            dispatch({ type: 'TOGGLE_PANEL', panel: 'showSpotify' });
            if (!state.showAIPanel) dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
          }}
          className={`flex items-center gap-1 transition-colors ${state.showSpotify ? 'text-lorica-spotify' : 'text-lorica-textDim'} hover:text-lorica-spotify`}
          title="Toggle Spotify player"
        >
          <Music size={11} /> ♫
        </button>

        {state.splitMode && <span className="text-lorica-accent">Split</span>}

        {activeFile && (
          <>
            <span className="text-lorica-accent">{getLanguageName(activeFile.extension)}</span>
            <span className="text-lorica-textDim">UTF-8</span>
          </>
        )}

        <span className="text-lorica-textDim capitalize">{state.theme}</span>
      </div>
    </div>
  );
}
