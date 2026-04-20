import { useEffect, useRef, useCallback } from 'react';
import { parseShortcut, loadCustomShortcuts, getShortcut } from '../utils/keymap';

/**
 * Hook to manage dynamic keyboard shortcuts with custom overrides
 */
export function useShortcuts(state, dispatch, actions, security) {
  const customShortcutsRef = useRef({});
  const zenKeyRef = useRef(false);

  // Load custom shortcuts on mount
  useEffect(() => {
    customShortcutsRef.current = loadCustomShortcuts();
  }, []);

  // Helper to check if a shortcut matches a custom mapping
  const matchesShortcut = useCallback((e, shortcutStr) => {
    if (!shortcutStr) return false;
    
    const parsed = parseShortcut(shortcutStr);
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;
    
    // Handle multi-step shortcuts (like Ctrl+K → Z)
    if (parsed.isMultiStep) {
      // For now, we'll handle Zen Mode separately
      return false;
    }
    
    // Check modifiers
    if (parsed.ctrl !== ctrl) return false;
    if (parsed.shift !== shift) return false;
    if (parsed.alt !== alt) return false;
    
    // Check key
    let key = e.key;
    if (key === ' ') key = 'Space';
    else if (key === '`') key = '`';
    else if (key === '\\') key = '\\';
    else if (key === 'Escape') key = 'Escape';
    else if (key === 'Enter') key = 'Enter';
    else if (key === 'Tab') key = 'Tab';
    else if (key === 'Backspace') key = 'Backspace';
    else if (key === 'Delete') key = 'Delete';
    else if (key === 'ArrowUp') key = '↑';
    else if (key === 'ArrowDown') key = '↓';
    else if (key === 'ArrowLeft') key = '←';
    else if (key === 'ArrowRight') key = '→';
    else if (key.length === 1) key = key.toUpperCase();
    
    return key === parsed.key;
  }, []);

  // Main keyboard handler with custom shortcuts support
  const handleKeyDown = useCallback((e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shortcuts = customShortcutsRef.current;

    // Zen Mode step 1: Ctrl+K (hardcoded for now).
    // Exception: when the focus is inside a CodeMirror editor we let the
    // Editor's own Cmd+K handler take over (inline AI edit). The Zen sequence
    // is still accessible from anywhere outside the editor.
    if (ctrl && e.key === 'k') {
      const active = document.activeElement;
      const inEditor = active && active.closest && active.closest('.cm-editor');
      if (inEditor) {
        // Let CodeMirror handle Cmd+K → inline AI edit.
        return;
      }
      e.preventDefault();
      zenKeyRef.current = true;
      setTimeout(() => { zenKeyRef.current = false; }, 1500);
      return;
    }
    // Zen Mode step 2: Z (without Ctrl to avoid undo)
    if (zenKeyRef.current && !ctrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      zenKeyRef.current = false;
      actions.toggleZen();
      return;
    }

    // Check custom shortcuts for each action
    const checkAndExecute = (actionId, defaultHandler) => {
      const customShortcut = getShortcut(actionId, shortcuts);
      if (customShortcut && matchesShortcut(e, customShortcut)) {
        e.preventDefault();
        defaultHandler();
        return true;
      }
      return false;
    };

    // Try each action with custom shortcuts
    const handled = 
      // Editor actions
      checkAndExecute('saveFile', () => actions.saveActive()) ||
      checkAndExecute('toggleSplit', () => actions.toggleSplit()) ||
      checkAndExecute('toggleMinimap', () => actions.toggleMinimap()) ||
      checkAndExecute('toggleAutoSave', () => actions.toggleAutoSave()) ||
      
      // Panel toggles
      checkAndExecute('commandPalette', () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showCommandPalette' })) ||
      checkAndExecute('filePalette', () => dispatch({ type: 'SET_PANEL', panel: 'showFilePalette', value: true })) ||
      checkAndExecute('globalSearch', () => dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: true })) ||
      checkAndExecute('gitPanel', () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showGit' })) ||
      checkAndExecute('problemsPanel', () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showProblems' })) ||
      checkAndExecute('aiCopilot', () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showAIPanel' })) ||
      checkAndExecute('snippets', () => dispatch({ type: 'SET_PANEL', panel: 'showSnippets', value: true })) ||
      checkAndExecute('toggleSidebar', () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showFileTree' })) ||
      checkAndExecute('toggleTerminal', () => dispatch({ type: 'TOGGLE_PANEL', panel: 'showTerminal' })) ||
      checkAndExecute('lockIDE', () => security.lock()) ||
      
      // Escape (special handling)
      (getShortcut('escape', shortcuts) === 'Escape' && e.key === 'Escape' && (() => {
        const s = state; // Use state from closure
        if (s.zenMode) {
          actions.toggleZen();
        } else {
          dispatch({ type: 'SET_PANEL', panel: 'showCommandPalette', value: false });
          dispatch({ type: 'SET_PANEL', panel: 'showSettings', value: false });
          dispatch({ type: 'SET_PANEL', panel: 'showSecretVault', value: false });
          dispatch({ type: 'SET_PANEL', panel: 'showAuditLog', value: false });
          dispatch({ type: 'SET_PANEL', panel: 'showDiffViewer', value: false });
          dispatch({ type: 'SET_PANEL', panel: 'showFilePalette', value: false });
          dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: false });
          dispatch({ type: 'SET_PANEL', panel: 'showSnippets', value: false });
        }
        return true;
      })());

    // If custom shortcut handled, return
    if (handled) return;

    // Fallback to default shortcuts if no custom match
    // Default shortcuts (keep original logic as fallback)
    //
    // Ctrl+P is now the *Omnibar* — a unified surface that covers files,
    // commands, symbols, semantic search, and the agent in one place. The
    // legacy Command Palette is reachable via Ctrl+Shift+P for muscle-memory
    // users (same binding VS Code uses for commands).
    if (ctrl && !e.shiftKey && e.key === 'p') { e.preventDefault(); dispatch({ type: 'SET_PANEL', panel: 'showOmnibar', value: true }); }
    if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); dispatch({ type: 'TOGGLE_PANEL', panel: 'showCommandPalette' }); }
    // Ctrl+Shift+A — Multi-Agent Swarm deep review of the active file.
    if (ctrl && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      // Don't clash with the existing AI panel toggle (which is now Ctrl+Alt+A below).
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showAgentSwarm', value: true });
    }
    // Ctrl+Shift+N — Code Canvas (project dependency graph).
    if (ctrl && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showCodeCanvas', value: true });
    }
    // Ctrl+Alt+A — toggle the AI agent side panel (replaces old Ctrl+Shift+A).
    if (ctrl && e.altKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_PANEL', panel: 'showAIPanel' });
    }
    if (ctrl && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: true }); }
    if (ctrl && e.shiftKey && (e.key === 'G' || e.key === 'g')) { e.preventDefault(); dispatch({ type: 'TOGGLE_PANEL', panel: 'showGit' }); }
    if (ctrl && e.shiftKey && (e.key === 'M' || e.key === 'm')) { e.preventDefault(); dispatch({ type: 'TOGGLE_PANEL', panel: 'showProblems' }); }
    if (ctrl && !e.shiftKey && e.key === 'j') { e.preventDefault(); dispatch({ type: 'SET_PANEL', panel: 'showSnippets', value: true }); }
    if (ctrl && e.key === 's') { e.preventDefault(); actions.saveActive(); }
    if (ctrl && !e.shiftKey && e.key === 'b') { e.preventDefault(); dispatch({ type: 'TOGGLE_PANEL', panel: 'showFileTree' }); }
    if (ctrl && e.key === '`') { e.preventDefault(); dispatch({ type: 'TOGGLE_PANEL', panel: 'showTerminal' }); }
    // (Old Ctrl+Shift+A → AI panel binding removed; Ctrl+Shift+A now opens
    //  the Multi-Agent Swarm above, and Ctrl+Alt+A toggles the AI panel.)
    if (ctrl && e.key === 'l') { e.preventDefault(); security.lock(); }
    if (ctrl && e.key === '\\') { e.preventDefault(); actions.toggleSplit(); }
    // Alt+Shift+P — Performance HUD. Chose Alt+Shift over Ctrl+Shift to avoid
    // clashing with VS Code muscle memory (Ctrl+Shift+P = command palette).
    if (e.altKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_PERFORMANCE_HUD' });
    }
    // Ctrl+Alt+B — Git Blame toggle
    if (ctrl && e.altKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_BLAME' });
    }
    // Ctrl+Shift+V — Clipboard History picker.
    if (ctrl && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showClipboardHistory', value: true });
    }
    // Ctrl+Alt+F — Focus/Pomodoro timer toggle in status bar.
    if (ctrl && e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_PANEL', panel: 'showFocusTimer' });
    }
    // Ctrl+Alt+R — Regex Builder.
    if (ctrl && e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showRegexBuilder', value: true });
    }
    // Ctrl+Alt+H — API Tester (HTTP client).
    if (ctrl && e.altKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showApiTester', value: true });
    }
    // Ctrl+Alt+P — PR-Ready pre-flight checklist.
    if (ctrl && e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showPrReady', value: true });
    }
    // Ctrl+Alt+G — Code Heatmap toggle (think "git churn").
    if (ctrl && e.altKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_HEATMAP' });
    }
    // Ctrl+Alt+X — Auto-Fix terminal error (x for "eXorcize").
    if (ctrl && e.altKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showAutoFix', value: true });
    }
    // Ctrl+Alt+S — Sandbox (run/replay/probes).
    if (ctrl && e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showSandbox', value: true });
    }
    // Ctrl+Alt+W — sWarm development.
    if (ctrl && e.altKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showSwarm', value: true });
    }
    // Ctrl+Alt+T — Time scrub toggle.
    if (ctrl && e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_PANEL', panel: 'showTimeScrub' });
    }
    // Ctrl+Alt+L — Layout switcher.
    if (ctrl && e.altKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showLayoutSwitcher', value: true });
    }
    // Ctrl+Alt+Y — semantic tYpes panel.
    if (ctrl && e.altKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      dispatch({ type: 'SET_PANEL', panel: 'showSemanticTypes', value: true });
    }
    // ? — keyboard cheatsheet. Only when no input/textarea is focused so
    // the user can type '?' in text fields normally.
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = document.activeElement?.tagName;
      const inText = t === 'INPUT' || t === 'TEXTAREA' || document.activeElement?.isContentEditable;
      if (!inText) {
        e.preventDefault();
        dispatch({ type: 'SET_PANEL', panel: 'showKeyboardCheatsheet', value: true });
      }
    }

    if (e.key === 'Escape') {
      const s = state;
      if (s.zenMode) {
        actions.toggleZen();
      } else {
        // Close any modal-like panel. Order doesn't matter — dispatch is
        // synchronous within React 18's automatic batching, one re-render.
        dispatch({ type: 'SET_PANEL', panel: 'showCommandPalette', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showSettings', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showSecretVault', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showAuditLog', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showDiffViewer', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showFilePalette', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showSnippets', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showOmnibar', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showAgentSwarm', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showCodeCanvas', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showClipboardHistory', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showApiTester', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showRegexBuilder', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showAgentBuilder', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showPrReady', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showAutoFix', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showAgentIdentity', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showSandbox', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showSwarm', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showSemanticTypes', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showKeyboardCheatsheet', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showReleaseNotes', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showInlineEditHistory', value: false });
        dispatch({ type: 'SET_PANEL', panel: 'showLayoutSwitcher', value: false });
      }
    }
  }, [state, dispatch, actions, security, matchesShortcut]);

  // Setup keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Return function to refresh shortcuts (e.g., after settings change)
  const refreshShortcuts = useCallback(() => {
    customShortcutsRef.current = loadCustomShortcuts();
  }, []);

  return { refreshShortcuts };
}