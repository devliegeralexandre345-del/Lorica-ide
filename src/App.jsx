import React, { useReducer, useEffect, useCallback, useRef, useMemo } from 'react';
import { appReducer, initialState } from './store/appReducer';
import { THEMES } from './utils/themes';
import { useFileSystem } from './hooks/useFileSystem';
import { useAI } from './hooks/useAI';
import { useSecurity } from './hooks/useSecurity';
import { useSpotify } from './hooks/useSpotify';
import { useUpdate } from './hooks/useUpdate';
import { useShortcuts } from './hooks/useShortcuts';
import MenuBar from './components/MenuBar';
import FileTree from './components/FileTree';
import TabBar from './components/TabBar';
import Editor from './components/Editor';
import Terminal from './components/Terminal';
import AgentCopilot from './components/AgentCopilot';
import { useAgent } from './hooks/useAgent';
import SpotifyPlayer from './components/SpotifyPlayer';
import CommandPalette from './components/CommandPalette';
import StatusBar from './components/StatusBar';
import LockScreen from './components/LockScreen';
import SecretVault from './components/SecretVault';
import AuditLog from './components/AuditLog';
import DiffViewer from './components/DiffViewer';
import Settings from './components/Settings';
import ToastContainer from './components/Toast';
import Breadcrumbs from './components/Breadcrumbs';
import WelcomeTab from './components/WelcomeTab';
import GlobalSearch from './components/GlobalSearch';
import GitPanel from './components/GitPanel';
import FilePalette from './components/FilePalette';
import LoricaDock from './components/LoricaDock';
import ImagePreview, { isImageFile } from './components/ImagePreview';
import FilePreview, { hasPreview } from './components/FilePreview';
import ExtensionManager from './components/ExtensionManager';
import DebugPanel from './components/DebugPanel';
import ProblemsPanel from './components/ProblemsPanel';
import SnippetPalette from './components/SnippetPalette';
import OutlinePanel from './components/OutlinePanel';
import TimelinePanel from './components/TimelinePanel';

