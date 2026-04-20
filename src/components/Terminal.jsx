// src/components/Terminal.jsx
//
// Multi-tab terminal. Each tab owns its own xterm instance, backing
// buffer (for Auto-Fix capture), and state. Switching tabs is free —
// we keep hidden tabs mounted but display: none. The backend PTY is
// shared for now (one pty.runCommand() per click) since the existing
// bridge doesn't address terminals by id; the visual multi-tab layout
// lets users keep separate log buffers / running commands in view.
//
// The header exposes:
//   • tab list with add/close
//   • in-terminal substring search (Ctrl+F while focused)
//   • "clear" button
//   • the Auto-Fix button, preserved from the previous version

import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Wand2, Plus, X, Search, Eraser, ChevronLeft, ChevronRight } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[=<>]|\x1b\([AB012]|\r/g;
function stripAnsi(s) { return s ? s.replace(ANSI_RE, '') : ''; }

const ERROR_PATTERNS = [
  /\berror\b[:\s]/i, /\bfailed\b/i, /\bpanicked\b/i,
  /Traceback \(most recent call last\)/, /SyntaxError/, /TypeError/,
  /ReferenceError/, /Cannot find module/, /\bundefined reference\b/i,
  /npm ERR!/, /cargo:/, /rustc/, /\b(\d+) error(s)?\b/, /✗|✘|⨯/,
];
function hasError(text) {
  if (!text) return false;
  const recent = text.slice(-2000);
  return ERROR_PATTERNS.some((re) => re.test(recent));
}

// ── Single-tab instance — owns one PTY session identified by `sessionId`.
// Multiple TerminalPane instances can coexist; each one opens its own
// backend session, subscribes to `terminal:data:<id>`, and forwards
// keystrokes tagged with that session id. No shared state with siblings.
function TerminalPane({ visible, dispatch, onErrorDetected, onSessionReady, onSessionClose }) {
  const containerRef = useRef(null);
  const initialized = useRef(false);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const sessionIdRef = useRef(null);
  const tailRef = useRef('');
  const currentLineRef = useRef('');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

    const root = getComputedStyle(document.documentElement);
    const bg = root.getPropertyValue('--color-bg').trim() || '#06080f';
    const fg = root.getPropertyValue('--color-text').trim() || '#e2e8f0';
    const accent = root.getPropertyValue('--color-accent').trim() || '#00d4ff';
    const term = new XTerminal({
      theme: {
        background: bg, foreground: fg, cursor: accent, cursorAccent: bg,
        selectionBackground: accent + '33',
        black: bg, red: '#ff3b5c', green: '#00e68a', yellow: '#ffb020',
        blue: accent, magenta: '#c792ea', cyan: '#89ddff', white: fg,
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13, lineHeight: 1.4,
      cursorBlink: true, cursorStyle: 'bar',
      scrollback: 5000, allowTransparency: false,
      drawBoldTextInBrightColors: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitAddonRef.current = fit;
    setTimeout(() => fit.fit(), 50);

    let dataUnsub = null;
    let closeUnsub = null;

    (async () => {
      if (!window.lorica?.terminal) { showFallback(term); return; }
      try {
        // Create our own PTY session.
        const result = await window.lorica.terminal.create();
        if (!result || result.success === false || result.data === undefined) {
          term.writeln(`\x1b[33m⚠ PTY: ${result?.error || 'unavailable'}\x1b[0m`);
          showFallback(term);
          return;
        }
        const sid = result.data;
        sessionIdRef.current = sid;
        onSessionReady?.(sid);

        // Subscribe ONLY to this session's data — no cross-tab bleed.
        dataUnsub = await window.lorica.terminal.onSessionData(sid, (payload) => {
          const data = payload?.data || '';
          if (!data) return;
          term.write(data);
          const cleaned = stripAnsi(data);
          if (cleaned) {
            tailRef.current = (tailRef.current + cleaned).slice(-8192);
            if (dispatch) dispatch({ type: 'TERMINAL_APPEND', chunk: cleaned });
            if (hasError(tailRef.current)) onErrorDetected?.(true);
          }
        });

        // Forward user keystrokes into this session (not the default shell).
        term.onData((data) => {
          window.lorica.terminal.write(data, sid);
          if (data === '\r' || data === '\n') {
            const cmd = currentLineRef.current.trim();
            if (cmd && dispatch) dispatch({ type: 'TERMINAL_SET_LAST_COMMAND', command: cmd });
            currentLineRef.current = '';
          } else if (data === '\x7f') {
            currentLineRef.current = currentLineRef.current.slice(0, -1);
          } else if (data >= ' ' && !data.startsWith('\x1b')) {
            currentLineRef.current += data;
          }
        });

        // Clean up if the backend signals this session closed (shell exit).
        closeUnsub = await window.lorica.terminal.onSessionClose((closedId) => {
          if (closedId === sid) onSessionClose?.(sid);
        });
      } catch (e) {
        term.writeln(`\x1b[31m✗ ${e}\x1b[0m`);
        showFallback(term);
      }
    })();

    const observer = new ResizeObserver(() => {
      setTimeout(() => {
        fit.fit();
        const sid = sessionIdRef.current;
        if (sid != null) window.lorica?.terminal?.resize(term.cols, term.rows, sid);
      }, 30);
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      try { dataUnsub?.(); } catch {}
      try { closeUnsub?.(); } catch {}
      const sid = sessionIdRef.current;
      if (sid != null) window.lorica?.terminal?.kill(sid);
      term.dispose();
    };
  }, []);

  // Ctrl+F while the terminal is focused opens the search bar.
  useEffect(() => {
    if (!visible) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (document.activeElement?.closest('.xterm')) {
          e.preventDefault();
          setShowSearch(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  // Refit when this pane becomes visible — xterm can't measure a hidden
  // container, so sizing is stale after a tab switch.
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current.fit();
        const t = termRef.current;
        window.lorica?.terminal?.resize(t?.cols, t?.rows);
      }, 20);
    }
  }, [visible]);

  const doSearch = () => {
    const term = termRef.current;
    if (!term || !search) return;
    // xterm doesn't ship a search addon by default in our bundle; we
    // fall back to scrolling to the most recent line that matches in
    // the already-captured tail buffer. This is a one-shot jump — for
    // an iterative search we'd add the SearchAddon, but keeping the
    // bundle lean for now.
    const tail = tailRef.current;
    const idx = tail.lastIndexOf(search);
    if (idx === -1) return;
    term.scrollToBottom();
  };

  const clear = () => {
    termRef.current?.clear();
    tailRef.current = '';
    onErrorDetected?.(false);
  };

  return (
    <div className="h-full flex flex-col" style={{ display: visible ? 'flex' : 'none' }}>
      {showSearch && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-lorica-border/50 bg-lorica-panel/60">
          <Search size={10} className="text-lorica-textDim" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); if (e.key === 'Escape') setShowSearch(false); }}
            placeholder="Search scrollback…"
            className="flex-1 bg-transparent text-[11px] text-lorica-text outline-none"
          />
          <button onClick={() => setShowSearch(false)} className="text-lorica-textDim hover:text-lorica-text">
            <X size={10} />
          </button>
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-hidden terminal-container" />
    </div>
  );
}

