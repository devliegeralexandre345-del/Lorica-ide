import React, { useReducer, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { appReducer, initialState } from './store/appReducer';
import { THEMES } from './utils/themes';
import { useFileSystem } from './hooks/useFileSystem';
import { useAI } from './hooks/useAI';
import { useSecurity } from './hooks/useSecurity';
import { useSpotify } from './hooks/useSpotify';
import { useUpdate } from './hooks/useUpdate';
import { useShortcuts } from './hooks/useShortcuts';
import { useSemanticAutoReindex } from './hooks/useSemanticAutoReindex';
import { useSession } from './hooks/useSession';
import { useClipboardHistory } from './hooks/useClipboardHistory';
import { useHeatmap } from './hooks/useHeatmap';
import { useCustomAgents } from './hooks/useCustomAgents';
import { useAgentTriggers } from './hooks/useAgentTriggers';
import { useProjectBrain } from './hooks/useProjectBrain';
import { useReleaseNotes } from './hooks/useReleaseNotes';
import { useAgentSessionPersistence } from './hooks/useAgentSessionPersistence';
import { useGlobalErrorHandler } from './hooks/useGlobalErrorHandler';
import { useTimeScrub } from './hooks/useTimeScrub';
import { useSemanticAuto } from './hooks/useSemanticAuto';
import { loadIdentity } from './utils/agentIdentity';
import { loadSemanticStore } from './utils/semanticTypes';

// -------------------------------------------------------------------
// Eager imports — rendered on first paint (or so close to it that code
// splitting would just introduce a visible flash).
// -------------------------------------------------------------------
import MenuBar from './components/MenuBar';
import FileTree from './components/FileTree';
import TabBar from './components/TabBar';
import Editor from './components/Editor';
import Terminal from './components/Terminal';
import AgentCopilot from './components/AgentCopilot';
import { useAgent } from './hooks/useAgent';
import StatusBar from './components/StatusBar';
import LockScreen from './components/LockScreen';
import ToastContainer from './components/Toast';
import Breadcrumbs from './components/Breadcrumbs';
import WelcomeTab from './components/WelcomeTab';
import LoricaDock from './components/LoricaDock';
import ImagePreview, { isImageFile } from './components/ImagePreview';
import FilePreview, { hasPreview } from './components/FilePreview';
import PerformanceHUD from './components/PerformanceHUD';
import AmbientHUD from './components/AmbientHUD';

// -------------------------------------------------------------------
// Lazy-loaded — only fetched when the user actually opens them. Each
// gets its own chunk; main.bundle shrinks by whatever they pull in.
// Webpack names the chunk from the magic comment.
// -------------------------------------------------------------------
const CommandPalette    = lazy(() => import(/* webpackChunkName: "cmd-palette" */ './components/CommandPalette'));
const Omnibar           = lazy(() => import(/* webpackChunkName: "omnibar"     */ './components/Omnibar'));
const AgentSwarmPanel   = lazy(() => import(/* webpackChunkName: "swarm"       */ './components/AgentSwarmPanel'));
const CodeCanvas        = lazy(() => import(/* webpackChunkName: "canvas"      */ './components/CodeCanvas'));
const NextEditPanel     = lazy(() => import(/* webpackChunkName: "next-edit"   */ './components/NextEditPanel'));
const InstantPreview    = lazy(() => import(/* webpackChunkName: "preview"     */ './components/InstantPreview'));
const BookmarksPanel    = lazy(() => import(/* webpackChunkName: "bookmarks"   */ './components/BookmarksPanel'));
const Scratchpad        = lazy(() => import(/* webpackChunkName: "scratchpad"  */ './components/Scratchpad'));
const TodoBoard         = lazy(() => import(/* webpackChunkName: "todo"        */ './components/TodoBoard'));
const ClipboardHistory  = lazy(() => import(/* webpackChunkName: "clipboard"   */ './components/ClipboardHistory'));
const ApiTester         = lazy(() => import(/* webpackChunkName: "api-tester"  */ './components/ApiTester'));
const RegexBuilder      = lazy(() => import(/* webpackChunkName: "regex"       */ './components/RegexBuilder'));
const AgentBuilder      = lazy(() => import(/* webpackChunkName: "agent-builder" */ './components/AgentBuilder'));
const PrReadyModal      = lazy(() => import(/* webpackChunkName: "pr-ready"    */ './components/PrReadyModal'));
const ProjectBrainPanel = lazy(() => import(/* webpackChunkName: "brain"       */ './components/ProjectBrainPanel'));
const AutoFixModal      = lazy(() => import(/* webpackChunkName: "auto-fix"    */ './components/AutoFixModal'));
const AgentIdentityModal = lazy(() => import(/* webpackChunkName: "identity"   */ './components/AgentIdentityModal'));
const SandboxPanel      = lazy(() => import(/* webpackChunkName: "sandbox"     */ './components/SandboxPanel'));
const SwarmPanel        = lazy(() => import(/* webpackChunkName: "swarm-dev"   */ './components/SwarmPanel'));
const SemanticTypesPanel = lazy(() => import(/* webpackChunkName: "sem-types"  */ './components/SemanticTypesPanel'));
const KeyboardCheatsheet = lazy(() => import(/* webpackChunkName: "cheatsheet" */ './components/KeyboardCheatsheet'));
const ReleaseNotes      = lazy(() => import(/* webpackChunkName: "release"    */ './components/ReleaseNotes'));
const InlineEditHistory = lazy(() => import(/* webpackChunkName: "edit-hist"  */ './components/InlineEditHistory'));
const LayoutSwitcher    = lazy(() => import(/* webpackChunkName: "layouts"    */ './components/LayoutSwitcher'));
import ErrorBoundary from './components/ErrorBoundary';
import TimeScrubBar from './components/TimeScrubBar';
import FocusTimer from './components/FocusTimer';
const Settings          = lazy(() => import(/* webpackChunkName: "settings"    */ './components/Settings'));
const SecretVault       = lazy(() => import(/* webpackChunkName: "vault"       */ './components/SecretVault'));
const AuditLog          = lazy(() => import(/* webpackChunkName: "audit-log"   */ './components/AuditLog'));
const DiffViewer        = lazy(() => import(/* webpackChunkName: "diff-viewer" */ './components/DiffViewer'));
const FilePalette       = lazy(() => import(/* webpackChunkName: "file-palette"*/ './components/FilePalette'));
const ExtensionManager  = lazy(() => import(/* webpackChunkName: "extensions"  */ './components/ExtensionManager'));
const SnippetPalette    = lazy(() => import(/* webpackChunkName: "snippets"    */ './components/SnippetPalette'));
const GlobalSearch      = lazy(() => import(/* webpackChunkName: "search"      */ './components/GlobalSearch'));
const GitPanel          = lazy(() => import(/* webpackChunkName: "git"         */ './components/GitPanel'));
const DebugPanel        = lazy(() => import(/* webpackChunkName: "debug"       */ './components/DebugPanel'));
const OutlinePanel      = lazy(() => import(/* webpackChunkName: "outline"     */ './components/OutlinePanel'));
const TimelinePanel     = lazy(() => import(/* webpackChunkName: "timeline"    */ './components/TimelinePanel'));
const ProblemsPanel     = lazy(() => import(/* webpackChunkName: "problems"    */ './components/ProblemsPanel'));
const SpotifyPlayer     = lazy(() => import(/* webpackChunkName: "spotify"     */ './components/SpotifyPlayer'));

// Lightweight placeholder for Suspense boundaries. `null` is intentional:
// these are modal/panel openings — an extra spinner frame would feel
// worse than a silent one-frame delay.
const LazyFallback = null;

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
  // Auto-reindex the semantic search index on file changes. No-op until
  // the user manually builds an index for the project at least once.
  const semanticAuto = useSemanticAutoReindex(state.projectPath, true);
  // Restore last-session workspace (project + open tabs + layout) on boot,
  // then debounce-save on any relevant change.
  useSession(state, dispatch, fs);
  useClipboardHistory(dispatch);
  const heatmap = useHeatmap({
    projectPath: state.projectPath,
    enabled: state.heatmapEnabled,
    rangeDays: state.heatmapRange,
  });
  const customAgents = useCustomAgents(state.projectPath, dispatch);
  useAgentTriggers(state, dispatch);
  useReleaseNotes(dispatch);
  useAgentSessionPersistence(state, dispatch);
  useGlobalErrorHandler(dispatch);
  const projectBrain = useProjectBrain(state.projectPath, dispatch);
  useTimeScrub(state, dispatch);
  useSemanticAuto(state, dispatch);

  // Load persistent agent identity + semantic-types store on project change.
  useEffect(() => {
    (async () => {
      const id = await loadIdentity(state.projectPath);
      dispatch({ type: 'SET_AGENT_IDENTITY', identity: id });
      const st = await loadSemanticStore(state.projectPath);
      dispatch({ type: 'SET_SEMANTIC_TYPES', store: st });
    })();
  }, [state.projectPath, dispatch]);
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
    openOmnibar: () => dispatch({ type: 'SET_PANEL', panel: 'showOmnibar', value: true }),
    openSwarm:   () => dispatch({ type: 'SET_PANEL', panel: 'showAgentSwarm', value: true }),
    openCanvas:  () => dispatch({ type: 'SET_PANEL', panel: 'showCodeCanvas', value: true }),
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
    <div className={`relative flex flex-col h-screen w-screen bg-lorica-bg select-none ${isZen ? 'zen-mode' : ''}`}>
      {/* Ambient accent-tinted glow behind the whole app. Pure CSS, no
          animation, so it costs nothing per frame. */}
      <div className="lorica-ambient-glow" />
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

        {/* Left Sidebar — switchable: FileTree / Search / Git / Debug / Outline / Timeline / Bookmarks / Scratchpad / TodoBoard / Brain */}
        {!isZen && (state.showFileTree || state.showSearch || state.showGit || state.showDebug || state.showOutline || state.showTimeline || state.showBookmarksPanel || state.showScratchpad || state.showTodoBoard || state.showProjectBrain) && (
          <>
            <div style={{ width: sidebarWidth }} className="flex-shrink-0 border-r border-lorica-border bg-lorica-surface overflow-hidden">
              <ErrorBoundary name="Sidebar" compact>
              <Suspense fallback={LazyFallback}>
                {state.showSearch ? (
                  <GlobalSearch state={state} dispatch={dispatch} onFileOpen={fs.openFile} />
                ) : state.showGit ? (
                  <GitPanel state={state} dispatch={dispatch} />
                ) : state.showDebug ? (
                  <DebugPanel state={state} dispatch={dispatch} activeFile={activeFile} />
                ) : state.showOutline ? (
                  <OutlinePanel state={state} dispatch={dispatch} activeFile={activeFile} />
                ) : state.showBookmarksPanel ? (
                  <BookmarksPanel state={state} dispatch={dispatch} onFileOpen={fs.openFile} />
                ) : state.showScratchpad ? (
                  <Scratchpad state={state} dispatch={dispatch} />
                ) : state.showTodoBoard ? (
                  <TodoBoard state={state} dispatch={dispatch} />
                ) : state.showProjectBrain ? (
                  <ProjectBrainPanel state={state} dispatch={dispatch} brainRefresh={projectBrain.refresh} />
                ) : state.showTimeline ? (
                  <TimelinePanel state={state} dispatch={dispatch} />
                ) : (
                  <FileTree
                    tree={state.fileTree}
                    projectPath={state.projectPath}
                    onFileClick={fs.openFile}
                    onRefresh={() => fs.refreshTree(state.projectPath)}
                    dispatch={dispatch}
                    fs={fs}
                    heatmap={heatmap.data}
                    heatmapEnabled={state.heatmapEnabled}
                    heatmapRange={state.heatmapRange}
                    heatmapLoading={heatmap.loading}
                    onHeatmapToggle={() => dispatch({ type: 'TOGGLE_HEATMAP' })}
                    onHeatmapRangeChange={(d) => dispatch({ type: 'SET_HEATMAP_RANGE', days: d })}
                  />
                )}
              </Suspense>
              </ErrorBoundary>
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
            <Breadcrumbs file={activeFile} projectPath={state.projectPath} dispatch={dispatch} fileTree={state.fileTree} />
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
                    <ErrorBoundary name="Editor">
                      <Editor
                        file={activeFile}
                        index={state.activeFileIndex}
                        dispatch={dispatch}
                        theme={state.theme}
                        showMinimap={state.showMinimap !== false}
                        aiInlineEnabled={state.aiInlineEnabled}
                        aiProvider={state.aiProvider}
                        aiApiKey={state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey}
                        blameEnabled={state.blameEnabled}
                        projectPath={state.projectPath}
                        bookmarks={state.bookmarks?.[activeFile?.path] || null}
                        semanticMarks={state.semanticTypes?.[activeFile?.path]?.mismatches || null}
                      />
                    </ErrorBoundary>
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
                        <ErrorBoundary name="Split Editor">
                          <Editor
                            file={splitFile}
                            index={state.splitFileIndex}
                            dispatch={dispatch}
                            theme={state.theme}
                            showMinimap={false}
                            aiInlineEnabled={state.aiInlineEnabled}
                            aiProvider={state.aiProvider}
                            aiApiKey={state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey}
                            blameEnabled={state.blameEnabled}
                            projectPath={state.projectPath}
                            bookmarks={state.bookmarks?.[splitFile?.path] || null}
                            semanticMarks={state.semanticTypes?.[splitFile?.path]?.mismatches || null}
                          />
                        </ErrorBoundary>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <WelcomeTab dispatch={dispatch} onOpenFolder={fs.openFolder} onOpenProject={fs.openProject} />
            )}
          </div>

          {/* Time Scrub bar — thin controller above Problems/Terminal. */}
          {!isZen && state.showTimeScrub && <TimeScrubBar state={state} dispatch={dispatch} />}

          {/* Problems Panel */}
          {!isZen && state.showProblems && (
            <div className="flex-shrink-0 h-[150px] border-t border-lorica-border">
              <Suspense fallback={LazyFallback}>
                <ProblemsPanel state={state} dispatch={dispatch} onFileOpen={fs.openFile} />
              </Suspense>
            </div>
          )}

          {!isZen && state.showTerminal && (
            <>
              <div className="h-1 cursor-row-resize resize-handle bg-lorica-border hover:bg-lorica-accent flex-shrink-0" onMouseDown={handleTerminalResize} />
              <div style={{ height: terminalHeight }} className="flex-shrink-0 border-t border-lorica-border">
                <ErrorBoundary name="Terminal">
                  <Terminal dispatch={dispatch} />
                </ErrorBoundary>
              </div>
            </>
          )}
        </div>

        {/* Instant Preview rail — auto-routed visualizer for JSON/YAML/CSV/regex/SQL/URL.
            Sits between the editor column and the AI panel so it's close to the
            file being visualized without competing with the agent. */}
        {!isZen && state.showInstantPreview && activeFile && (
          <>
            <div className="w-1 cursor-col-resize resize-handle bg-lorica-border hover:bg-lorica-accent flex-shrink-0" />
            <div style={{ width: 340 }} className="flex-shrink-0 border-l border-lorica-border bg-lorica-surface overflow-hidden flex flex-col">
              <ErrorBoundary name="Instant Preview" compact>
                <Suspense fallback={LazyFallback}>
                  <InstantPreview
                    file={activeFile}
                    onClose={() => dispatch({ type: 'SET_PANEL', panel: 'showInstantPreview', value: false })}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          </>
        )}

        {!isZen && state.showAIPanel && (
          <>
            <div className="w-1 cursor-col-resize resize-handle bg-lorica-border hover:bg-lorica-accent flex-shrink-0" onMouseDown={handleAIResize} />
            <div style={{ width: aiPanelWidth }} className="flex-shrink-0 border-l border-lorica-border bg-lorica-surface overflow-hidden flex flex-col">
              <ErrorBoundary name="Agent Copilot" compact>
                <AgentCopilot state={state} dispatch={dispatch} agent={agent} activeFile={activeFile} />
              </ErrorBoundary>
              {state.showSpotify && (
                <div className="border-t border-lorica-border flex-shrink-0">
                  <Suspense fallback={LazyFallback}>
                    <SpotifyPlayer spotify={spotify} />
                  </Suspense>
                </div>
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

      {/* Live performance HUD — only ticks rAF while visible. */}
      <PerformanceHUD
        visible={state.showPerformanceHUD}
        onClose={() => dispatch({ type: 'TOGGLE_PERFORMANCE_HUD' })}
      />

      {/* Ambient HUD — surfaces background work the user might not otherwise notice. */}
      <AmbientHUD state={state} dispatch={dispatch} />

      {/* Modal stack — all lazy-loaded, share one Suspense boundary, and
          wrapped in an ErrorBoundary so a crash inside any modal never
          takes down the IDE. */}
      <ErrorBoundary name="Modal stack">
      <Suspense fallback={LazyFallback}>
        {state.showOmnibar && (
          <Omnibar
            state={state} dispatch={dispatch}
            actions={actions.current} activeFile={activeFile}
            onOpenFolder={fs.openFolder} onLock={security.lock}
            onFileOpen={fs.openFile}
            onCodeCanvas={actions.current.openCanvas}
            onSwarmReview={actions.current.openSwarm}
          />
        )}
        {state.showAgentSwarm && (
          <AgentSwarmPanel state={state} dispatch={dispatch} activeFile={activeFile} />
        )}
        {state.showCodeCanvas && (
          <CodeCanvas state={state} dispatch={dispatch} onFileOpen={fs.openFile} />
        )}
        {state.nextEditSuggestions && <NextEditPanel state={state} dispatch={dispatch} />}
        {state.showClipboardHistory && <ClipboardHistory state={state} dispatch={dispatch} />}
        {state.showApiTester && <ApiTester state={state} dispatch={dispatch} />}
        {state.showRegexBuilder && <RegexBuilder state={state} dispatch={dispatch} />}
        {state.showAgentBuilder && (
          <AgentBuilder state={state} dispatch={dispatch} onSaved={customAgents.refresh} />
        )}
        {state.showPrReady && <PrReadyModal state={state} dispatch={dispatch} />}
        {state.showAutoFix && <AutoFixModal state={state} dispatch={dispatch} />}
        {state.showAgentIdentity && <AgentIdentityModal state={state} dispatch={dispatch} />}
        {state.showSandbox && <SandboxPanel state={state} dispatch={dispatch} />}
        {state.showSwarm && <SwarmPanel state={state} dispatch={dispatch} />}
        {state.showSemanticTypes && <SemanticTypesPanel state={state} dispatch={dispatch} />}
        {state.showKeyboardCheatsheet && <KeyboardCheatsheet state={state} dispatch={dispatch} />}
        {state.showReleaseNotes && <ReleaseNotes state={state} dispatch={dispatch} />}
        {state.showInlineEditHistory && <InlineEditHistory state={state} dispatch={dispatch} />}
        {state.showLayoutSwitcher && <LayoutSwitcher state={state} dispatch={dispatch} />}
        {state.showCommandPalette && (
          <CommandPalette state={state} dispatch={dispatch} onOpenFolder={fs.openFolder} onLock={security.lock} actions={actions.current} />
        )}
        {state.showSettings && <Settings state={state} dispatch={dispatch} actions={actions.current} />}
        {state.showSecretVault && <SecretVault state={state} dispatch={dispatch} security={security} />}
        {state.showAuditLog && <AuditLog dispatch={dispatch} />}
        {state.showDiffViewer && <DiffViewer state={state} dispatch={dispatch} />}
        {state.showFilePalette && <FilePalette state={state} dispatch={dispatch} onFileOpen={fs.openFile} />}
        {state.showExtensions && <ExtensionManager dispatch={dispatch} />}
        {state.showSnippets && <SnippetPalette activeFile={activeFile} dispatch={dispatch} state={state} />}
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}
