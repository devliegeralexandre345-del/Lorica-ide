export const initialState = {
  // Project
  projectPath: null,
  fileTree: [],

  // Editor
  openFiles: [],
  activeFileIndex: -1,

  // Split Editor
  splitMode: false,
  splitFileIndex: -1,

  // Panels
  showFileTree: true,
  showAIPanel: false,
  showTerminal: true,
  showSpotify: false,
  showCommandPalette: false,
  showSettings: false,
  showSecretVault: false,
  showAuditLog: false,
  showDiffViewer: false,
  showSearch: false,
  showGit: false,
  showFilePalette: false,
  showExtensions: false,
  showDebug: false,
  showProblems: false,
  showSnippets: false,
  showOutline: false,
  showTimeline: false,

  // Zen Mode
  zenMode: false,
  _preZenState: null, // stored panel state before entering zen

  // Security
  isLocked: false,
  vaultInitialized: false,
  vaultUnlocked: false,
  securityAlerts: [],
  autoLockMinutes: 5,

  // AI (legacy copilot — conservé pour compatibilité)
  aiMessages: [],
  aiLoading: false,
  aiApiKey: '',
  aiProvider: 'anthropic',     // 'anthropic' | 'deepseek'
  aiDeepseekKey: '',

  // Inline AI ghost-text completion (Copilot-style)
  aiInlineEnabled: false,

  // Agent Copilot
  agentMessages: [],        // [{ id, role, content, toolCalls }]
  agentLoading: false,
  agentConfig: null,        // { context, permissions, autoApprove, model }
  agentSessionActive: false,
  agentUsage: null,         // { input_tokens, output_tokens, prompt_tokens, completion_tokens, total_tokens }

  // Spotify
  spotifyTrack: null,

  // Theme
  theme: 'spectre',

  // Auto-save
  autoSave: false,
  autoSaveDelay: 1000,

  // Toasts
  toasts: [],

  // Status
  statusMessage: 'Ready',

  // Minimap
  showMinimap: true,

  // Git blame gutter — off by default (quieter default), toggled via
  // command palette, status bar chip, or keyboard.
  blameEnabled: false,

  // Performance HUD — tiny fps/memory/ai-latency overlay for the "how fast
  // is my IDE right now" power-user question. Off by default.
  showPerformanceHUD: false,

  // Prefill slot for the Agent Copilot input. When non-null, AgentCopilot
  // pulls the value into its input field and clears it — lets other
  // components (editor quick-actions, command palette) push a question
  // into the chat without hijacking focus or sending immediately.
  agentInputPrefill: null,

  // Omnibar — the universal Cmd+P surface that has replaced the old
  // FilePalette and CommandPalette (both still exist as lazy chunks but
  // are no longer the primary entry point).
  showOmnibar: false,

  // Multi-Agent Swarm panel — parallel specialized review.
  showAgentSwarm: false,

  // Code Canvas — interactive project dependency graph.
  showCodeCanvas: false,

  // Instant Preview side rail — auto-routed visualizer for the active file.
  showInstantPreview: false,

  // ── Productivity extensions ────────────────────────────────────────────
  // Each one is a self-contained native tool exposed through the Dock,
  // Omnibar, and (for the relevant ones) a keyboard shortcut. They all
  // persist their own state (localStorage or .lorica/ JSON) so this
  // reducer only tracks VISIBILITY toggles, not content.

  // Bookmarks — {[absPath]: number[] of 1-indexed line numbers}.
  // Hydrated synchronously from localStorage so the gutter renders them
  // on first paint without a flash.
  bookmarks: (() => {
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem('lorica.bookmarks.v1');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  })(),
  // Rich per-bookmark metadata: {[path]: {[line]: {note, group}}}
  bookmarkDetails: (() => {
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem('lorica.bookmarksDetails.v1');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  })(),
  showBookmarksPanel: false,

  // Scratchpad — project-scoped markdown notes panel.
  showScratchpad: false,

  // TODO Board — kanban, content lives in .lorica/todos.json.
  showTodoBoard: false,

  // Clipboard history — cap-N list of recent copied text, persisted.
  clipboardItems: [],            // [{ id, text, at }]
  showClipboardHistory: false,

  // API Tester — Postman-lite modal.
  showApiTester: false,

  // Focus/Pomodoro — UI lives in the status bar when true.
  showFocusTimer: false,

  // Regex Builder modal.
  showRegexBuilder: false,

  // Code Heatmap — churn-based tinting over the file tree.
  heatmapEnabled: false,
  heatmapRange: 30, // days

  // Custom agents loaded from .lorica/agents/*.json for the active project.
  customAgents: [],
  showAgentBuilder: false,

  // PR-Ready Checklist modal.
  showPrReady: false,

  // ── Project Brain ──────────────────────────────────────────────────
  // Durable project memory: decisions, facts, glossary, milestones. Lives
  // in `.lorica/brain/*.md` with YAML frontmatter. Entries commit with
  // the repo and are shared by the whole team.
  brainEntries: [],
  showProjectBrain: false,
  // Toggle: inject the brain preamble into new agent sessions. Off by
  // default because some users might not want the tokens; flip it on from
  // the brain panel when it feels useful.
  brainInAgent: true,

  // ── Auto-Fix Loop ─────────────────────────────────────────────────
  showAutoFix: false,
  // Rolling capture of the last ~8 KB of terminal output. Used by the
  // Auto-Fix Loop to seed the agent with recent error context without
  // having to re-run anything. Updated from Terminal.jsx.
  terminalTail: '',
  // The last command the terminal ran. Captured by Terminal.jsx when the
  // user presses Enter on a non-empty line. Used by the Auto-Fix Loop to
  // re-run the command after applying a fix.
  terminalLastCommand: '',
  terminalCwd: '',

  // ── Tier-Ω features ─────────────────────────────────────────────────
  showAgentIdentity: false,
  agentIdentity: null, // {name, tone, verbosity, proactivity, styleNotes, personalMemory[]}

  // Time Scrub
  showTimeScrub: false,

  // Sandbox modal (Run / Replay / Probes)
  showSandbox: false,

  // Semantic Types store: per-file inferred marks
  semanticTypes: {},
  showSemanticTypes: false,
  // Auto-run inference on save (debounced). Opt-in.
  semanticAutoEnabled: false,

  // Swarm Development
  showSwarm: false,

  // Keyboard cheatsheet
  showKeyboardCheatsheet: false,
  // Inline AI edit history browser
  showInlineEditHistory: false,

  // Layout profile switcher
  showLayoutSwitcher: false,

  // Welcome-to-new-version modal (one-shot per version).
  showReleaseNotes: false,

  // Predicted next-edit suggestions surfaced after an inline AI edit is
  // accepted. Shape: { loading: bool, suggestions: [{path, reason, instruction}] } | null
  nextEditSuggestions: null,

  // Updates
  updateInfo: {
    available: false,
    latestVersion: null,
    downloadUrl: null,
    releaseNotes: null,
    isInstalling: false,
    isChecking: false,
  },
};

