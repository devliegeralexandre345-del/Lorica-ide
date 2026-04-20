// src/components/Breadcrumbs.jsx
//
// Two tiers:
//   1. Path segments — project → folder → file.
//   2. Symbol path — function / class / method that contains the cursor.
//
// Each non-terminal segment is clickable; folders open a dropdown of
// their sibling files, symbols open a dropdown of sibling symbols. We
// don't have a language server, so the symbol list is regex-extracted
// (same heuristic as OutlinePanel) — good enough for navigation.
//
// The cursor position drives the "current symbol" highlight. We subscribe
// to the reducer (state.cursorLine / file.content) so the component
// stays live without props drilling.

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronRight, FileCode, Folder, Hash, Code } from 'lucide-react';

const SYMBOL_PATTERNS = {
  js:  /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function)|class\s+(\w+))/gm,
  jsx: /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function)|class\s+(\w+))/gm,
  ts:  /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function)|class\s+(\w+)|interface\s+(\w+)|type\s+(\w+))/gm,
  tsx: /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function)|class\s+(\w+)|interface\s+(\w+)|type\s+(\w+))/gm,
  py:  /^(?:async\s+)?(?:def\s+(\w+)|class\s+(\w+))/gm,
  rs:  /^(?:pub\s+)?(?:fn\s+(\w+)|struct\s+(\w+)|enum\s+(\w+)|trait\s+(\w+)|impl(?:\s*<[^>]+>)?\s+(\w+))/gm,
  go:  /^(?:func\s+(?:\(\w+\s+[*&]?\w+\)\s*)?(\w+)|type\s+(\w+)\s+(?:struct|interface))/gm,
};

function extractSymbols(content, ext) {
  const re = SYMBOL_PATTERNS[ext];
  if (!re || !content) return [];
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m.slice(1).find(Boolean);
    if (!name) continue;
    const line = content.slice(0, m.index).split('\n').length;
    out.push({ name, line, kind: inferKind(m[0]) });
    if (out.length >= 300) break;
  }
  return out;
}
function inferKind(raw) {
  if (/^\s*class\b/.test(raw)) return 'class';
  if (/^\s*(interface|type)\b/.test(raw)) return 'type';
  if (/^\s*(struct|enum|trait)\b/.test(raw)) return 'type';
  if (/^\s*impl\b/.test(raw)) return 'impl';
  return 'function';
}

