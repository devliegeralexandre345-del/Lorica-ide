import React, { useEffect, useRef, useCallback, useState } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor, highlightSpecialChars } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { autocompletion, completionKeymap, acceptCompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, selectNextOccurrence } from '@codemirror/search';
import { Sparkles, Wrench, Bug, ChevronRight, Hash } from 'lucide-react';
import { LANGUAGE_MAP } from '../utils/languages';
import { createEditorTheme } from '../utils/themes';
import { getCompletionSource } from '../utils/completions';
import { bracketPairColorization } from '../extensions/bracketColorizer';
import { indentGuidesExtension } from '../extensions/indentGuides';
import { aiGhostExtension, aiGhostConfig, acceptGhost, dismissGhost, triggerGhost, ghostStatusField } from '../extensions/aiGhostText';
import { fetchInlineCompletion } from '../utils/aiInlineComplete';

// =============================================
// Minimap with smooth drag scrolling
// =============================================
function Minimap({ content, editorView, visible }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const scrollRatioRef = useRef(0);
  const rafPaintRef = useRef(null);
  const isDragging = useRef(false);
  const cachedImage = useRef(null);
  const lastContent = useRef('');

  // Build static code image only when content changes
  const buildCodeImage = useCallback(() => {
    if (!content || !wrapRef.current) return;
    const W = 70;
    const H = wrapRef.current.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const lines = content.split('\n');
    const lh = 2.5;

    const offscreen = document.createElement('canvas');
    offscreen.width = W * dpr;
    const totalH = Math.max(H, lines.length * lh);
    offscreen.height = totalH * dpr;
    const ctx = offscreen.getContext('2d');
    ctx.scale(dpr, dpr);

    const style = getComputedStyle(document.documentElement);
    const dim = style.getPropertyValue('--color-textDim').trim() || '#64748b';

    for (let i = 0; i < lines.length; i++) {
      const y = i * lh;
      const t = lines[i].replace(/\t/g, '  ');
      const indent = t.length - t.trimStart().length;
      const len = Math.min(t.trim().length, 55);
      if (len > 0) {
        ctx.fillStyle = dim + '30';
        ctx.fillRect(indent * 0.7 + 2, y, len * 0.7, lh - 0.5);
      }
    }

    cachedImage.current = { canvas: offscreen, totalH, lineCount: lines.length, lh };
    lastContent.current = content;
  }, [content]);

  // Fast composite: draw cached code + viewport overlay
  const paint = useCallback(() => {
    if (!canvasRef.current || !wrapRef.current || !visible) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = 70;
    const H = wrapRef.current.clientHeight;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (!cachedImage.current) return;
    const { canvas: offscreen, totalH } = cachedImage.current;

    // Draw code from offscreen canvas with scroll offset
    const scrollOff = totalH > H ? scrollRatioRef.current * (totalH - H) : 0;
    ctx.drawImage(offscreen, 0, scrollOff * dpr, W * dpr, H * dpr, 0, 0, W, H);

    // Viewport indicator
    const style = getComputedStyle(document.documentElement);
    const acc = style.getPropertyValue('--color-accent').trim() || '#00d4ff';
    const vFrac = editorView ? editorView.scrollDOM.clientHeight / Math.max(1, editorView.scrollDOM.scrollHeight) : 0.15;
    const vH = Math.max(20, H * vFrac);
    const vY = scrollRatioRef.current * (H - vH);

    ctx.fillStyle = acc + '15';
    ctx.fillRect(0, vY, W, vH);
    ctx.strokeStyle = acc + '40';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, vY + 0.5, W - 1, vH - 1);
  }, [editorView, visible]);

  // Rebuild code image when content changes
  useEffect(() => {
    if (content !== lastContent.current) {
      buildCodeImage();
      paint();
    }
  }, [content, buildCodeImage, paint]);

  // Track editor scroll — update ratio + repaint
  useEffect(() => {
    if (!editorView || !visible) return;
    const scroller = editorView.scrollDOM;
    let ticking = false;

    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scrollRatioRef.current = max > 0 ? scroller.scrollTop / max : 0;
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          paint();
          ticking = false;
        });
      }
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    // Initial
    onScroll();
    buildCodeImage();
    paint();

    return () => scroller.removeEventListener('scroll', onScroll);
  }, [editorView, visible, paint, buildCodeImage]);

  // Resize repaint
  useEffect(() => {
    if (!wrapRef.current || !visible) return;
    const observer = new ResizeObserver(() => {
      buildCodeImage();
      paint();
    });
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [visible, buildCodeImage, paint]);

  if (!visible) return null;

  // Click to scroll
  const scrollToRatio = (ratio) => {
    if (!editorView) return;
    const s = editorView.scrollDOM;
    const target = ratio * (s.scrollHeight - s.clientHeight);
    s.scrollTo({ top: target, behavior: 'smooth' });
  };

  // Mouse handlers for drag scrolling
  const handleMouseDown = (e) => {
    isDragging.current = true;
    const r = wrapRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    scrollToRatio(ratio);

    const onMove = (ev) => {
      if (!isDragging.current) return;
      const ratio = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
      if (editorView) {
        const s = editorView.scrollDOM;
        s.scrollTop = ratio * (s.scrollHeight - s.clientHeight);
      }
    };

    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={wrapRef}
      className="absolute right-0 top-0 bottom-0 w-[70px] opacity-40 hover:opacity-75 transition-opacity cursor-pointer overflow-hidden bg-lorica-bg/30"
      onMouseDown={handleMouseDown}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

// =============================================
// Editor
// =============================================
const Editor = React.memo(function Editor({
  file, index, dispatch, theme, showMinimap = true,
  aiInlineEnabled = false, aiProvider = 'anthropic', aiApiKey = '',
}) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const filePathRef = useRef(null);
  const [aiLens, setAiLens] = useState(null);
  const [ready, setReady] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1, selected: 0 });
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [indentStyle, setIndentStyle] = useState({ type: 'spaces', size: 2 });

  // AI inline config lives in a ref so the fetcher closure (captured once
  // at editor creation) always sees the latest provider / key / enabled
  // state without having to rebuild the whole EditorView.
  const aiConfigRef = useRef({ enabled: aiInlineEnabled, provider: aiProvider, apiKey: aiApiKey });
  useEffect(() => {
    aiConfigRef.current = { enabled: aiInlineEnabled, provider: aiProvider, apiKey: aiApiKey };
  }, [aiInlineEnabled, aiProvider, aiApiKey]);

  // Ghost status ('disabled' | 'idle' | 'thinking' | 'ready' | 'error'), for
  // the tiny indicator chip rendered in the editor corner.
  const [ghostStatus, setGhostStatus] = useState('idle');

  // Détecter style d'indentation (tabs vs espaces)
  const detectIndentStyle = useCallback((content) => {
    if (!content) return { type: 'spaces', size: 2 };
    const lines = content.split('\n').slice(0, 50);
    let tabLines = 0;
    let spaceLines = 0;
    const spaceCounts = [];

    for (const line of lines) {
      if (line.startsWith('\t')) tabLines++;
      else if (line.match(/^ +/)) {
        const spaces = line.match(/^ +/)?.[0].length || 0;
        spaceLines++;
        if (spaces > 0) spaceCounts.push(spaces);
      }
    }

    if (tabLines > spaceLines) return { type: 'tabs', size: 4 };
    // Calculer la taille d'indentation la plus fréquente
    if (spaceCounts.length > 0) {
      const freq = {};
      spaceCounts.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
      const mostFreq = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      return { type: 'spaces', size: parseInt(mostFreq) || 2 };
    }
    return { type: 'spaces', size: 2 };
  }, []);

  // Extraire breadcrumb basé sur la position du curseur
  const extractBreadcrumb = useCallback((content, lineNum) => {
    if (!content) return [];
    const lines = content.split('\n');
    const line = lines[lineNum - 1];
    const crumbs = [];
    
    // Nom du fichier
    const fileName = file.path.split('/').pop() || file.path;
    crumbs.push({ label: fileName, type: 'file' });

    // Recherche de fonction/classe selon langage
    const lang = file.extension;
    const patterns = {
      js: /(?:function|const|let|var)\s+(\w+)\s*=|class\s+(\w+)/,
      ts: /(?:function|const|let|var)\s+(\w+)\s*=|class\s+(\w+)/,
      py: /def\s+(\w+)\s*\(|class\s+(\w+)/,
      rs: /fn\s+(\w+)\s*\(|struct\s+(\w+)|impl\s+(\w+)/,
      c: /(?:int|void|float|double)\s+(\w+)\s*\(|struct\s+(\w+)/,
      cpp: /(?:int|void|float|double|auto)\s+(\w+)\s*\(|class\s+(\w+)/,
      cs: /(?:public|private|protected)?\s*(?:static\s+)?(?:void|int|string|bool)\s+(\w+)\s*\(|class\s+(\w+)/,
      go: /func\s+(\w+)\s*\(|type\s+(\w+)\s+struct/,
    };

    // Chercher à partir de la ligne actuelle vers le haut
    for (let i = lineNum - 1; i >= 0; i--) {
      const l = lines[i];
      const pattern = patterns[lang];
      if (pattern) {
        const match = l.match(pattern);
        if (match) {
          const name = match[1] || match[2] || match[3];
          if (name) {
            crumbs.push({ label: name, type: l.includes('class') ? 'class' : 'function' });
            break;
          }
        }
      }
    }

    return crumbs;
  }, [file.extension, file.path]);

  const handleChange = useCallback((content) => {
    dispatch({ type: 'UPDATE_FILE_CONTENT', index, content });
    // Mettre à jour l'indentation
    setIndentStyle(detectIndentStyle(content));
  }, [dispatch, index, detectIndentStyle]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; setReady(false); }

    const setup = async () => {
      // Détecter l'indentation
      const indent = detectIndentStyle(file.content);
      setIndentStyle(indent);

      // Extensions de base
      const extensions = [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter({
          openText: '▾',
          closedText: '▸',
        }),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        indentOnInput(),
        bracketMatching(),
        // Extensions personnalisées
        ...bracketPairColorization(),
        ...indentGuidesExtension(),
        closeBrackets(),
        highlightSelectionMatches(),
        EditorState.tabSize.of(indent.size),
        // Rulers à 80 et 120 chars
        EditorView.theme({
          '.cm-content': {
            backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: `${indent.size}ch 100%`,
          },
          '& .cm-ruler': {
            position: 'absolute',
            left: '80ch',
            top: 0,
            bottom: 0,
            width: '1px',
            background: 'rgba(255,255,255,0.05)',
            pointerEvents: 'none',
          },
          '& .cm-ruler-120': {
            left: '120ch',
          },
        }),
        // Autocomplétion
        autocompletion({
          override: [getCompletionSource(file.extension)],
          activateOnTyping: true,
          maxRenderedOptions: 15,
        }),
        // AI inline ghost-text completion. The fetcher reads config from a
        // ref so provider/API key changes don't force rebuilding the editor.
        aiGhostConfig.of({
          enabled: true,
          getFetcher: async ({ prefix, suffix, signal }) => {
            const cfg = aiConfigRef.current;
            if (!cfg.enabled || !cfg.apiKey) return '';
            return fetchInlineCompletion({
              prefix,
              suffix,
              language: file.extension,
              filePath: file.path,
              provider: cfg.provider,
              apiKey: cfg.apiKey,
              signal,
            });
          },
        }),
        ...aiGhostExtension(),
        // Keymap amélioré
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...foldKeymap,
          ...completionKeymap,
          // Tab: autocomplete dropdown wins first, then inline ghost, else
          // fall through to indent (handled by `indentWithTab` below).
          {
            key: 'Tab',
            run: (view) => acceptCompletion(view) || acceptGhost(view),
          },
          // Escape: dismiss any visible ghost first; selection-collapse
          // logic is handled by the separate Escape binding further down.
          { key: 'Escape', run: dismissGhost },
          // Manual ghost trigger — bypasses the idle timer and skip checks.
          { key: 'Alt-\\', run: triggerGhost, preventDefault: true },
          { key: 'Mod-Alt-Space', run: triggerGhost, preventDefault: true },
          { key: 'Mod-d', run: selectNextOccurrence },
          { key: 'Mod-Shift-l', run: (view) => {
            const selection = view.state.selection.main;
            const text = view.state.sliceDoc(selection.from, selection.to);
            if (!text) return false;
            const cursor = selection.from;
            const doc = view.state.doc;
            const matches = [];
            for (let pos = 0; pos < doc.length; pos++) {
              if (doc.slice(pos, pos + text.length).eq(text)) {
                matches.push({ from: pos, to: pos + text.length });
              }
            }
            if (matches.length > 1) {
              view.dispatch({ selection: { ranges: matches.map(m => ({ from: m.from, to: m.to })) } });
              return true;
            }
            return false;
          }},
          { key: 'Escape', run: (view) => {
            if (view.state.selection.ranges.length > 1) {
              view.dispatch({ selection: { ranges: [view.state.selection.main] } });
              return true;
            }
            return false;
          }},
          indentWithTab,
        ]),
        // Listener pour position du curseur et breadcrumb
        EditorView.updateListener.of((update) => {
          if (update.docChanged) handleChange(update.state.doc.toString());
          // Mirror the ghost status field into React so the corner indicator re-renders.
          try {
            const s = update.state.field(ghostStatusField, false);
            const prevS = update.startState.field(ghostStatusField, false);
            if (s && s !== prevS) setGhostStatus(s);
          } catch (_) {}
          if (update.selectionSet) {
            const range = update.state.selection.main;
            // Mettre à jour la position du curseur
            const line = update.state.doc.lineAt(range.head);
            const col = range.head - line.from + 1;
            const selected = range.empty ? 0 : range.to - range.from;
            setCursorPos({ line: line.number, col, selected });
            
            // Mettre à jour le breadcrumb
            const crumbs = extractBreadcrumb(update.state.doc.toString(), line.number);
            setBreadcrumb(crumbs);

            if (!range.empty) {
              const text = update.state.sliceDoc(range.from, range.to);
              try {
                const coords = viewRef.current?.coordsAtPos(range.from);
                if (coords && containerRef.current) {
                  const r = containerRef.current.getBoundingClientRect();
                  setAiLens({ text, top: coords.top - r.top - 45, left: coords.left - r.left });
                }
              } catch (_) {}
            } else {
              setAiLens(null);
            }
          }
        }),
        EditorView.theme({
          '&': { height: '100%', background: 'var(--color-bg)' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '14px',
            paddingRight: showMinimap ? '75px' : '0',
            scrollBehavior: 'auto',
          },
          // Styles pour l'autocomplétion
          '.cm-tooltip-autocomplete': {
            background: 'rgba(15, 15, 25, 0.95)',
            border: '1px solid rgba(0, 212, 255, 0.2)',
            borderRadius: '8px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '12px',
          },
          '.cm-tooltip-autocomplete ul li': {
            padding: '3px 8px',
            color: 'var(--color-text)',
          },
          '.cm-tooltip-autocomplete ul li[aria-selected]': {
            background: 'rgba(0, 212, 255, 0.15)',
            color: '#00d4ff',
          },
          '.cm-completionLabel': { color: 'var(--color-text)' },
          '.cm-completionDetail': { color: 'var(--color-textDim)', fontSize: '10px' },
          '.cm-completionIcon': { opacity: 0.6 },
          '.cm-completionIcon-keyword::after': { content: '"KW"', color: '#c792ea' },
          '.cm-completionIcon-function::after': { content: '"fn"', color: '#82aaff' },
          '.cm-completionIcon-snippet::after': { content: '"⬡"', color: '#00d4ff' },
        }),
        ...createEditorTheme(theme),
      ];

      const langConfig = LANGUAGE_MAP[file.extension];
      if (langConfig && langConfig.loader) {
        try {
          const ext = await langConfig.loader();
          if (ext) extensions.push(ext);
        } catch (_) {}
      }

      viewRef.current = new EditorView({
        state: EditorState.create({ doc: file.content || '', extensions }),
        parent: containerRef.current,
      });
      filePathRef.current = file.path;
      setReady(true);
    };

    setup();
    return () => { if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; setReady(false); } };
  }, [file.path, theme, showMinimap]);

  useEffect(() => {
    if (viewRef.current && filePathRef.current === file.path) {
      const cur = viewRef.current.state.doc.toString();
      if (file.content !== cur && file.content !== undefined) {
        viewRef.current.dispatch({ changes: { from: 0, to: cur.length, insert: file.content } });
      }
    }
  }, [file.content, file.path]);

  const handleLensAction = (action) => {
    dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
    const prompt = `[${action.toUpperCase()}] Focus sur cette portion de code :\n\n\`\`\`${file.extension}\n${aiLens.text}\n\`\`\`\n\nQue me proposes-tu ?`;
    navigator.clipboard.writeText(prompt);
    setAiLens(null);
  };

  // Status chip: only show when the user actually enabled inline AI, and only
  // when the state is interesting (thinking/ready/error). "idle" stays hidden
  // so it doesn't clutter the editor.
  const showGhostChip = aiInlineEnabled && ghostStatus !== 'idle' && ghostStatus !== 'disabled';
  const ghostChipMeta = {
    thinking: { label: 'AI…',  className: 'text-lorica-accent border-lorica-accent/40 bg-lorica-accent/10 animate-pulse' },
    ready:    { label: 'AI ⎋ • ⇥', className: 'text-green-300 border-green-400/40 bg-green-400/10' },
    error:    { label: 'AI ✕', className: 'text-red-300 border-red-400/40 bg-red-400/10' },
  }[ghostStatus] || { label: 'AI', className: 'text-lorica-textDim border-lorica-border' };

  return (
    <div className="relative h-full w-full overflow-hidden bg-lorica-bg">
      <div ref={containerRef} className="h-full w-full" />
      {ready && <Minimap content={file.content} editorView={viewRef.current} visible={showMinimap} />}
      {showGhostChip && (
        <div
          className={`absolute bottom-2 left-2 z-40 px-2 py-0.5 rounded-full border text-[10px] font-mono pointer-events-none ${ghostChipMeta.className}`}
          title={`Inline AI — ${ghostStatus}`}
        >
          {ghostChipMeta.label}
        </div>
      )}
      {aiLens && (
        <div
          className="absolute z-50 flex items-center gap-1 bg-lorica-panel/90 backdrop-blur-md border border-lorica-accent/30 rounded-lg shadow-[0_0_15px_rgba(0,212,255,0.15)] p-1.5 animate-fadeIn"
          style={{ top: Math.max(10, aiLens.top), left: Math.max(10, aiLens.left) }}
        >
          <button onClick={() => handleLensAction('explain')} className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-blue-400 hover:bg-blue-400/20 rounded transition-colors">
            <Sparkles size={12} /> Expliquer
          </button>
          <div className="w-px h-3 bg-lorica-border/50" />
          <button onClick={() => handleLensAction('refactor')} className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-yellow-400 hover:bg-yellow-400/20 rounded transition-colors">
            <Wrench size={12} /> Refactor
          </button>
          <div className="w-px h-3 bg-lorica-border/50" />
          <button onClick={() => handleLensAction('fix')} className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-red-400 hover:bg-red-400/20 rounded transition-colors">
            <Bug size={12} /> Fix
          </button>
        </div>
      )}
    </div>
  );
});

export default Editor;
