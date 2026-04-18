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

    // ====== TOASTS ======
    case 'ADD_TOAST': {
      const id = ++toastId;
      return { ...state, toasts: [...(state.toasts || []), { id, ...action.toast }] };
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