export default function Breadcrumbs({ file, projectPath, dispatch, fileTree }) {
  const [openDropdown, setOpenDropdown] = useState(null); // 'folder:<path>' | 'symbols'
  const wrapperRef = useRef(null);

  // Dismiss dropdown on outside click.
  useEffect(() => {
    if (!openDropdown) return;
    const onDown = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpenDropdown(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [openDropdown]);

  // Path segments + cumulative paths so clicking a folder can show its
  // children without a second read.
  const { pathSegments, relSegments } = useMemo(() => {
    if (!file) return { pathSegments: [], relSegments: [] };
    let segments = [];
    if (projectPath && file.path.startsWith(projectPath)) {
      const relative = file.path.slice(projectPath.length).replace(/^[/\\]/, '');
      segments = relative.split(/[/\\]/).filter(Boolean);
    } else {
      segments = file.path.split(/[/\\]/).filter(Boolean);
    }
    const sep = projectPath?.includes('\\') ? '\\' : '/';
    const pathSegments = segments.map((seg, i) => {
      const abs = projectPath
        ? `${projectPath}${sep}${segments.slice(0, i + 1).join(sep)}`
        : segments.slice(0, i + 1).join(sep);
      return { name: seg, abs };
    });
    return { pathSegments, relSegments: segments };
  }, [file, projectPath]);

  // Extract symbols from the file content. Memoized per content+ext pair
  // so typing doesn't thrash.
  const symbols = useMemo(
    () => extractSymbols(file?.content || '', file?.extension || ''),
    [file?.content, file?.extension]
  );

  // Current symbol = the last symbol declared before the cursor line.
  // We read cursor from a global editor event the reducer picks up; if
  // not available we fall back to the first symbol.
  const cursorLine = file?.cursorLine || 0;
  const currentSymbol = useMemo(() => {
    if (!symbols.length) return null;
    let last = null;
    for (const s of symbols) {
      if (s.line > cursorLine) break;
      last = s;
    }
    return last;
  }, [symbols, cursorLine]);

  // Click on a folder segment: show its siblings so the user can hop to
  // a neighbour without opening the tree. We look up children from the
  // already-loaded fileTree prop — no extra I/O.
  const childrenOfFolder = (absPath) => {
    const walk = (nodes, target) => {
      for (const n of (nodes || [])) {
        if (n.path === target) return n.children || [];
        if (n.isDirectory) {
          const hit = walk(n.children, target);
          if (hit) return hit;
        }
      }
      return null;
    };
    return walk(fileTree || [], absPath) || [];
  };

  const openFileFromTree = (entry) => {
    if (entry.isDirectory) return;
    window.lorica.fs.readFile(entry.path).then((r) => {
      if (!r?.success) return;
      const ext = entry.name.includes('.') ? entry.name.split('.').pop() : '';
      dispatch({
        type: 'OPEN_FILE',
        file: { path: entry.path, name: entry.name, extension: ext, content: r.data.content, dirty: false },
      });
    });
    setOpenDropdown(null);
  };

  const jumpToSymbol = (sym) => {
    dispatch({
      type: 'OPEN_FILE',
      file: { ...file, pendingGoto: { line: sym.line } },
    });
    setOpenDropdown(null);
  };

  if (!file) return null;

  return (
    <div ref={wrapperRef} className="flex items-center gap-0.5 px-3 py-1 bg-lorica-surface/50 border-b border-lorica-border/50 overflow-x-auto text-[10px] select-none relative">
      {pathSegments.map((seg, i) => {
        const isLast = i === pathSegments.length - 1;
        const isFolder = !isLast;
        const key = `folder:${seg.abs}`;
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight size={10} className="text-lorica-textDim/40 flex-shrink-0" />}
            <div className="relative">
              <button
                onClick={() => isFolder && setOpenDropdown(openDropdown === key ? null : key)}
                className={`flex items-center gap-1 px-1 py-0.5 rounded transition-colors flex-shrink-0 ${
                  isLast
                    ? 'text-lorica-accent font-medium'
                    : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/20 cursor-pointer'
                }`}
              >
                {isLast ? <FileCode size={10} /> : <Folder size={10} className="opacity-50" />}
                {seg.name}
              </button>
              {isFolder && openDropdown === key && (
                <BreadcrumbDropdown
                  title={seg.name}
                  items={childrenOfFolder(seg.abs).map((c) => ({ name: c.name, entry: c, isDirectory: c.isDirectory }))}
                  onPick={(it) => openFileFromTree(it.entry)}
                  emptyLabel="Empty folder"
                />
              )}
            </div>
          </React.Fragment>
        );
      })}

      {/* Symbol path — only if we extracted any and the cursor is at a symbol. */}
      {currentSymbol && (
        <>
          <ChevronRight size={10} className="text-lorica-textDim/40 flex-shrink-0" />
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'symbols' ? null : 'symbols')}
              className="flex items-center gap-1 px-1 py-0.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/20 flex-shrink-0"
              title={`${symbols.length} symbol${symbols.length === 1 ? '' : 's'} in this file`}
            >
              {currentSymbol.kind === 'class' || currentSymbol.kind === 'type' ? <Code size={10} /> : <Hash size={10} />}
              {currentSymbol.name}
            </button>
            {openDropdown === 'symbols' && (
              <BreadcrumbDropdown
                title={`Symbols (${symbols.length})`}
                items={symbols.map((s) => ({ name: s.name, symbol: s, kind: s.kind }))}
                onPick={(it) => jumpToSymbol(it.symbol)}
                emptyLabel="No symbols detected"
                searchable
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BreadcrumbDropdown({ title, items, onPick, emptyLabel, searchable = false }) {
  const [query, setQuery] = useState('');
  const filtered = !query ? items : items.filter((it) => it.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="absolute top-full left-0 mt-1 w-64 lorica-glass rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.4)] border border-lorica-border z-50 animate-fadeIn">
      <div className="px-2 py-1 border-b border-lorica-border/50 text-[9px] uppercase tracking-widest text-lorica-textDim font-semibold">
        {title}
      </div>
      {searchable && (
        <div className="px-2 py-1 border-b border-lorica-border/50">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-full bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[10px] outline-none"
          />
        </div>
      )}
      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 && <div className="px-3 py-2 text-[10px] text-lorica-textDim text-center">{emptyLabel}</div>}
        {filtered.map((it, i) => (
          <button
            key={i}
            onClick={() => onPick(it)}
            className="w-full text-left px-2 py-1 text-[10px] hover:bg-lorica-accent/10 transition-colors flex items-center gap-1.5"
          >
            {it.isDirectory ? <Folder size={9} className="text-lorica-textDim" /> :
             it.kind === 'class' || it.kind === 'type' ? <Code size={9} className="text-purple-400" /> :
             <Hash size={9} className="text-sky-400" />}
            <span className="text-lorica-text truncate">{it.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
