import React, { useReducer, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { appReducer, initialState } from './store/appReducer';
import { THEMES } from './utils/themes';
import { useFileSystem } from './hooks/useFileSystem';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useLSP } from './hooks/useLSP';
import { useAI } from './hooks/useAI';
import { useSecurity } from './hooks/useSecurity';
import { useSpotify } from './hooks/useSpotify';
import { useUpdate } from './hooks/useUpdate';
import { useShortcuts } from './hooks/useShortcuts';
import { useSemanticAutoReindex } from './hooks/useSemanticAutoReindex';
import { useSession } from './hooks/useSession';
import { useClipboardHistory } from './hooks/useClipboardHistory';
import { useRecentCompletions } from './hooks/useRecentCompletions';
import { useHeatmap } from './hooks/useHeatmap';
import { useGitFileStatus } from './hooks/useGitFileStatus';
import { useCustomAgents } from './hooks/useCustomAgents';
import { useAgentTriggers } from './hooks/useAgentTriggers';
import { useProjectBrain } from './hooks/useProjectBrain';
import { useProjectPrompts } from './hooks/useProjectPrompts';
import { useReleaseNotes } from './hooks/useReleaseNotes';
import { useAgentSessionPersistence } from './hooks/useAgentSessionPersistence';
import { useGlobalErrorHandler } from './hooks/useGlobalErrorHandler';
import { useTimeScrub } from './hooks/useTimeScrub';
import { useSemanticAuto } from './hooks/useSemanticAuto';
import { useDevContainer } from './hooks/useDevContainer';
import { useAnnotations } from './hooks/useAnnotations';
import { normalizeFilePath as normalizeAnnotationPath } from './utils/annotations';
import { useCollabSession } from './hooks/useCollabSession';
import { bootEnabledExtensions } from './utils/extensionRuntime';
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
import { useAgent } from './hooks/useAgent';
import StatusBar from './components/StatusBar';
import ToastContainer from './components/Toast';
import Breadcrumbs from './components/Breadcrumbs';
import WelcomeTab from './components/WelcomeTab';
import LoricaDock from './components/LoricaDock';
import ImagePreview, { isImageFile } from './components/ImagePreview';
import FilePreview, { hasPreview } from './components/FilePreview';
import AmbientHUD from './components/AmbientHUD';
// Wave 31 — lazy-load the two annotation overlays. They render only
// after the user clicks/right-clicks the gutter, so paying their JS
// at first paint is wasteful. Each is tiny (~3 KiB) but every byte
// out of main.bundle adds up.
const AddAnnotationPrompt = lazy(() => import(/* webpackChunkName: "annotation-prompt" */ './components/AddAnnotationPrompt'));
const AnnotationPopover   = lazy(() => import(/* webpackChunkName: "annotation-popover" */ './components/AnnotationPopover'));