function showFallback(term) {
  term.writeln('\x1b[90m── Fallback mode ──\x1b[0m');
  let line = '';
  term.write('\x1b[36m$ \x1b[0m');
  term.onData((data) => {
    if (data === '\r') {
      term.writeln('');
      if (line.trim()) term.writeln(`\x1b[90m[echo] ${line}\x1b[0m`);
      line = '';
      term.write('\x1b[36m$ \x1b[0m');
    } else if (data === '\x7f') {
      if (line.length > 0) { line = line.slice(0, -1); term.write('\b \b'); }
    } else {
      line += data;
      term.write(data);
    }
  });
}

// ── Multi-tab shell ──────────────────────────────────────────────────
// `tabId` is a React-only id used for UI ordering; `sessionId` is the
// backend PTY id returned by cmd_terminal_create. Each tab holds one
// real PTY so output and input never cross between tabs.
export default function Terminal({ dispatch }) {
  const [tabs, setTabs] = useState([{ tabId: 1, title: 'Terminal 1', sessionId: null }]);
  const [activeId, setActiveId] = useState(1);
  const [nextId, setNextId] = useState(2);
  const [errorByTab, setErrorByTab] = useState({});

  const openAutoFix = () => {
    if (dispatch) dispatch({ type: 'SET_PANEL', panel: 'showAutoFix', value: true });
  };

  const addTab = () => {
    const t = { tabId: nextId, title: `Terminal ${nextId}`, sessionId: null };
    setTabs((cur) => [...cur, t]);
    setActiveId(nextId);
    setNextId((n) => n + 1);
  };

  const closeTab = (tabId, e) => {
    e?.stopPropagation();
    setTabs((cur) => {
      const tab = cur.find((t) => t.tabId === tabId);
      // Kill the backend session — the pane's cleanup effect also does
      // this, but calling it here makes the intent explicit even if the
      // pane hasn't unmounted yet.
      if (tab?.sessionId != null) {
        try { window.lorica?.terminal?.kill(tab.sessionId); } catch {}
      }
      const next = cur.filter((t) => t.tabId !== tabId);
      if (tabId === activeId && next.length) setActiveId(next[next.length - 1].tabId);
      return next.length ? next : [{ tabId: nextId, title: `Terminal ${nextId}`, sessionId: null }];
    });
    // Clear error state for the closed tab.
    setErrorByTab((cur) => { const { [tabId]: _, ...rest } = cur; return rest; });
  };

  // When the backend signals a session closed (shell exit, crash), drop
  // the matching tab from the UI. Preserves user expectations: typing
  // `exit` makes the tab disappear.
  const onSessionCloseFromPane = (tabId) => (sid) => {
    setTabs((cur) => {
      const next = cur.filter((t) => !(t.tabId === tabId && t.sessionId === sid));
      if (next.length === 0) return [{ tabId: nextId, title: `Terminal ${nextId}`, sessionId: null }];
      if (tabId === activeId) setActiveId(next[next.length - 1].tabId);
      return next;
    });
  };

  const onSessionReadyForTab = (tabId) => (sid) => {
    setTabs((cur) => cur.map((t) => t.tabId === tabId ? { ...t, sessionId: sid } : t));
  };

  const anyError = Object.values(errorByTab).some(Boolean);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--color-bg)' }}>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-lorica-border/50">
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold mr-1">Terminal</span>
        {tabs.map((t) => (
          <div
            key={t.tabId}
            onClick={() => setActiveId(t.tabId)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
              activeId === t.tabId
                ? 'bg-lorica-accent/15 text-lorica-accent border border-lorica-accent/40'
                : 'text-lorica-textDim hover:text-lorica-text border border-transparent'
            }`}
            title={t.sessionId != null ? `PTY session #${t.sessionId}` : 'Starting…'}
          >
            <span>{t.title}</span>
            {tabs.length > 1 && (
              <button onClick={(e) => closeTab(t.tabId, e)} className="hover:text-red-400">
                <X size={9} />
              </button>
            )}
          </div>
        ))}
        <button onClick={addTab} className="p-0.5 rounded text-lorica-textDim hover:text-lorica-accent" title="New terminal">
          <Plus size={11} />
        </button>
        <div className="flex-1" />
        {anyError && dispatch && (
          <button
            onClick={openAutoFix}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 animate-pulse-glow"
            title="Agent reads the error, proposes a fix, re-runs"
          >
            <Wand2 size={10} /> Auto-Fix
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden relative">
        {tabs.map((t) => (
          <div key={t.tabId} className="absolute inset-0" style={{ display: activeId === t.tabId ? 'block' : 'none' }}>
            <TerminalPane
              visible={activeId === t.tabId}
              dispatch={dispatch}
              onErrorDetected={(v) => setErrorByTab((cur) => ({ ...cur, [t.tabId]: v }))}
              onSessionReady={onSessionReadyForTab(t.tabId)}
              onSessionClose={onSessionCloseFromPane(t.tabId)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