// Helper to add toast
function toast(dispatch, type, message, duration = 2000) {
  dispatch({ type: 'ADD_TOAST', toast: { type, message, duration } });
}

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const fs = useFileSystem(dispatch);
  const ai = useAI(state, dispatch);
  const agent = useAgent(state, dispatch);
  const security = useSecurity(state, dispatch);
  const spotify = useSpotify();
  const update = useUpdate(dispatch);
  const [sidebarWidth, setSidebarWidth] = React.useState(260);
  const [aiPanelWidth, setAiPanelWidth] = React.useState(340);
  const [terminalHeight, setTerminalHeight] = React.useState(200);
  const [splitRatio, setSplitRatio] = React.useState(0.5);

  // Refs for timers and stale closure avoidance
  const stateRef = useRef(state);
  const fsRef = useRef(fs);
  const autoSaveTimerRef = useRef(null);
  const zenKeyRef = useRef(false);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { fsRef.current = fs; }, [fs]);

  // Apply theme CSS variables whenever the theme changes
  useEffect(() => {
    const t = THEMES[state.theme] || THEMES.midnight;
    const root = document.documentElement;
    root.style.setProperty('--color-bg',        t.bg);
    root.style.setProperty('--color-surface',   t.surface);
    root.style.setProperty('--color-panel',      t.panel);
    root.style.setProperty('--color-border',     t.border);
    root.style.setProperty('--color-accent',     t.accent);
    root.style.setProperty('--color-accentDim',  t.accentDim  || t.accent + 'cc');
    root.style.setProperty('--color-danger',     t.danger  || '#ef4444');
    root.style.setProperty('--color-warning',    t.warning || '#f59e0b');
    root.style.setProperty('--color-success',    t.success || '#22c55e');
    root.style.setProperty('--color-text',       t.text);
    root.style.setProperty('--color-textDim',    t.textDim);
  }, [state.theme]);

  // =============================================
  // ACTIONS (used by shortcuts AND command palette)
  // =============================================
  const actions = useRef({});
  actions.current = {
    toggleZen: () => {
      const s = stateRef.current;
      if (s.zenMode) {
        dispatch({ type: 'EXIT_ZEN' });
        toast(dispatch, 'info', 'Zen Mode désactivé', 1500);
      } else {
        dispatch({ type: 'ENTER_ZEN' });
        toast(dispatch, 'info', 'Zen Mode — Escape pour quitter', 2500);
      }
    },
    toggleSplit: () => {
      const s = stateRef.current;
      if (s.splitMode) {
        dispatch({ type: 'SET_SPLIT', mode: false, fileIndex: -1 });
        toast(dispatch, 'info', 'Split fermé', 1500);
      } else if (s.openFiles.length >= 2) {
        const splitIdx = s.activeFileIndex === 0 ? 1 : 0;
        dispatch({ type: 'SET_SPLIT', mode: 'vertical', fileIndex: splitIdx });
        toast(dispatch, 'info', 'Split Editor activé', 1500);
      } else {
        toast(dispatch, 'warning', 'Ouvrez au moins 2 fichiers pour le split', 2500);
      }
    },
    toggleMinimap: () => {
      const s = stateRef.current;
      dispatch({ type: 'SET_MINIMAP', value: !s.showMinimap });
      toast(dispatch, 'info', s.showMinimap ? 'Minimap masquée' : 'Minimap visible', 1500);
    },
    toggleAutoSave: () => {
      const s = stateRef.current;
      dispatch({ type: 'SET_AUTO_SAVE', value: !s.autoSave });
      toast(dispatch, 'info', s.autoSave ? 'Auto-save désactivé' : 'Auto-save activé', 2000);
    },
    saveActive: () => {
      const s = stateRef.current;
      const file = s.openFiles[s.activeFileIndex];
      if (file) {
        fsRef.current.saveFile(file, s.activeFileIndex);
        toast(dispatch, 'success', `${file.name} sauvegardé`, 2000);
      }
    },
  };

  // =============================================
  // Dynamic keyboard shortcuts with custom overrides
  // =============================================
  useShortcuts(state, dispatch, actions.current, security);

  // =============================================
  // Auto-save (debounced)
  // =============================================
  useEffect(() => {
    if (!state.autoSave) {
      if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
      return;
    }
    const hasDirty = state.openFiles.some((f) => f.dirty);
    if (!hasDirty) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const s = stateRef.current;
      const currentFs = fsRef.current;
      let count = 0;
      s.openFiles.forEach((file, idx) => {
        if (file.dirty) { currentFs.saveFile(file, idx); count++; }
      });
      if (count > 0) dispatch({ type: 'SET_STATUS', message: `Auto-saved ${count} file${count > 1 ? 's' : ''}` });
      autoSaveTimerRef.current = null;
    }, state.autoSaveDelay);

    return () => { if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; } };
  }, [state.autoSave, state.autoSaveDelay, state.openFiles]);

  // =============================================
  // Resize handlers (use refs to avoid dependency changes)
  // =============================================
  const sidebarWidthRef = useRef(sidebarWidth);
  const aiPanelWidthRef = useRef(aiPanelWidth);
  const terminalHeightRef = useRef(terminalHeight);

  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);
  useEffect(() => { aiPanelWidthRef.current = aiPanelWidth; }, [aiPanelWidth]);
  useEffect(() => { terminalHeightRef.current = terminalHeight; }, [terminalHeight]);

  const handleSidebarResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX; const startW = sidebarWidthRef.current;
    const onMove = (ev) => setSidebarWidth(Math.max(180, Math.min(500, startW + ev.clientX - startX)));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }, []);

  const handleAIResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX; const startW = aiPanelWidthRef.current;
    const onMove = (ev) => setAiPanelWidth(Math.max(280, Math.min(600, startW - (ev.clientX - startX))));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }, []);

  const handleTerminalResize = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY; const startH = terminalHeightRef.current;
    const onMove = (ev) => setTerminalHeight(Math.max(100, Math.min(500, startH - (ev.clientY - startY))));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }, []);

  const handleSplitResize = useCallback((e) => {
    e.preventDefault();
    const container = e.target.parentElement; const rect = container.getBoundingClientRect();
    const onMove = (ev) => setSplitRatio(Math.max(0.2, Math.min(0.8, (ev.clientX - rect.left) / rect.width)));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }, []);

  // =============================================
  // Derived
  // =============================================
  const activeFile = state.openFiles[state.activeFileIndex] || null;
  const splitFile = (state.splitMode && state.splitFileIndex >= 0) ? (state.openFiles[state.splitFileIndex] || null) : null;
  const isZen = state.zenMode;

  if (state.isLocked) {
    return <LockScreen onUnlock={security.unlock} onInit={security.initVault} vaultInitialized={state.vaultInitialized} />;
  }

  return (
    <div className={`flex flex-col h-screen w-screen bg-lorica-bg select-none ${isZen ? 'zen-mode' : ''}`}>
      {!isZen && (
        <MenuBar
          state={state} dispatch={dispatch}
          onOpenFolder={fs.openFolder}
          onSave={actions.current.saveActive}
          onLock={security.lock}
          spotify={spotify}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Lorica Dock — floating nav rail */}
        {!isZen && <LoricaDock state={state} dispatch={dispatch} />}

        {/* Left Sidebar — switchable: FileTree / Search / Git / Debug / Outline / Timeline */}
        {!isZen && (state.showFileTree || state.showSearch || state.showGit || state.showDebug || state.showOutline || state.showTimeline) && (
          <>
            <div style={{ width: sidebarWidth }} className="flex-shrink-0 border-r border-lorica-border bg-lorica-surface overflow-hidden">
              {state.showSearch ? (
                <GlobalSearch state={state} dispatch={dispatch} onFileOpen={fs.openFile} />
              ) : state.showGit ? (
                <GitPanel state={state} dispatch={dispatch} />
              ) : state.showDebug ? (
                <DebugPanel state={state} dispatch={dispatch} activeFile={activeFile} />
              ) : state.showOutline ? (
                <OutlinePanel state={state} dispatch={dispatch} activeFile={activeFile} />
              ) : state.showTimeline ? (
                <TimelinePanel state={state} dispatch={dispatch} />
              ) : (
                <FileTree tree={state.fileTree} projectPath={state.projectPath} onFileClick={fs.openFile} onRefresh={() => fs.refreshTree(state.projectPath)} dispatch={dispatch} fs={fs} />
              )}
            </div>
            <div className="w-1 cursor-col-resize resize-handle bg-lorica-border hover:bg-lorica-accent flex-shrink-0" onMouseDown={handleSidebarResize} />
          </>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {!isZen && (
            <TabBar files={state.openFiles} activeIndex={state.activeFileIndex}
              onSelect={(i) => dispatch({ type: 'SET_ACTIVE_FILE', index: i })}
              onClose={(i) => dispatch({ type: 'CLOSE_FILE', index: i })}
              dispatch={dispatch}
            />
          )}

          {!isZen && activeFile && (
            <Breadcrumbs file={activeFile} projectPath={state.projectPath} />
          )}

          <div className="flex-1 overflow-hidden flex">
            {activeFile ? (
              <>
                <div style={{ width: splitFile ? `${splitRatio * 100}%` : '100%' }} className="h-full overflow-hidden">
                  {isImageFile(activeFile.extension) ? (
                    <ImagePreview file={activeFile} />
                  ) : hasPreview(activeFile.extension) ? (
                    <FilePreview
                      file={activeFile}
                      editorProps={{
                        index: state.activeFileIndex,
                        dispatch,
                        theme: state.theme,
                        showMinimap: state.showMinimap !== false,
                        aiInlineEnabled: state.aiInlineEnabled,
                        aiProvider: state.aiProvider,
                        aiApiKey: state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey,
                      }}
                    />
                  ) : (
                    <Editor
                      file={activeFile}
                      index={state.activeFileIndex}
                      dispatch={dispatch}
                      theme={state.theme}
                      showMinimap={state.showMinimap !== false}
                      aiInlineEnabled={state.aiInlineEnabled}
                      aiProvider={state.aiProvider}
                      aiApiKey={state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey}
                    />
                  )}
                </div>
                {splitFile && (
                  <>
                    <div className="w-1.5 cursor-col-resize bg-lorica-border hover:bg-lorica-accent flex-shrink-0 transition-colors" onMouseDown={handleSplitResize} />
                    <div style={{ width: `${(1 - splitRatio) * 100}%` }} className="h-full overflow-hidden">
                      {isImageFile(splitFile.extension) ? (
                        <ImagePreview file={splitFile} />
                      ) : hasPreview(splitFile.extension) ? (
                        <FilePreview
                          file={splitFile}
                          editorProps={{
                            index: state.splitFileIndex,
                            dispatch,
                            theme: state.theme,
                            showMinimap: false,
                            aiInlineEnabled: state.aiInlineEnabled,
                            aiProvider: state.aiProvider,
                            aiApiKey: state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey,
                          }}
                        />
                      ) : (
                        <Editor
                          file={splitFile}
                          index={state.splitFileIndex}
                          dispatch={dispatch}
                          theme={state.theme}
                          showMinimap={false}
                          aiInlineEnabled={state.aiInlineEnabled}
                          aiProvider={state.aiProvider}
                          aiApiKey={state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey}
                        />
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <WelcomeTab dispatch={dispatch} onOpenFolder={fs.openFolder} />
            )}
          </div>

          {/* Problems Panel */}
          {!isZen && state.showProblems && (
            <div className="flex-shrink-0 h-[150px] border-t border-lorica-border">
              <ProblemsPanel state={state} dispatch={dispatch} onFileOpen={fs.openFile} />
            </div>
          )}

          {!isZen && state.showTerminal && (
            <>
              <div className="h-1 cursor-row-resize resize-handle bg-lorica-border hover:bg-lorica-accent flex-shrink-0" onMouseDown={handleTerminalResize} />
              <div style={{ height: terminalHeight }} className="flex-shrink-0 border-t border-lorica-border">
                <Terminal />
              </div>
            </>
          )}
        </div>

        {!isZen && state.showAIPanel && (
          <>
            <div className="w-1 cursor-col-resize resize-handle bg-lorica-border hover:bg-lorica-accent flex-shrink-0" onMouseDown={handleAIResize} />
            <div style={{ width: aiPanelWidth }} className="flex-shrink-0 border-l border-lorica-border bg-lorica-surface overflow-hidden flex flex-col">
              <AgentCopilot state={state} dispatch={dispatch} agent={agent} activeFile={activeFile} />
              {state.showSpotify && (
                <div className="border-t border-lorica-border flex-shrink-0"><SpotifyPlayer spotify={spotify} /></div>
              )}
            </div>
          </>
        )}
      </div>

      {!isZen ? (
        <StatusBar
          state={state}
          activeFile={activeFile}
          dispatch={dispatch}
          currentVersion={update.currentVersion}
          updateInfo={{
            available: update.updateAvailable,
            latestVersion: update.latestVersion,
            isInstalling: update.isInstalling,
            onInstall: update.installUpdate,
          }}
        />
      ) : (
        <div className="h-6 flex items-center justify-center text-[10px] text-lorica-textDim/30 bg-lorica-bg cursor-pointer hover:text-lorica-textDim/60 transition-colors"
          onClick={actions.current.toggleZen}>
          ZEN MODE — Press Escape to exit
        </div>
      )}

      <ToastContainer toasts={state.toasts || []} dispatch={dispatch} />

      {state.showCommandPalette && (
        <CommandPalette state={state} dispatch={dispatch} onOpenFolder={fs.openFolder} onLock={security.lock} actions={actions.current} />
      )}
      {state.showSettings && <Settings state={state} dispatch={dispatch} actions={actions.current} />}
      {state.showSecretVault && <SecretVault state={state} dispatch={dispatch} security={security} />}
      {state.showAuditLog && <AuditLog dispatch={dispatch} />}
      {state.showDiffViewer && <DiffViewer state={state} dispatch={dispatch} />}
      {state.showFilePalette && <FilePalette state={state} dispatch={dispatch} onFileOpen={fs.openFile} />}
      {state.showExtensions && <ExtensionManager dispatch={dispatch} />}
      {state.showSnippets && <SnippetPalette activeFile={activeFile} dispatch={dispatch} />}
    </div>
  );
}