// Lazy: Terminal pulls in the entire xterm bundle (~283 KiB) — splitting
// it off the entrypoint is the single biggest first-paint win available
// without touching the editor. AgentCopilot defaults closed (~26 KiB
// + react-markdown deps) so it can wait for the user to open the AI
// panel. LockScreen only mounts when the secret-vault lock is engaged.
const Terminal     = lazy(() => import(/* webpackChunkName: "terminal"      */ './components/Terminal'));
const AgentCopilot = lazy(() => import(/* webpackChunkName: "agent-copilot" */ './components/AgentCopilot'));
const LockScreen   = lazy(() => import(/* webpackChunkName: "lock-screen"   */ './components/LockScreen'));

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
const WorktreesPanel    = lazy(() => import(/* webpackChunkName: "worktrees"   */ './components/WorktreesPanel'));
const SmartPasteModal   = lazy(() => import(/* webpackChunkName: "smart-paste" */ './components/SmartPasteModal'));
const AnnotationsPanel  = lazy(() => import(/* webpackChunkName: "annotations" */ './components/AnnotationsPanel'));
const CollabPanel       = lazy(() => import(/* webpackChunkName: "collab"      */ './components/CollabPanel'));
const SemanticTypesPanel = lazy(() => import(/* webpackChunkName: "sem-types"  */ './components/SemanticTypesPanel'));
const KeyboardCheatsheet = lazy(() => import(/* webpackChunkName: "cheatsheet" */ './components/KeyboardCheatsheet'));
const ReleaseNotes      = lazy(() => import(/* webpackChunkName: "release"    */ './components/ReleaseNotes'));
const InlineEditHistory = lazy(() => import(/* webpackChunkName: "edit-hist"  */ './components/InlineEditHistory'));
const LayoutSwitcher    = lazy(() => import(/* webpackChunkName: "layouts"    */ './components/LayoutSwitcher'));
import ErrorBoundary from './components/ErrorBoundary';
// TimeScrubBar, PerformanceHUD, and AIConsentModal are opt-in UI — lazy
// so their code (TimeScrubBar in particular pulls LCS-diff + tauri-http)
// isn't in the initial bundle. FocusTimer was dead-imported here before
// (the live mount lives inside StatusBar); it's been dropped.
const TimeScrubBar      = lazy(() => import(/* webpackChunkName: "time-scrub"  */ './components/TimeScrubBar'));
const PerformanceHUD    = lazy(() => import(/* webpackChunkName: "perf-hud"    */ './components/PerformanceHUD'));
const AIConsentModal    = lazy(() => import(/* webpackChunkName: "ai-consent"  */ './components/AIConsentModal'));
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
  // Auto-refresh the file tree when files change outside Lorica (git
  // checkout, npm install, another editor). Without this hook users have
  // to manually click Refresh to see new files.
  useFileWatcher(state.projectPath, fs.refreshTree);

  // Language Server Protocol integration. Spins up one server process
  // per language on-demand (first Python file opened → starts pylsp,
  // first Rust file → starts rust-analyzer, etc.), then forwards
  // completion / hover / definition requests from the editor. Servers
  // aren't bundled — the user has to install them. If missing, the
  // static completion dictionary still works.
  const lsp = useLSP(state);
  // Restore last-session workspace (project + open tabs + layout) on boot,
  // then debounce-save on any relevant change.
  useSession(state, dispatch, fs);
  useClipboardHistory(dispatch);
  // Pre-warm the per-language autocomplete recency cache so the first
  // completion query already sees recent picks. Hook itself is tiny —
  // store lives in src/utils/completions/recencyStore.js.
  useRecentCompletions();
  const heatmap = useHeatmap({
    projectPath: state.projectPath,
    enabled: state.heatmapEnabled,
    rangeDays: state.heatmapRange,
  });
  // Per-file git status decorations for the FileTree. Cheap to mount —
  // the hook idles when there's no project and self-debounces refresh
  // bursts. Uses the same `cmd_git_status` command as GitPanel.
  const gitFileStatus = useGitFileStatus(state.projectPath);
  const customAgents = useCustomAgents(state.projectPath, dispatch);
  useAgentTriggers(state, dispatch);
  useReleaseNotes(dispatch);
  useAgentSessionPersistence(state, dispatch);
  useGlobalErrorHandler(dispatch);
  const projectBrain = useProjectBrain(state.projectPath, dispatch);
  // Project-scoped prompt library + auto-attached instructions. Read on
  // mount, on project swap, and on `.lorica/` filesystem events. The
  // agent input panel surfaces `prompts` in its slash menu and useAgent
  // pulls `instructions` fresh at send time so changes are picked up
  // immediately even if the watcher missed them.
  const projectPrompts = useProjectPrompts(state.projectPath);
  useTimeScrub(state, dispatch);
  useSemanticAuto(state, dispatch);
  // Detects .devcontainer/devcontainer.json so the StatusBar can surface
  // a "Open in container" badge. Read-only v1 — clicking opens a shell
  // via `docker run` in a fresh terminal session.
  const devContainer = useDevContainer(state.projectPath, dispatch);
  // Spatial annotations — Wave 11.4. One source of truth for the modal
  // browser (AnnotationsPanel) and (later) the inline editor gutter.
  const annotationsApi = useAnnotations(state.projectPath);

  // Wave 29 — merge live-collab review notes into the annotations
  // stream the editor receives, so peers' notes pin visually at the
  // exact (file, line) they were posted on. Each review note is
  // converted into an annotation-shaped record so the existing
  // gutter / popover renderer can handle it without special-casing.
  // The `_remote: true` flag could later drive distinct styling; for
  // v0 we just colour it with the author's peer colour.
  const remoteAnnotationsByFile = React.useMemo(() => {
    const out = Object.create(null);
    if (!collab?.reviewNotes?.length) return out;
    for (const n of collab.reviewNotes) {
      if (!n?.file || !n?.line) continue;
      const norm = normalizeAnnotationPath(n.file, state.projectPath);
      if (!out[norm]) out[norm] = [];
      out[norm].push({
        id: n.id,
        file: norm,
        line: n.line,
        text: n.text || '',
        // Map the peer's hex colour to the closest existing palette
        // bucket so the gutter dot uses our themed tints. We don't
        // try to mix-and-match the hex directly — staying inside the
        // palette keeps the visual language tight.
        color: 'violet',
        author: n.author || 'peer',
        pinned: true,
        replies: [],
        createdAt: n.at || Date.now(),
        updatedAt: n.at || Date.now(),
        _remote: true,
      });
    }
    return out;
  }, [collab?.reviewNotes, state.projectPath]);
  // Real-time collaboration — Wave 11.5. The hook owns the Yjs+WebRTC
  // session lifecycle; the panel just renders state.
  const collab = useCollabSession();

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
  // Pending "add annotation" intent — populated when the user right-
  // clicks the annotations gutter (Wave 12.1). Shape:
  // `{ line, file }` while open, `null` when closed.
  const [addAnnotationAt, setAddAnnotationAt] = React.useState(null);
  // Inline annotation popover state (Wave 15). Populated when the user
  // clicks a gutter dot — null otherwise. Shape: { id, line, annotations,
  // anchor: {x, y} }.
  const [annotationPeek, setAnnotationPeek] = React.useState(null);
  // Wave 17 — resolved Yjs/CodeMirror binding for the active file when
  // it's the currently-shared file in a Live Share session. Resolved
  // async (the binding lib is lazy-loaded), so we cache it in state.
  const [activeCollabBinding, setActiveCollabBinding] = React.useState(null);

  // Refs for timers and stale closure avoidance
  const stateRef = useRef(state);
  const fsRef = useRef(fs);
  const autoSaveTimerRef = useRef(null);
  const zenKeyRef = useRef(false);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { fsRef.current = fs; }, [fs]);

  // Wire the gutter → annotations bridge (Wave 12.1). The annotations
  // gutter fires DOM events instead of importing the hook, keeping the
  // CodeMirror extension framework-agnostic.
  useEffect(() => {
    const onAdd = (ev) => {
      const line = ev?.detail?.line;
      const s = stateRef.current;
      const file = s.openFiles?.[s.activeFileIndex];
      if (!file?.path || typeof line !== 'number') return;
      setAddAnnotationAt({ line, file: file.path });
    };
    const onFocus = (ev) => {
      // Open the panel and let the user spot the highlighted row.
      // Highlighting itself is panel-side polish for a follow-up.
      dispatch({ type: 'SET_PANEL', panel: 'showAnnotationsPanel', value: true });
    };
    const onPeek = (ev) => {
      const d = ev?.detail;
      if (!d) return;
      setAnnotationPeek({
        id: d.id,
        line: d.line,
        annotations: d.annotations || [],
        anchor: d.anchor || { x: 100, y: 100 },
      });
    };
    window.addEventListener('lorica:addAnnotation', onAdd);
    window.addEventListener('lorica:focusAnnotation', onFocus);
    window.addEventListener('lorica:peekAnnotation', onPeek);
    return () => {
      window.removeEventListener('lorica:addAnnotation', onAdd);
      window.removeEventListener('lorica:focusAnnotation', onFocus);
      window.removeEventListener('lorica:peekAnnotation', onPeek);
    };
  }, [dispatch]);

  // Boot-time perf marks — paired with `lorica:boot:start` (in index.jsx).
  // The HUD reads these and shows `firstpaint - start` and
  // `projectready - start`. Both stamps are best-effort: a refresh into a
  // saved session reuses the same marks so they're naturally stable.
  useEffect(() => {
    try { performance.mark('lorica:boot:firstpaint'); } catch {}
    // Run only once on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wave 24 — boot every user-enabled extension. Runs once on first
  // mount and again whenever the project changes (so project-local
  // .lorica/extensions/ get picked up). Errors are surfaced as toasts;
  // we never throw to keep boot resilient if a single extension is
  // broken.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await bootEnabledExtensions({ projectPath: state.projectPath });
        if (cancelled) return;
        if (r.errors?.length) {
          for (const msg of r.errors.slice(0, 3)) {
            dispatch({
              type: 'ADD_TOAST',
              toast: { type: 'warning', message: `Extension: ${msg}`, duration: 4500 },
            });
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [state.projectPath, dispatch]);

  // First non-empty project tree → mark as "project ready". Session
  // restore re-uses the same mark (we only stamp the first time the
  // tree becomes non-empty).
  const projectReadyStampedRef = useRef(false);
  useEffect(() => {
    if (projectReadyStampedRef.current) return;
    if (Array.isArray(state.fileTree) && state.fileTree.length > 0) {
      projectReadyStampedRef.current = true;
      try { performance.mark('lorica:boot:projectready'); } catch {}
    }
  }, [state.fileTree]);

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
    // 5-stop palette for the in-app logo (LoricaLogo.jsx). Falls back to
    // the accent colour if a theme forgot to define one, so the logo is
    // never invisible.
    const bars = t.logoBars || [t.accent, t.accent, t.accent, t.accent, t.accent];
    for (let i = 0; i < 5; i++) {
      root.style.setProperty(`--color-logo-${i + 1}`, bars[i] || t.accent);
    }
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

  // Wave 17 — resolve the Live Share binding asynchronously when the
  // active file is the one being shared. The binding library is lazy-
  // loaded (~80 KiB chunk), so we cache the result in state and pass
  // it down as a prop. Effect cleans up when the file changes or the
  // sharedFile changes so we never apply a stale binding.
  useEffect(() => {
    let cancelled = false;
    if (!collab.active || !collab.sharedFile || !activeFile?.path) {
      setActiveCollabBinding(null);
      return undefined;
    }
    if (collab.sharedFile !== activeFile.path) {
      setActiveCollabBinding(null);
      return undefined;
    }
    (async () => {
      try {
        const ext = await collab.getBindingFor(activeFile.path, activeFile.content || '');
        if (!cancelled) setActiveCollabBinding(ext);
      } catch (e) {
        // Silent: a binding failure leaves the editor in plain mode,
        // which is acceptable degradation. Surfacing as a toast would
        // spam the user every time they switch files during a session.
        if (!cancelled) setActiveCollabBinding(null);
      }
    })();
    return () => { cancelled = true; };
  }, [collab, activeFile?.path, activeFile?.content]);

  // =============================================
  // Merge-conflict resolution — invoked by the inline buttons rendered
  // by the conflictMarkersExtension in the editor. The "ours/theirs/both"
  // actions are already applied by the extension itself (it dispatches a
  // CM transaction directly); here we only need to:
  //   1. Drop a small toast so the user gets a confirmation, AND
  //   2. For the 'ai' action, open the agent panel and seed the input
  //      with a structured prompt that contains both sides + surrounding
  //      context. The user can then tweak the prompt before sending.
  // =============================================
  const handleConflictResolve = useCallback((block, action) => {
    // Resolve the file the block lives in. The extension fires its callback
    // synchronously on click, so the active editor at that instant owns the
    // conflict. (For splits, the click target is whichever editor the user
    // interacted with — and only one is "active" in our reducer at a time.)
    const file = activeFile || splitFile;
    if (!file) return;

    if (action !== 'ai') {
      // Inline path — extension already applied the change. Toast only.
      const labels = { ours: 'ours', theirs: 'theirs', both: 'both sides' };
      toast(dispatch, 'success', `Conflict resolved (kept ${labels[action] || action})`, 1800);
      return;
    }

    // AI path — build a structured prompt and push it into the agent input.
    const doc = file.content || '';
    const ours = doc.slice(block.oursStart, block.oursEnd);
    const theirs = doc.slice(block.theirsStart, block.theirsEnd);

    // 5 lines of context before / after the block so the AI can reason about
    // what surrounds the conflict. The block already starts/ends on line
    // boundaries so splitting on \n at the edges is clean.
    const beforeText = doc.slice(0, block.start);
    const afterText  = doc.slice(block.end);
    const beforeLines = beforeText.split('\n');
    const afterLines  = afterText.split('\n');
    const ctxBefore = beforeLines.slice(Math.max(0, beforeLines.length - 6), beforeLines.length - 1).join('\n');
    const ctxAfter  = afterLines.slice(1, 6).join('\n');

    const lang = file.extension || '';
    const prompt =
`I'm resolving a merge conflict in ${file.path}.

OURS (${block.oursLabel}):
\`\`\`${lang}
${ours}\`\`\`

THEIRS (${block.theirsLabel}):
\`\`\`${lang}
${theirs}\`\`\`

Surrounding context (5 lines before / after):
\`\`\`${lang}
${ctxBefore}
<<< CONFLICT HERE >>>
${ctxAfter}
\`\`\`

Suggest the best resolution and explain why. Output ONLY the replacement code in a fenced block.`;

    // Open the agent panel and seed the input. AgentCopilot consumes
    // agentInputPrefill on mount/update and clears it via AGENT_CLEAR_PREFILL.
    dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
    dispatch({ type: 'AGENT_PREFILL_INPUT', text: prompt });
    toast(dispatch, 'info', 'Conflict context sent to AI agent', 2000);
  }, [activeFile, splitFile, dispatch]);

  if (state.isLocked) {
    return (
      <Suspense fallback={LazyFallback}>
        <LockScreen onUnlock={security.unlock} onInit={security.initVault} vaultInitialized={state.vaultInitialized} />
      </Suspense>
    );
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
                    gitFileStatus={gitFileStatus}
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
                        aiApiKey: state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiProvider === 'deepseek' ? state.aiDeepseekKey : state.aiProvider === 'openrouter' ? state.aiOpenRouterKey : '',
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
                        aiApiKey={state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiProvider === 'deepseek' ? state.aiDeepseekKey : state.aiProvider === 'openrouter' ? state.aiOpenRouterKey : ''}
                        aiOllamaUrl={state.aiOllamaUrl}
                        aiOllamaModel={state.aiOllamaModel}
                        blameEnabled={state.blameEnabled}
                        projectPath={state.projectPath}
                        bookmarks={state.bookmarks?.[activeFile?.path] || null}
                        semanticMarks={state.semanticTypes?.[activeFile?.path]?.mismatches || null}
                        annotations={state.showAnnotations === false ? [] : ([
                          ...(annotationsApi.byFile[normalizeAnnotationPath(activeFile?.path || '', state.projectPath)] || []),
                          ...(remoteAnnotationsByFile[normalizeAnnotationPath(activeFile?.path || '', state.projectPath)] || []),
                        ])}
                        collabBinding={activeCollabBinding}
                        lspRequestCompletion={lsp.requestCompletion}
                        lspDiagnostics={lsp.diagnostics}
                        onConflictResolve={handleConflictResolve}
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
                            aiApiKey: state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiProvider === 'deepseek' ? state.aiDeepseekKey : state.aiProvider === 'openrouter' ? state.aiOpenRouterKey : '',
                            aiOllamaUrl: state.aiOllamaUrl,
                            aiOllamaModel: state.aiOllamaModel,
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
                            aiApiKey={state.aiProvider === 'anthropic' ? state.aiApiKey : state.aiProvider === 'deepseek' ? state.aiDeepseekKey : state.aiProvider === 'openrouter' ? state.aiOpenRouterKey : ''}
                            aiOllamaUrl={state.aiOllamaUrl}
                            aiOllamaModel={state.aiOllamaModel}
                            blameEnabled={state.blameEnabled}
                            projectPath={state.projectPath}
                            bookmarks={state.bookmarks?.[splitFile?.path] || null}
                            semanticMarks={state.semanticTypes?.[splitFile?.path]?.mismatches || null}
                            annotations={state.showAnnotations === false ? [] : ([
                              ...(annotationsApi.byFile[normalizeAnnotationPath(splitFile?.path || '', state.projectPath)] || []),
                              ...(remoteAnnotationsByFile[normalizeAnnotationPath(splitFile?.path || '', state.projectPath)] || []),
                            ])}
                            lspRequestCompletion={lsp.requestCompletion}
                            lspDiagnostics={splitFile?.path === activeFile?.path ? lsp.diagnostics : []}
                            onConflictResolve={handleConflictResolve}
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
          {!isZen && state.showTimeScrub && (
            <Suspense fallback={LazyFallback}>
              <TimeScrubBar state={state} dispatch={dispatch} />
            </Suspense>
          )}

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
                  <Suspense fallback={LazyFallback}>
                    <Terminal dispatch={dispatch} />
                  </Suspense>
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
                <Suspense fallback={LazyFallback}>
                  <AgentCopilot state={state} dispatch={dispatch} agent={agent} activeFile={activeFile} projectPrompts={projectPrompts} actions={actions} />
                </Suspense>
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
          devContainer={devContainer}
        />
      ) : (
        <div className="h-6 flex items-center justify-center text-[10px] text-lorica-textDim/30 bg-lorica-bg cursor-pointer hover:text-lorica-textDim/60 transition-colors"
          onClick={actions.current.toggleZen}>
          ZEN MODE — Press Escape to exit
        </div>
      )}

      <ToastContainer toasts={state.toasts || []} dispatch={dispatch} />

      {/* Live performance HUD — lazy, only mounted when toggled on. */}
      {state.showPerformanceHUD && (
        <Suspense fallback={LazyFallback}>
          <PerformanceHUD
            visible={state.showPerformanceHUD}
            onClose={() => dispatch({ type: 'TOGGLE_PERFORMANCE_HUD' })}
          />
        </Suspense>
      )}

      {/* Ambient HUD — surfaces background work the user might not otherwise notice. */}
      <AmbientHUD state={state} dispatch={dispatch} />

      {/* RGPD consent gate for AI features. Lazy + mount-on-demand so the
          modal's code only loads the first time a user triggers AI. */}
      {state.aiConsentModalOpen && (
        <Suspense fallback={LazyFallback}>
          <AIConsentModal state={state} dispatch={dispatch} />
        </Suspense>
      )}

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
        {state.showWorktrees && (
          <WorktreesPanel
            state={state}
            dispatch={dispatch}
            onSwitchProject={fs.openProject}
          />
        )}
        {state.showSmartPaste && (
          <SmartPasteModal
            state={state}
            dispatch={dispatch}
            activeFile={activeFile}
            onInsert={(text) => {
              // Loosely coupled: emit a DOM event the Editor listens for.
              // Avoids reaching into Editor.jsx internals (LEDGER rule).
              try {
                window.dispatchEvent(new CustomEvent('lorica:insertAtCursor', { detail: { text } }));
              } catch {}
            }}
          />
        )}
        {state.showAnnotationsPanel && (
          <AnnotationsPanel
            state={state}
            dispatch={dispatch}
            annotations={annotationsApi.annotations}
            removeAnnotation={annotationsApi.removeAnnotation}
            updateAnnotation={annotationsApi.updateAnnotation}
            addReply={annotationsApi.addReply}
            removeReply={annotationsApi.removeReply}
            onOpenFile={(path /* , line */) => fs.openFile(path)}
          />
        )}
        {state.showCollab && (
          <CollabPanel
            state={state}
            dispatch={dispatch}
            collab={collab}
            activeFile={activeFile}
          />
        )}
        {addAnnotationAt && (
          <AddAnnotationPrompt
            at={addAnnotationAt}
            onClose={() => setAddAnnotationAt(null)}
            onSave={({ file, line, color, text }) => {
              annotationsApi.addAnnotation({ file, line, color, text });
              dispatch({
                type: 'ADD_TOAST',
                toast: { type: 'success', message: 'Annotation added', duration: 1800 },
              });
            }}
          />
        )}
        {annotationPeek && (
          <AnnotationPopover
            peek={annotationPeek}
            onClose={() => setAnnotationPeek(null)}
            onOpenPanel={() => {
              setAnnotationPeek(null);
              dispatch({ type: 'SET_PANEL', panel: 'showAnnotationsPanel', value: true });
            }}
          />
        )}
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
