// src/components/Omnibar.jsx
//
// The Omnibar is Lorica's single, universal entry point. It collapses what
// VS Code splits across Ctrl+P (files), Ctrl+Shift+P (commands), Ctrl+Shift+F
// (search), Ctrl+Shift+O (symbols) and the AI chat into ONE surface.
//
// Type anything. The bar routes your query across five sources in parallel:
//   • Files         — fuzzy match over the project tree
//   • Commands      — every IDE action (same list as the old palette)
//   • Symbols       — functions / classes in the active file, extracted
//                     lightly from regex per-language (works without LSP)
//   • Semantic      — embedding search (debounced, only when index exists)
//   • Agent fallback— always offers "Ask the agent: <query>" as a last row
//
// Results are grouped by source with small section headers. Keyboard-only
// navigation: arrows move within the flat list, Enter fires the selected
// row, Esc closes. Tab cycles result "modes" when the query is empty
// (recent files / commands / bookmarks) so the bar feels alive even before
// the user types.
//
// Implementation notes:
//   • Semantic search runs on a 250 ms debounce so typing isn't throttled
//     by the embedding query latency (~5-50 ms but adds up on fast typing).
//   • File list is flattened once per mount (cheap for typical projects);
//     symbols are extracted on the active file only.
//   • Everything renders from a single flat `rows` array so scroll + focus
//     behaviour is identical to the old palette.

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search, FileText, Terminal as TerminalIcon, Sparkles, Hash, Compass,
  Command as CommandIcon, FolderOpen, Save, Settings, Shield, Lock, Bot,
  Music, PanelLeftClose, GitCompare, ClipboardList, Palette, Moon, Sun,
  Maximize, Minimize, SplitSquareHorizontal, Map, SaveAll,
  GitBranch, FileSearch, Bug, Package, Code2, AlertTriangle, GitCommit,
  Activity, Brain as BrainIcon, Network, Zap, Eye,
  Star, StickyNote, ClipboardCheck, Clipboard, Send, Regex, Clock3,
  Flame, Wand2, ShieldCheck, UserCircle2, FileCode, Layers, Clock as ClockIcon,
} from 'lucide-react';
import { flattenFileTree, fuzzyMatch } from '../utils/mentions';

// ── Recents + saved searches ───────────────────────────────────────────
// We persist the 30 most-recent non-empty queries and a user-curated
// list of named "saved searches". Both are localStorage-backed because
// they're meta-workflow, not per-project content.
const RECENTS_KEY = 'lorica.omnibar.recents.v1';
const SAVED_KEY   = 'lorica.omnibar.saved.v1';
const RECENTS_MAX = 30;

function loadRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
}
function pushRecent(query) {
  if (!query?.trim()) return;
  const cur = loadRecents().filter((q) => q !== query);
  cur.unshift(query);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(cur.slice(0, RECENTS_MAX))); } catch {}
}
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
}
function saveSavedSearches(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch {}
}

// ── Source icons / colors for section headers ───────────────────────────
const SOURCES = {
  file:     { label: 'Files',    icon: FileText,   color: 'text-sky-400' },
  command:  { label: 'Commands', icon: CommandIcon,color: 'text-amber-400' },
  symbol:   { label: 'Symbols',  icon: Hash,       color: 'text-purple-400' },
  semantic: { label: 'Semantic', icon: BrainIcon,  color: 'text-pink-400' },
  agent:    { label: 'Agent',    icon: Sparkles,   color: 'text-lorica-accent' },
  recent:   { label: 'Recent',   icon: Compass,    color: 'text-emerald-400' },
  saved:    { label: 'Saved',    icon: Star,       color: 'text-amber-300' },
};