let toastId = 0;

export function appReducer(state, action) {
  switch (action.type) {
    case 'SET_PROJECT':
      return { ...state, projectPath: action.path, fileTree: action.tree };
    case 'SET_FILE_TREE':
      return { ...state, fileTree: action.tree };
    case 'OPEN_FILE': {
      const existingIdx = state.openFiles.findIndex((f) => f.path === action.file.path);
      // If the caller asked to scroll to a line, stamp the request on the
      // file object. The Editor consumes + clears it on mount / file change.
      // Timestamp ensures repeated jumps to the same line re-trigger the
      // effect (React compares by reference / value, identical objects don't).
      const pendingGoto = action.file.pendingGoto
        ? { ...action.file.pendingGoto, _ts: Date.now() }
        : null;

      if (existingIdx >= 0) {
        // Already open — switch to that tab. If a pendingGoto was passed,
        // merge it in so Editor jumps to the requested line.
        const openFiles = pendingGoto
          ? state.openFiles.map((f, i) =>
              i === existingIdx ? { ...f, pendingGoto } : f)
          : state.openFiles;
        return { ...state, openFiles, activeFileIndex: existingIdx };
      }
      return {
        ...state,
        openFiles: [...state.openFiles, { ...action.file, pendingGoto }],
        activeFileIndex: state.openFiles.length,
      };
    }
    case 'CLEAR_PENDING_GOTO': {
      // Editor calls this once the scroll has been applied.
      const { index } = action;
      if (index < 0 || index >= state.openFiles.length) return state;
      const openFiles = state.openFiles.map((f, i) =>
        i === index ? { ...f, pendingGoto: null } : f);
      return { ...state, openFiles };
    }
    case 'CLOSE_FILE': {
      const newFiles = state.openFiles.filter((_, i) => i !== action.index);
      let newActive = state.activeFileIndex;
      if (action.index <= state.activeFileIndex) {
        newActive = Math.max(0, state.activeFileIndex - 1);
      }
      if (newFiles.length === 0) newActive = -1;
      let splitIdx = state.splitFileIndex;
      let splitMode = state.splitMode;
      if (action.index === state.splitFileIndex) {
        splitIdx = -1;
        splitMode = false;
      } else if (action.index < state.splitFileIndex) {
        splitIdx = state.splitFileIndex - 1;
      }
      return { ...state, openFiles: newFiles, activeFileIndex: newActive, splitFileIndex: splitIdx, splitMode: newFiles.length < 2 ? false : splitMode };
    }
    case 'SET_ACTIVE_FILE':
      return { ...state, activeFileIndex: action.index };
    case 'UPDATE_FILE_CONTENT': {
      const files = [...state.openFiles];
      if (files[action.index]) {
        files[action.index] = { ...files[action.index], content: action.content, dirty: true };
      }
      return { ...state, openFiles: files };
    }
    case 'MARK_FILE_SAVED': {
      const files = [...state.openFiles];
      if (files[action.index]) {
        files[action.index] = { ...files[action.index], dirty: false };
      }
      return { ...state, openFiles: files };
    }
    case 'TOGGLE_PANEL':
      return { ...state, [action.panel]: !state[action.panel] };
    case 'SET_PANEL':
      return { ...state, [action.panel]: action.value };
    case 'SET_LOCKED':
      return { ...state, isLocked: action.value };
    case 'SET_VAULT_STATE':
      return { ...state, vaultInitialized: action.initialized, vaultUnlocked: action.unlocked };
    case 'SET_SECURITY_ALERTS':
      return { ...state, securityAlerts: action.alerts };
    case 'ADD_AI_MESSAGE':
      return { ...state, aiMessages: [...state.aiMessages, action.message] };
    case 'SET_AI_LOADING':
      return { ...state, aiLoading: action.value };
    case 'AGENT_SET_CONFIG':
      return {
        ...state,
        agentConfig: action.config,
        agentSessionActive: true,
        agentMessages: [],
      };
    case 'AGENT_ADD_MESSAGE': {
      const msg = { ...action.message, id: Date.now() + Math.random(), toolCalls: action.message.toolCalls || [] };
      return { ...state, agentMessages: [...state.agentMessages, msg] };
    }
    case 'AGENT_APPEND_STREAM': {
      const msgs = [...state.agentMessages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + action.text };
      }
      return { ...state, agentMessages: msgs };
    }
    case 'AGENT_ADD_TOOL_CALL': {
      const msgs = [...state.agentMessages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = {
          ...last,
          toolCalls: [...(last.toolCalls || []), action.toolCall],
        };
      }
      return { ...state, agentMessages: msgs };
    }
    case 'AGENT_UPDATE_TOOL_CALL': {
      const msgs = state.agentMessages.map((msg) => {
        if (!msg.toolCalls) return msg;
        const updated = msg.toolCalls.map((tc) =>
          tc.id === action.id ? { ...tc, ...action.updates } : tc
        );
        return { ...msg, toolCalls: updated };
      });
      return { ...state, agentMessages: msgs };
    }
    case 'AGENT_SET_LOADING':
      return { ...state, agentLoading: action.value };
    case 'AGENT_SET_MESSAGES':
      return { ...state, agentMessages: action.messages };
    case 'AGENT_UPDATE_USAGE': {
      const prev = state.agentUsage || {};
      const next = action.usage || {};
      // Merge cumulatively (sum input/output tokens from multiple turns)
      const merged = { ...prev };
      for (const [k, v] of Object.entries(next)) {
        if (typeof v === 'number') {
          merged[k] = (prev[k] || 0) + v;
        } else {
          merged[k] = v;
        }
      }
      return { ...state, agentUsage: merged };
    }
    case 'AGENT_CLEAR':
      return { ...state, agentMessages: [], agentLoading: false, agentSessionActive: false, agentConfig: null, agentUsage: null };
    case 'SET_AI_KEY':
      return { ...state, aiApiKey: action.key };
    case 'SET_AI_PROVIDER':
      return { ...state, aiProvider: action.provider };
    case 'SET_DEEPSEEK_KEY':
      return { ...state, aiDeepseekKey: action.key };
    case 'SET_AI_INLINE_ENABLED':
      return { ...state, aiInlineEnabled: !!action.value };
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    case 'SET_STATUS':
      return { ...state, statusMessage: action.message };
    case 'SET_AUTO_LOCK':
      return { ...state, autoLockMinutes: action.minutes };

    // ====== UPDATES ======
    case 'SET_UPDATE_INFO':
      return {
        ...state,
        updateInfo: {
          ...state.updateInfo,
          available: action.available ?? state.updateInfo.available,
          latestVersion: action.latestVersion ?? state.updateInfo.latestVersion,
          downloadUrl: action.downloadUrl ?? state.updateInfo.downloadUrl,
          releaseNotes: action.releaseNotes ?? state.updateInfo.releaseNotes,
          isChecking: action.isChecking ?? state.updateInfo.isChecking,
        },
      };
    case 'SET_UPDATE_INSTALLING':
      return {
        ...state,
        updateInfo: {
          ...state.updateInfo,
          isInstalling: action.isInstalling,
        },
      };

    // ====== ZEN MODE ======
    case 'ENTER_ZEN': {
      return {
        ...state,
        zenMode: true,
        _preZenState: {
          showFileTree: state.showFileTree,
          showTerminal: state.showTerminal,
          showAIPanel: state.showAIPanel,
          showSpotify: state.showSpotify,
        },
        showFileTree: false,
        showTerminal: false,
        showAIPanel: false,
        showSpotify: false,
      };
    }
    case 'EXIT_ZEN': {
      const prev = state._preZenState || {};
      return {
        ...state,
        zenMode: false,
        showFileTree: prev.showFileTree ?? true,
        showTerminal: prev.showTerminal ?? true,
        showAIPanel: prev.showAIPanel ?? false,
        showSpotify: prev.showSpotify ?? false,
        _preZenState: null,
      };
    }

    // ====== SPLIT EDITOR ======
    case 'SET_SPLIT':
      return { ...state, splitMode: action.mode, splitFileIndex: action.fileIndex ?? -1 };

    // ====== AUTO SAVE ======
    case 'SET_AUTO_SAVE':
      return { ...state, autoSave: action.value };
    case 'SET_AUTO_SAVE_DELAY':
      return { ...state, autoSaveDelay: action.delay };

    // ====== MINIMAP ======
    case 'SET_MINIMAP':
      return { ...state, showMinimap: action.value };

    // ====== GIT BLAME ======
    case 'SET_BLAME_ENABLED':
      return { ...state, blameEnabled: !!action.value };
    case 'TOGGLE_BLAME':
      return { ...state, blameEnabled: !state.blameEnabled };

    // ====== PERFORMANCE HUD ======
    case 'TOGGLE_PERFORMANCE_HUD':
      return { ...state, showPerformanceHUD: !state.showPerformanceHUD };

    // ====== AGENT INPUT PREFILL ======
    case 'AGENT_PREFILL_INPUT':
      return { ...state, agentInputPrefill: action.text };
    case 'AGENT_CLEAR_PREFILL':
      return { ...state, agentInputPrefill: null };

    // ====== NEXT-EDIT PREDICTIONS ======
    case 'SET_NEXT_EDITS':
      return { ...state, nextEditSuggestions: action.value };
    case 'CLEAR_NEXT_EDITS':
      return { ...state, nextEditSuggestions: null };

    // ====== BOOKMARKS ======
    //
    // Bookmarks storage is a two-layer structure to stay backward-compat:
    //   state.bookmarks = { [path]: number[] }  (legacy line-list, read by gutter)
    //   state.bookmarkDetails = { [path]: { [line]: {note, group} } }
    //
    // Toggle removes both layers in sync; an "add with note" action goes
    // through ADD_BOOKMARK_WITH_NOTE.
    case 'TOGGLE_BOOKMARK': {
      const { path, line } = action;
      if (!path || !line) return state;
      const cur = state.bookmarks?.[path] || [];
      const exists = cur.includes(line);
      const next = exists ? cur.filter((l) => l !== line) : [...cur, line].sort((a, b) => a - b);
      const bookmarks = { ...state.bookmarks };
      if (next.length === 0) delete bookmarks[path];
      else bookmarks[path] = next;
      // Clean out any detail for removed lines.
      const details = { ...state.bookmarkDetails };
      if (exists && details[path]) {
        const fresh = { ...details[path] };
        delete fresh[line];
        if (Object.keys(fresh).length === 0) delete details[path];
        else details[path] = fresh;
      }
      try { localStorage.setItem('lorica.bookmarks.v1', JSON.stringify(bookmarks)); } catch {}
      try { localStorage.setItem('lorica.bookmarksDetails.v1', JSON.stringify(details)); } catch {}
      return { ...state, bookmarks, bookmarkDetails: details };
    }
    case 'SET_BOOKMARK_DETAILS': {
      const { path, line, note, group } = action;
      if (!path || !line) return state;
      const details = { ...state.bookmarkDetails };
      const fresh = { ...(details[path] || {}) };
      fresh[line] = { note: note ?? '', group: group ?? fresh[line]?.group ?? '' };
      details[path] = fresh;
      try { localStorage.setItem('lorica.bookmarksDetails.v1', JSON.stringify(details)); } catch {}
      return { ...state, bookmarkDetails: details };
    }
    case 'SET_BOOKMARKS':
      return { ...state, bookmarks: action.bookmarks || {} };
    case 'CLEAR_BOOKMARKS': {
      try { localStorage.removeItem('lorica.bookmarks.v1'); } catch {}
      try { localStorage.removeItem('lorica.bookmarksDetails.v1'); } catch {}
      return { ...state, bookmarks: {}, bookmarkDetails: {} };
    }

    // ====== CLIPBOARD HISTORY ======
    case 'CLIPBOARD_SET':
      return { ...state, clipboardItems: action.items || [] };
    case 'CLIPBOARD_PUSH': {
      const text = action.text;
      if (!text) return state;
      // Dedupe: if the top item matches, bump its timestamp but don't add.
      const existing = (state.clipboardItems || []).findIndex((it) => it.text === text);
      let items;
      if (existing !== -1) {
        const it = { ...state.clipboardItems[existing], at: Date.now() };
        items = [it, ...state.clipboardItems.filter((_, i) => i !== existing)];
      } else {
        items = [{ id: `${Date.now()}-${Math.random()}`, text, at: Date.now(), pinned: false }, ...(state.clipboardItems || [])];
      }
      // Keep ALL pinned entries + up to 30 non-pinned.
      const pinned = items.filter((it) => it.pinned);
      const rest   = items.filter((it) => !it.pinned).slice(0, 30);
      items = [...pinned, ...rest];
      try { localStorage.setItem('lorica.clipboard.v1', JSON.stringify(items)); } catch {}
      return { ...state, clipboardItems: items };
    }
    case 'CLIPBOARD_TOGGLE_PIN': {
      const items = (state.clipboardItems || []).map((it) =>
        it.text === action.text ? { ...it, pinned: !it.pinned } : it
      );
      try { localStorage.setItem('lorica.clipboard.v1', JSON.stringify(items)); } catch {}
      return { ...state, clipboardItems: items };
    }
    case 'CLIPBOARD_REMOVE': {
      const items = (state.clipboardItems || []).filter((it) => it.text !== action.text);
      try { localStorage.setItem('lorica.clipboard.v1', JSON.stringify(items)); } catch {}
      return { ...state, clipboardItems: items };
    }
    case 'CLIPBOARD_CLEAR':
      try { localStorage.removeItem('lorica.clipboard.v1'); } catch {}
      return { ...state, clipboardItems: [] };

    // ====== HEATMAP ======
    case 'TOGGLE_HEATMAP':
      return { ...state, heatmapEnabled: !state.heatmapEnabled };
    case 'SET_HEATMAP_RANGE':
      return { ...state, heatmapRange: action.days };

    // ====== CUSTOM AGENTS ======
    case 'SET_CUSTOM_AGENTS':
      return { ...state, customAgents: action.agents || [] };

    // ====== PROJECT BRAIN ======
    case 'SET_BRAIN_ENTRIES':
      return { ...state, brainEntries: action.entries || [] };
    case 'TOGGLE_BRAIN_IN_AGENT':
      return { ...state, brainInAgent: !state.brainInAgent };

    // ====== TERMINAL CAPTURE (Auto-Fix) ======
    case 'TERMINAL_APPEND': {
      // Cap the rolling tail at ~8 KB — enough to hold a decent stack
      // trace or cargo error without eating unbounded memory on long
      // sessions.
      const next = (state.terminalTail + (action.chunk || '')).slice(-8192);
      return { ...state, terminalTail: next };
    }
    case 'TERMINAL_CLEAR':
      return { ...state, terminalTail: '' };
    case 'TERMINAL_SET_LAST_COMMAND':
      return { ...state, terminalLastCommand: action.command || '', terminalCwd: action.cwd || state.terminalCwd };

    // ====== TIER-Ω ======
    case 'SET_AGENT_IDENTITY':
      return { ...state, agentIdentity: action.identity };
    case 'SET_SEMANTIC_TYPES':
      return { ...state, semanticTypes: action.store || {} };
    case 'UPDATE_SEMANTIC_FILE':
      return { ...state, semanticTypes: { ...state.semanticTypes, [action.path]: action.entry } };
    case 'TOGGLE_SEMANTIC_AUTO':
      return { ...state, semanticAutoEnabled: !state.semanticAutoEnabled };

    // ====== TOASTS ======
    // Dedupe rule: if a toast with the same `message` was added in the
    // last 2 seconds we just refresh the timestamp instead of stacking a
    // copy. Stops the classic "settings saved" spam when a user mashes a
    // toggle or when a background loop re-fires.
    case 'ADD_TOAST': {
      const now = Date.now();
      const incoming = action.toast || {};
      const existing = state.toasts || [];
      const dupIdx = existing.findIndex((t) =>
        t.message === incoming.message && (now - (t.bornAt || 0)) < 2000
      );
      if (dupIdx !== -1) {
        // Move the duplicate to the end with a fresh timestamp so it
        // stays visible but doesn't create a second notification.
        const renewed = { ...existing[dupIdx], bornAt: now };
        const next = [...existing.filter((_, i) => i !== dupIdx), renewed];
        return { ...state, toasts: next };
      }
      const id = ++toastId;
      return {
        ...state,
        toasts: [...existing, { id, bornAt: now, ...incoming }],
      };
    }
    case 'REMOVE_TOAST':
      return { ...state, toasts: (state.toasts || []).filter((t) => t.id !== action.id) };

    // ====== REORDER TABS ======
    case 'REORDER_TABS': {
      const files = [...state.openFiles];
      const [moved] = files.splice(action.from, 1);
      files.splice(action.to, 0, moved);
      let newActiveIdx = state.activeFileIndex;
      if (state.activeFileIndex === action.from) {
        newActiveIdx = action.to;
      } else if (action.from < state.activeFileIndex && action.to >= state.activeFileIndex) {
        newActiveIdx = state.activeFileIndex - 1;
      } else if (action.from > state.activeFileIndex && action.to <= state.activeFileIndex) {
        newActiveIdx = state.activeFileIndex + 1;
      }
      return { ...state, openFiles: files, activeFileIndex: newActiveIdx };
    }

    default:
      return state;
  }
}