// ── Build the command catalogue (copied/adapted from the old palette) ───
// Commands live here so the Omnibar is self-contained. If you add a new
// action in App.jsx, expose it through `actions` and add a row here.
function buildCommands({ state, dispatch, onOpenFolder, onLock, actions, onCodeCanvas, onSwarmReview }) {
  return [
    { id: 'openFolder',       label: 'Open Folder',              icon: FolderOpen,        run: () => { onOpenFolder(); } },
    { id: 'toggleFileTree',   label: 'Toggle File Explorer',     icon: PanelLeftClose,    run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showFileTree' }) },
    { id: 'toggleTerminal',   label: 'Toggle Terminal',          icon: TerminalIcon,      run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showTerminal' }) },
    { id: 'toggleAgent',      label: 'Toggle AI Agent',          icon: Bot,               run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showAIPanel' }) },
    { id: 'toggleSpotify',    label: 'Toggle Spotify',           icon: Music,             run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showSpotify' }) },
    { id: 'zen',              label: state.zenMode ? 'Exit Zen Mode' : 'Enter Zen Mode', icon: state.zenMode ? Minimize : Maximize, hint: 'Ctrl+K Z', run: () => actions.toggleZen() },
    { id: 'split',            label: state.splitMode ? 'Close Split Editor' : 'Split Editor', icon: SplitSquareHorizontal, hint: 'Ctrl+\\', run: () => actions.toggleSplit() },
    { id: 'minimap',          label: state.showMinimap ? 'Hide Minimap' : 'Show Minimap', icon: Map, run: () => actions.toggleMinimap() },
    { id: 'autoSave',         label: state.autoSave ? 'Disable Auto-Save' : 'Enable Auto-Save', icon: SaveAll, run: () => actions.toggleAutoSave() },
    { id: 'blame',            label: state.blameEnabled ? 'Git Blame: Hide' : 'Git Blame: Show', icon: GitCommit, hint: 'Ctrl+Alt+B', run: () => dispatch({ type: 'TOGGLE_BLAME' }) },
    { id: 'search',           label: 'Search in Files',          icon: FileSearch,        hint: 'Ctrl+Shift+F', run: () => dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: true }) },
    { id: 'git',              label: 'Git: Status & Commit',     icon: GitBranch,         hint: 'Ctrl+Shift+G', run: () => dispatch({ type: 'SET_PANEL', panel: 'showGit', value: true }) },
    { id: 'problems',         label: 'Problems Panel',           icon: AlertTriangle,     hint: 'Ctrl+Shift+M', run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showProblems' }) },
    { id: 'debug',            label: 'Run & Debug',              icon: Bug,               run: () => dispatch({ type: 'SET_PANEL', panel: 'showDebug', value: true }) },
    { id: 'extensions',       label: 'Extensions',               icon: Package,           run: () => dispatch({ type: 'SET_PANEL', panel: 'showExtensions', value: true }) },
    { id: 'vault',            label: 'Secret Vault',             icon: Shield,            run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showSecretVault' }) },
    { id: 'audit',            label: 'Audit Log',                icon: ClipboardList,     run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showAuditLog' }) },
    { id: 'diff',             label: 'Diff Viewer',              icon: GitCompare,        run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showDiffViewer' }) },
    { id: 'snippets',         label: 'Insert Snippet',           icon: Code2,             hint: 'Ctrl+J', run: () => dispatch({ type: 'SET_PANEL', panel: 'showSnippets', value: true }) },
    { id: 'perfHUD',          label: state.showPerformanceHUD ? 'Performance HUD: Hide' : 'Performance HUD: Show', icon: Activity, hint: 'Alt+Shift+P', run: () => dispatch({ type: 'TOGGLE_PERFORMANCE_HUD' }) },
    { id: 'canvas',           label: 'Open Code Canvas',         icon: Network,           run: () => onCodeCanvas?.() },
    { id: 'swarmReview',      label: 'Multi-Agent Deep Review',  icon: Zap,               run: () => onSwarmReview?.() },
    { id: 'instantPreview',   label: state.showInstantPreview ? 'Instant Preview: Hide' : 'Instant Preview: Show', icon: Eye, run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showInstantPreview' }) },
    // ── Productivity extensions ──────────────────────────────────────────
    { id: 'bookmarksPanel',   label: 'Bookmarks: Panel',            icon: Star,             run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showBookmarksPanel' }) },
    { id: 'scratchpad',       label: 'Scratchpad',                  icon: StickyNote,       run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showScratchpad' }) },
    { id: 'todoBoard',        label: 'TODO Board',                  icon: ClipboardCheck,   run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showTodoBoard' }) },
    { id: 'clipboardHistory', label: 'Clipboard History',           icon: Clipboard,        hint: 'Ctrl+Shift+V', run: () => dispatch({ type: 'SET_PANEL', panel: 'showClipboardHistory', value: true }) },
    { id: 'apiTester',        label: 'API Tester (HTTP client)',    icon: Send,             hint: 'Ctrl+Alt+H',   run: () => dispatch({ type: 'SET_PANEL', panel: 'showApiTester', value: true }) },
    { id: 'regexBuilder',     label: 'Regex Builder',               icon: Regex,            hint: 'Ctrl+Alt+R',   run: () => dispatch({ type: 'SET_PANEL', panel: 'showRegexBuilder', value: true }) },
    { id: 'focusTimer',       label: state.showFocusTimer ? 'Focus Timer: Hide' : 'Focus Timer: Show', icon: Clock3, hint: 'Ctrl+Alt+F', run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showFocusTimer' }) },
    // ── Tier-S revolutionary trio ────────────────────────────────────────
    { id: 'heatmap',          label: state.heatmapEnabled ? 'Code Heatmap: Hide' : 'Code Heatmap: Show', icon: Flame, hint: 'Ctrl+Alt+G', run: () => dispatch({ type: 'TOGGLE_HEATMAP' }) },
    { id: 'agentBuilder',     label: 'Create Custom Agent…',        icon: Wand2,        run: () => dispatch({ type: 'SET_PANEL', panel: 'showAgentBuilder', value: true }) },
    { id: 'prReady',          label: 'PR Ready? (pre-push review)', icon: ShieldCheck,  hint: 'Ctrl+Alt+P', run: () => dispatch({ type: 'SET_PANEL', panel: 'showPrReady', value: true }) },
    { id: 'brainPanel',       label: 'Project Brain',               icon: BrainIcon,    run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showProjectBrain' }) },
    { id: 'autoFix',          label: 'Auto-Fix terminal error',     icon: Wand2,        hint: 'Ctrl+Alt+X', run: () => dispatch({ type: 'SET_PANEL', panel: 'showAutoFix', value: true }) },
    // ── Tier-Ω ───────────────────────────────────────────────────────
    { id: 'identity',         label: 'Agent Identity',              icon: UserCircle2, run: () => dispatch({ type: 'SET_PANEL', panel: 'showAgentIdentity', value: true }) },
    { id: 'sandbox',          label: 'Sandbox (Run / Replay / Probes)', icon: FileCode, hint: 'Ctrl+Alt+S', run: () => dispatch({ type: 'SET_PANEL', panel: 'showSandbox', value: true }) },
    { id: 'swarmDev',         label: 'Swarm Development',           icon: Layers,     hint: 'Ctrl+Alt+W', run: () => dispatch({ type: 'SET_PANEL', panel: 'showSwarm', value: true }) },
    { id: 'timeScrub',        label: state.showTimeScrub ? 'Time Scrub: Hide' : 'Time Scrub: Show', icon: ClockIcon, hint: 'Ctrl+Alt+T', run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showTimeScrub' }) },
    { id: 'semTypes',         label: 'Semantic Types panel',        icon: Layers,     hint: 'Ctrl+Alt+Y', run: () => dispatch({ type: 'SET_PANEL', panel: 'showSemanticTypes', value: true }) },
    { id: 'cheatsheet',       label: 'Keyboard shortcuts',          icon: CommandIcon, hint: '?',          run: () => dispatch({ type: 'SET_PANEL', panel: 'showKeyboardCheatsheet', value: true }) },
    { id: 'editHistory',      label: 'Inline AI Edit history',      icon: ClockIcon,   run: () => dispatch({ type: 'SET_PANEL', panel: 'showInlineEditHistory', value: true }) },
    { id: 'layouts',          label: 'Window layout…',              icon: Layers,      hint: 'Ctrl+Alt+L', run: () => dispatch({ type: 'SET_PANEL', panel: 'showLayoutSwitcher', value: true }) },
    { id: 'releaseNotes',     label: "What's new in Lorica",        icon: Sparkles,   run: () => dispatch({ type: 'SET_PANEL', panel: 'showReleaseNotes', value: true }) },
    { id: 'settings',         label: 'Settings',                 icon: Settings,          run: () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showSettings' }) },
    { id: 'lock',             label: 'Lock IDE',                 icon: Lock,              run: () => onLock() },
    { id: 'themeMidnight',    label: 'Theme: Midnight',          icon: Moon,              run: () => dispatch({ type: 'SET_THEME', theme: 'midnight' }) },
    { id: 'themeHacker',      label: 'Theme: Hacker Green',      icon: Palette,           run: () => dispatch({ type: 'SET_THEME', theme: 'hacker' }) },
    { id: 'themeArctic',      label: 'Theme: Arctic',            icon: Sun,               run: () => dispatch({ type: 'SET_THEME', theme: 'arctic' }) },
  ];
}

// ── Symbol extractor — lightweight per-language regex. No LSP required. ─
// Produces rows like { name, line, kind }. Good enough for navigation
// within a file without paying the LSP startup cost for quick access.
function extractSymbols(file) {
  if (!file || !file.content) return [];
  const lang = file.extension;
  const patterns = {
    js:  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|class\s+(\w+))/g,
    jsx: /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|class\s+(\w+))/g,
    ts:  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|class\s+(\w+)|interface\s+(\w+)|type\s+(\w+))/g,
    tsx: /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|class\s+(\w+)|interface\s+(\w+)|type\s+(\w+))/g,
    py:  /(?:^|\n)\s*(?:async\s+)?(?:def\s+(\w+)|class\s+(\w+))/g,
    rs:  /(?:^|\n)\s*(?:pub\s+)?(?:fn\s+(\w+)|struct\s+(\w+)|enum\s+(\w+)|trait\s+(\w+)|impl(?:\s+<[^>]+>)?\s+(\w+))/g,
    go:  /(?:^|\n)\s*(?:func\s+(?:\(\s*\w+\s+[*&]?\w+\s*\)\s*)?(\w+)|type\s+(\w+)\s+(?:struct|interface))/g,
    c:   /(?:^|\n)\s*(?:static\s+)?(?:[\w*]+\s+)+(\w+)\s*\([^)]*\)\s*{/g,
    cpp: /(?:^|\n)\s*(?:static\s+)?(?:[\w*:<>]+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?{/g,
  };
  const re = patterns[lang];
  if (!re) return [];
  const out = [];
  let m;
  const content = file.content;
  while ((m = re.exec(content)) !== null) {
    const name = m.slice(1).find(Boolean);
    if (!name || name.length < 2) continue;
    // Compute the line the match starts on (1-based).
    const line = content.slice(0, m.index).split('\n').length;
    out.push({ name, line, kind: 'symbol' });
    if (out.length >= 300) break; // Cap for huge files.
  }
  return out;
}

export default function Omnibar({
  state, dispatch,
  onOpenFolder, onLock, onFileOpen,
  actions, activeFile,
  onCodeCanvas, onSwarmReview,
}) {
  const [query, setQuery]         = useState('');
  const [semanticHits, setSemantic] = useState([]);
  const [semanticBusy, setSemBusy]  = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [recents] = useState(() => loadRecents());
  const [saved, setSaved] = useState(() => loadSaved());
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const semTimer = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelectedIdx(0); }, [query]);

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showOmnibar', value: false });

  // Pre-compute commands and files once per render.
  const commands = useMemo(
    () => buildCommands({ state, dispatch, onOpenFolder, onLock, actions, onCodeCanvas, onSwarmReview }),
    [state, dispatch, onOpenFolder, onLock, actions, onCodeCanvas, onSwarmReview],
  );
  const flatFiles = useMemo(
    () => flattenFileTree(state.fileTree || [], state.projectPath || ''),
    [state.fileTree, state.projectPath],
  );
  const symbols = useMemo(() => extractSymbols(activeFile), [activeFile?.path, activeFile?.content]);

  // ── Semantic search: debounced. Only triggers when query >= 3 chars and
  //    the project has an index (silent no-op otherwise).
  useEffect(() => {
    if (semTimer.current) clearTimeout(semTimer.current);
    setSemantic([]);
    const q = query.trim();
    if (q.length < 3 || !state.projectPath) return;
    semTimer.current = setTimeout(async () => {
      try {
        setSemBusy(true);
        const r = await window.lorica.search.semanticSearch(state.projectPath, q, 6);
        if (r && r.success !== false) {
          const hits = Array.isArray(r.data) ? r.data : (r.data?.data || []);
          setSemantic(hits);
        }
      } catch (_) {
        // index missing / failed — silent.
      } finally {
        setSemBusy(false);
      }
    }, 250);
    return () => clearTimeout(semTimer.current);
  }, [query, state.projectPath]);

  // ── Prefix routing ──
  // A leading sigil narrows the search to a single source, like VS Code's
  // `>` for commands and `@` for symbols. Power users get a deterministic
  // way to skip mixed results; beginners still get the fuzzy-across-
  // everything experience when they just start typing.
  //
  //   >foo  → commands only
  //   @foo  → symbols in active file only
  //   #foo  → semantic search only
  //   ?foo  → agent only (sends "foo" to the AI)
  //   :foo  → go to line `foo` in active file
  //
  // The prefix consumes one character; everything after it is the actual
  // query. If the query is empty after stripping the prefix we show a
  // helpful "type to search X" row rather than nothing.
  const parsePrefix = (q) => {
    const c = q[0];
    if (c === '>' || c === '@' || c === '#' || c === '?' || c === ':') {
      return { prefix: c, query: q.slice(1).trim() };
    }
    return { prefix: null, query: q };
  };

  const rows = useMemo(() => {
    const raw = query.trim();
    const { prefix, query: q } = parsePrefix(raw);
    const out = [];

    // Empty query: show saved searches + recent queries + recent files + top commands.
    if (!raw) {
      // Saved searches (user-curated) come first — they represent workflows.
      saved.slice(0, 6).forEach((s) => out.push({
        source: 'saved', label: s.name, detail: s.query,
        run: () => setQuery(s.query),
      }));
      // Recent queries — click = replay.
      recents.slice(0, 6).forEach((q) => out.push({
        source: 'recent', label: q, detail: 'recent query',
        run: () => setQuery(q),
      }));
      // Recent open files.
      state.openFiles.slice(-6).reverse().forEach((f, i) => {
        const origIdx = state.openFiles.indexOf(f);
        out.push({ source: 'recent', label: f.name, detail: f.path, run: () => { dispatch({ type: 'SET_ACTIVE_FILE', index: origIdx }); close(); } });
      });
      commands.slice(0, 10).forEach((c) => out.push({ source: 'command', label: c.label, hint: c.hint, icon: c.icon, run: () => { c.run(); close(); } }));
      return out;
    }

    // Go-to-line prefix: `:42` jumps in the active file. Valid only when
    // the remainder is numeric and there's an active file.
    if (prefix === ':' && activeFile) {
      const line = parseInt(q, 10);
      if (Number.isFinite(line) && line > 0) {
        out.push({
          source: 'symbol',
          label: `Go to line ${line}`,
          detail: activeFile.name,
          run: () => {
            dispatch({ type: 'OPEN_FILE', file: { ...activeFile, pendingGoto: { line } } });
            close();
          },
        });
      }
      return out;
    }

    // Agent-only prefix: route the whole query straight to the agent.
    if (prefix === '?') {
      out.push({
        source: 'agent',
        label: 'Ask the agent',
        detail: `"${q}"`,
        run: () => {
          dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
          dispatch({ type: 'AGENT_PREFILL_INPUT', text: q });
          close();
        },
      });
      return out;
    }

    // Source filters: only populate the requested section when a prefix is
    // set. No prefix = fill every section as before.
    const wantFiles    = !prefix;
    const wantCommands = !prefix || prefix === '>';
    const wantSymbols  = !prefix || prefix === '@';
    const wantSemantic = !prefix || prefix === '#';

    if (wantFiles) {
      fuzzyMatch(flatFiles, q, 6).forEach((f) => {
        if (f.isDirectory) return;
        out.push({
          source: 'file', label: f.name, detail: f.relPath,
          run: () => { onFileOpen(f.path); close(); },
        });
      });
    }
    if (wantCommands && q) {
      const lim = prefix ? 20 : 6;
      commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, lim)
        .forEach((c) => out.push({
          source: 'command', label: c.label, hint: c.hint, icon: c.icon,
          run: () => { c.run(); close(); },
        }));
    }
    if (wantSymbols && q && activeFile) {
      const lim = prefix ? 50 : 6;
      symbols.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).slice(0, lim)
        .forEach((s) => out.push({
          source: 'symbol',
          label: s.name,
          detail: `${activeFile.name}:${s.line}`,
          run: () => {
            dispatch({ type: 'OPEN_FILE', file: { ...activeFile, pendingGoto: { line: s.line } } });
            close();
          },
        }));
    }
    if (wantSemantic) {
      const lim = prefix ? 12 : 6;
      semanticHits.slice(0, lim).forEach((h) => out.push({
        source: 'semantic',
        label: `${(h.relative || '?')}:L${h.start_line ?? 1}`,
        detail: (h.snippet || '').split('\n')[0].slice(0, 90),
        run: () => {
          const absPath = h.absolute || `${state.projectPath}/${h.relative}`.replace(/\\/g, '/');
          const name = absPath.split(/[\\/]/).pop();
          const ext = name.includes('.') ? name.split('.').pop() : '';
          window.lorica.fs.readFile(absPath).then((r) => {
            if (r?.success) {
              dispatch({ type: 'OPEN_FILE', file: { path: absPath, name, extension: ext, content: r.data.content, dirty: false, pendingGoto: { line: h.start_line } } });
              close();
            }
          });
        },
      }));
    }

    // Agent fallback — always last when no prefix, so the user can send
    // their free-form query to the AI from any starting point.
    if (!prefix) {
      out.push({
        source: 'agent',
        label: 'Ask the agent',
        detail: `"${q}"`,
        run: () => {
          dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
          dispatch({ type: 'AGENT_PREFILL_INPUT', text: q });
          close();
        },
      });
    }

    return out;
  }, [query, flatFiles, commands, symbols, semanticHits, activeFile, state.openFiles, state.projectPath, dispatch, onFileOpen]);

  const handleKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && rows[selectedIdx]) {
      e.preventDefault();
      // Record the query into recents before firing — so the user's next
      // empty omnibar shows what they just ran.
      if (query.trim()) pushRecent(query.trim());
      rows[selectedIdx].run();
    }
  };

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  // ── Group consecutive rows of the same source for visual separation ──
  // Keeping them in the flat `rows` list means indices stay aligned with
  // keyboard navigation, but we render a section header before the first
  // occurrence of each source.
  const seenSource = new Set();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" onClick={close}>
      <div
        className="w-[640px] max-h-[70vh] lorica-glass rounded-2xl shadow-[0_0_60px_rgba(0,212,255,0.18)] overflow-hidden animate-fadeIn flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-lorica-border">
          <Search size={16} className="text-lorica-accent shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type to search · > command · @ symbol · # semantic · ? agent · :line"
            className="flex-1 bg-transparent text-sm text-lorica-text outline-none placeholder:text-lorica-textDim/60"
          />
          {semanticBusy && (
            <div className="text-[10px] text-lorica-textDim flex items-center gap-1">
              <BrainIcon size={11} className="text-pink-400 animate-pulse" /> semantic…
            </div>
          )}
          {query.trim() && !saved.some((s) => s.query === query) && (
            <button
              onClick={() => {
                const name = prompt('Save this search as…', query.slice(0, 40));
                if (!name) return;
                const next = [{ name, query, at: Date.now() }, ...saved].slice(0, 20);
                setSaved(next); saveSavedSearches(next);
              }}
              className="flex items-center gap-1 text-[10px] text-amber-300 hover:bg-amber-300/10 px-1.5 py-0.5 rounded"
              title="Save this search"
            >
              <Star size={10} /> Save
            </button>
          )}
          <kbd className="px-1.5 py-0.5 bg-lorica-bg border border-lorica-border rounded text-[9px] text-lorica-textDim font-mono">Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-lorica-textDim">No matches</div>
          ) : (
            rows.map((row, i) => {
              const first = !seenSource.has(row.source);
              if (first) seenSource.add(row.source);
              const src = SOURCES[row.source] || SOURCES.command;
              const Icon = row.icon || src.icon;
              return (
                <React.Fragment key={`${row.source}-${i}`}>
                  {first && (
                    <div className={`px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest font-semibold ${src.color} opacity-80 flex items-center gap-1.5`}>
                      <src.icon size={10} /> {src.label}
                    </div>
                  )}
                  <button
                    className={`w-full flex items-center gap-3 px-4 py-2 text-xs transition-colors ${
                      i === selectedIdx
                        ? 'bg-lorica-accent/15 text-lorica-accent'
                        : 'text-lorica-text hover:bg-lorica-accent/10 hover:text-lorica-accent'
                    }`}
                    onClick={row.run}
                    onMouseEnter={() => setSelectedIdx(i)}
                  >
                    <Icon size={14} className={`opacity-60 flex-shrink-0 ${src.color}`} />
                    <span className="flex-1 text-left truncate">{row.label}</span>
                    {row.detail && (
                      <span className="text-[10px] text-lorica-textDim truncate max-w-[220px]">{row.detail}</span>
                    )}
                    {row.hint && (
                      <kbd className="px-1.5 py-0.5 bg-lorica-bg border border-lorica-border rounded text-[9px] text-lorica-textDim font-mono flex-shrink-0">{row.hint}</kbd>
                    )}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-1.5 border-t border-lorica-border flex items-center gap-3 text-[9px] text-lorica-textDim/70">
          <span className="flex items-center gap-1"><kbd className="px-1 bg-lorica-bg border border-lorica-border rounded">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1 bg-lorica-bg border border-lorica-border rounded">↵</kbd> select</span>
          <span className="flex items-center gap-1"><kbd className="px-1 bg-lorica-bg border border-lorica-border rounded">Esc</kbd> close</span>
          <span className="ml-auto">Lorica Omnibar</span>
        </div>
      </div>
    </div>
  );
}
