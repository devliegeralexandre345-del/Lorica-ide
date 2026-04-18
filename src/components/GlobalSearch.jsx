import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Search, X, Replace, ChevronDown, ChevronRight, FileCode, CaseSensitive,
  ArrowDownUp, Sparkles, Database, Trash2, Loader2, RefreshCw, Zap,
} from 'lucide-react';

// Two modes sharing one panel:
//   exact    — substring search via cmd_search_in_files
//   semantic — embeddings search (all-MiniLM-L6-v2 via fastembed),
//              requires the per-project index to be built first.
const MODE_EXACT = 'exact';
const MODE_SEMANTIC = 'semantic';

export default function GlobalSearch({ state, dispatch, onFileOpen }) {
  const [mode, setMode] = useState(MODE_EXACT);

  // Shared
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Exact-mode state
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState({});

  // Semantic-mode state
  const [indexStatus, setIndexStatus] = useState(null);     // { exists, built_at, chunks, dim, model }
  const [indexing, setIndexing] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticHits, setSemanticHits] = useState(null);   // array | null

  useEffect(() => { inputRef.current?.focus(); }, []);

  // ----------------------------------------------------------------
  // Refresh index metadata whenever we switch into semantic mode or
  // the project changes. Cheap: only reads the file header.
  // ----------------------------------------------------------------
  const refreshIndexStatus = useCallback(async () => {
    if (!state.projectPath) return;
    const res = await window.lorica.search.semanticIndexStatus(state.projectPath);
    if (res && res.success !== false) {
      setIndexStatus(res.data || res);
    }
  }, [state.projectPath]);

  useEffect(() => {
    if (mode === MODE_SEMANTIC) refreshIndexStatus();
  }, [mode, state.projectPath, refreshIndexStatus]);

  // Clear stale results when switching modes so the UI doesn't show
  // mismatched data.
  useEffect(() => {
    setQuery('');
    setResults(null);
    setSemanticHits(null);
  }, [mode]);

  // ----------------------------------------------------------------
  // Exact search (unchanged behavior)
  // ----------------------------------------------------------------
  const doSearch = useCallback(async (q) => {
    if (!q.trim() || !state.projectPath) return;
    setLoading(true);
    try {
      const res = await window.lorica.search.searchInFiles(state.projectPath, q, caseSensitive, 500);
      if (res && res.success !== false) {
        const data = res.data || res;
        setResults(data);
        const expanded = {};
        const files = [...new Set((data.matches || []).map(m => m.path))];
        files.slice(0, 5).forEach(f => { expanded[f] = true; });
        setExpandedFiles(expanded);
      }
    } catch (e) {
      console.error('Search failed:', e);
    }
    setLoading(false);
  }, [state.projectPath, caseSensitive]);

  // ----------------------------------------------------------------
  // Semantic search
  // ----------------------------------------------------------------
  const doSemanticSearch = useCallback(async (q) => {
    if (!q.trim() || !state.projectPath) return;
    if (!indexStatus?.exists) {
      dispatch({
        type: 'ADD_TOAST',
        toast: { type: 'warning', message: 'Build the semantic index first.' },
      });
      return;
    }
    setSemanticLoading(true);
    try {
      const res = await window.lorica.search.semanticSearch(state.projectPath, q, 25);
      if (res && res.success !== false) {
        setSemanticHits(res.data || res);
      } else {
        dispatch({
          type: 'ADD_TOAST',
          toast: { type: 'error', message: res?.error || 'Semantic search failed' },
        });
      }
    } catch (e) {
      console.error('Semantic search failed:', e);
    }
    setSemanticLoading(false);
  }, [state.projectPath, indexStatus, dispatch]);

  // ----------------------------------------------------------------
  // Index build / clear
  // ----------------------------------------------------------------
  // Build / incremental update / force-full rebuild share one handler.
  // `force=true` (triggered by Shift-click on "Update") nukes the old
  // manifest and re-embeds everything, useful after bumping chunking
  // params or if the index ever drifts.
  const handleBuildIndex = useCallback(async (force = false) => {
    if (!state.projectPath || indexing) return;
    setIndexing(true);

    const hasIndex = !!indexStatus?.exists;
    const pendingMsg = !hasIndex
      ? 'Indexing project… (first run downloads the model, ~23 MB)'
      : force
        ? 'Rebuilding index from scratch…'
        : 'Updating index (incremental)…';
    dispatch({
      type: 'ADD_TOAST',
      toast: { type: 'info', message: pendingMsg, duration: 5000 },
    });

    try {
      const res = await window.lorica.search.semanticIndex(state.projectPath, force);
      if (res && res.success !== false) {
        const r = res.data || res;
        // Craft a toast that tells the user what the incremental pass did.
        let msg;
        if (!r.incremental) {
          msg = `Indexed ${r.chunks} chunks from ${r.files} files in ${(r.duration_ms / 1000).toFixed(1)}s`;
        } else if (r.chunks_embedded === 0 && r.files_deleted === 0) {
          msg = `Index up-to-date — no changes (${(r.duration_ms / 1000).toFixed(1)}s)`;
        } else {
          const parts = [];
          if (r.files_changed) parts.push(`${r.files_changed} changed`);
          if (r.files_new) parts.push(`${r.files_new} new`);
          if (r.files_deleted) parts.push(`${r.files_deleted} removed`);
          msg = `Updated: ${parts.join(', ')} · re-embedded ${r.chunks_embedded} chunks in ${(r.duration_ms / 1000).toFixed(1)}s`;
        }
        dispatch({
          type: 'ADD_TOAST',
          toast: { type: 'success', message: msg, duration: 4000 },
        });
        await refreshIndexStatus();
      } else {
        dispatch({
          type: 'ADD_TOAST',
          toast: { type: 'error', message: res?.error || 'Indexing failed' },
        });
      }
    } catch (e) {
      dispatch({
        type: 'ADD_TOAST',
        toast: { type: 'error', message: `Indexing failed: ${e.message || e}` },
      });
    }
    setIndexing(false);
  }, [state.projectPath, indexing, indexStatus, dispatch, refreshIndexStatus]);

  const handleClearIndex = useCallback(async () => {
    if (!state.projectPath) return;
    const res = await window.lorica.search.semanticIndexClear(state.projectPath);
    if (res && res.success !== false) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: 'Semantic index cleared.' } });
      setSemanticHits(null);
      await refreshIndexStatus();
    }
  }, [state.projectPath, dispatch, refreshIndexStatus]);

  // ----------------------------------------------------------------
  // Input handling — debounced for exact, Enter-only for semantic
  // (each semantic query embeds the text, so we don't want per-keystroke).
  // ----------------------------------------------------------------
  const handleInput = (val) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (mode === MODE_EXACT) {
      if (val.trim().length >= 2) {
        debounceRef.current = setTimeout(() => doSearch(val), 300);
      } else {
        setResults(null);
      }
    }
  };

  const handleEnter = () => {
    if (mode === MODE_EXACT) doSearch(query);
    else doSemanticSearch(query);
  };

  const handleReplaceAll = async () => {
    if (!query || !state.projectPath) return;
    const res = await window.lorica.search.replaceInFiles(state.projectPath, query, replacement, caseSensitive);
    if (res && res.data !== undefined) {
      const count = res.data;
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `${count} remplacement${count > 1 ? 's' : ''} effectué${count > 1 ? 's' : ''}`, duration: 3000 } });
      doSearch(query);
    }
  };

  const toggleFile = (path) => {
    setExpandedFiles(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const goToMatch = (match) => {
    onFileOpen(match.path);
  };

  // Semantic hit = { path, relative, start_line, end_line, snippet, score }
  const goToHit = (hit) => {
    onFileOpen(hit.path);
  };

  // Group matches by file (exact mode only)
  const grouped = {};
  if (results?.matches) {
    for (const m of results.matches) {
      if (!grouped[m.path]) grouped[m.path] = { name: m.name, preview: m.preview, matches: [] };
      grouped[m.path].matches.push(m);
    }
  }

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showSearch', value: false });

  // Human-readable "built_at" stamp
  const builtAtLabel = indexStatus?.built_at
    ? new Date(indexStatus.built_at).toLocaleString()
    : '—';

  return (
    <div className="h-full flex flex-col bg-lorica-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-lorica-border">
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Search</span>
        <button onClick={close} className="text-lorica-textDim hover:text-lorica-text"><X size={14} /></button>
      </div>

      {/* Mode toggle */}
      <div className="px-2 pt-2 pb-1.5 border-b border-lorica-border flex items-center gap-1">
        <button
          onClick={() => setMode(MODE_EXACT)}
          className={`flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold uppercase tracking-wider rounded transition-colors ${
            mode === MODE_EXACT
              ? 'bg-lorica-accent/20 text-lorica-accent'
              : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-panel/40'
          }`}
          title="Substring search"
        >
          <Zap size={10} /> Exact
        </button>
        <button
          onClick={() => setMode(MODE_SEMANTIC)}
          className={`flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold uppercase tracking-wider rounded transition-colors ${
            mode === MODE_SEMANTIC
              ? 'bg-purple-500/20 text-purple-400'
              : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-panel/40'
          }`}
          title="Semantic search via local embeddings"
        >
          <Sparkles size={10} /> Semantic
        </button>
      </div>

      {/* Search input */}
      <div className="px-2 py-2 space-y-1.5 border-b border-lorica-border">
        <div className="flex items-center gap-1">
          <div className="flex-1 flex items-center bg-lorica-bg border border-lorica-border rounded px-2 py-1 focus-within:border-lorica-accent">
            {mode === MODE_EXACT
              ? <Search size={12} className="text-lorica-textDim mr-1.5 flex-shrink-0" />
              : <Sparkles size={12} className="text-purple-400 mr-1.5 flex-shrink-0" />}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEnter()}
              placeholder={mode === MODE_EXACT
                ? 'Search in files...'
                : 'Describe what you\'re looking for… (Enter)'}
              className="flex-1 bg-transparent text-xs text-lorica-text outline-none placeholder:text-lorica-textDim/50"
            />
          </div>
          {mode === MODE_EXACT && (
            <>
              <button
                onClick={() => setCaseSensitive(!caseSensitive)}
                className={`p-1 rounded transition-colors ${caseSensitive ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-text'}`}
                title="Case sensitive"
              >
                <CaseSensitive size={14} />
              </button>
              <button
                onClick={() => setShowReplace(!showReplace)}
                className={`p-1 rounded transition-colors ${showReplace ? 'bg-lorica-accent/20 text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-text'}`}
                title="Replace"
              >
                <ArrowDownUp size={14} />
              </button>
            </>
          )}
        </div>

        {mode === MODE_EXACT && showReplace && (
          <div className="flex items-center gap-1">
            <div className="flex-1 flex items-center bg-lorica-bg border border-lorica-border rounded px-2 py-1 focus-within:border-lorica-accent">
              <Replace size={12} className="text-lorica-textDim mr-1.5 flex-shrink-0" />
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="Replace with..."
                className="flex-1 bg-transparent text-xs text-lorica-text outline-none placeholder:text-lorica-textDim/50"
              />
            </div>
            <button
              onClick={handleReplaceAll}
              className="px-2 py-1 text-[10px] bg-lorica-accent/20 text-lorica-accent rounded hover:bg-lorica-accent/30 transition-colors"
            >
              All
            </button>
          </div>
        )}
      </div>

      {/* Semantic index control bar */}
      {mode === MODE_SEMANTIC && (
        <div className="px-2 py-1.5 border-b border-lorica-border bg-purple-500/5">
          <div className="flex items-center gap-1.5 text-[10px]">
            <Database size={11} className={indexStatus?.exists ? 'text-purple-400' : 'text-lorica-textDim'} />
            {indexStatus?.exists ? (
              <span className="text-lorica-textDim flex-1 truncate" title={`Built ${builtAtLabel}`}>
                <span className="text-purple-400">{indexStatus.chunks}</span> chunks ·{' '}
                <span className="opacity-70">{builtAtLabel}</span>
              </span>
            ) : (
              <span className="text-lorica-textDim flex-1">No index yet</span>
            )}

            <button
              onClick={(e) => handleBuildIndex(e.shiftKey)}
              disabled={indexing || !state.projectPath}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-purple-500/15 text-purple-400 rounded hover:bg-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={indexStatus?.exists
                ? 'Update index (incremental) — Shift-click to force a full rebuild'
                : 'Build index'}
            >
              {indexing
                ? <><Loader2 size={10} className="animate-spin" /> Indexing…</>
                : <><RefreshCw size={10} /> {indexStatus?.exists ? 'Update' : 'Build'}</>}
            </button>

            {indexStatus?.exists && !indexing && (
              <button
                onClick={handleClearIndex}
                className="p-1 text-lorica-textDim hover:text-red-400 rounded transition-colors"
                title="Delete index"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {/* EXACT RESULTS --------------------------------------------- */}
        {mode === MODE_EXACT && (
          <>
            {loading && (
              <div className="px-3 py-4 text-center text-xs text-lorica-textDim animate-pulse">Searching...</div>
            )}

            {results && !loading && (
              <div className="py-1">
                <div className="px-3 py-1 text-[10px] text-lorica-textDim">
                  {results.total} résultat{results.total !== 1 ? 's' : ''} dans {results.files_searched} fichier{results.files_searched !== 1 ? 's' : ''}
                  {results.truncated && ' (tronqué)'}
                </div>

                {Object.entries(grouped).map(([filePath, group]) => (
                  <div key={filePath}>
                    <button
                      onClick={() => toggleFile(filePath)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-lorica-text hover:bg-lorica-panel/60 transition-colors"
                    >
                      {expandedFiles[filePath] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <FileCode size={12} className="text-lorica-accent" />
                      <span className="truncate flex-1 text-left">{group.preview}</span>
                      <span className="text-[10px] text-lorica-textDim bg-lorica-bg px-1.5 rounded">{group.matches.length}</span>
                    </button>

                    {expandedFiles[filePath] && group.matches.map((m, i) => (
                      <button
                        key={i}
                        onClick={() => goToMatch(m)}
                        className="w-full flex items-start gap-2 px-4 pl-8 py-0.5 text-[11px] text-lorica-textDim hover:bg-lorica-panel/40 hover:text-lorica-text transition-colors"
                      >
                        <span className="text-lorica-accent/60 flex-shrink-0 w-8 text-right">{m.line}</span>
                        <span className="truncate text-left font-mono">
                          {highlightMatch(m.text, query, caseSensitive).map((part, idx) => (
                            part.highlight ? (
                              <span key={idx} className="bg-lorica-accent/30 text-lorica-accent rounded px-0.5">
                                {part.text}
                              </span>
                            ) : (
                              <span key={idx}>{part.text}</span>
                            )
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {!results && !loading && (
              <div className="px-3 py-8 text-center text-xs text-lorica-textDim">
                <Search size={24} className="mx-auto mb-2 opacity-20" />
                <div className="opacity-40">Tapez pour rechercher dans le projet</div>
              </div>
            )}
          </>
        )}

        {/* SEMANTIC RESULTS ------------------------------------------ */}
        {mode === MODE_SEMANTIC && (
          <>
            {semanticLoading && (
              <div className="px-3 py-4 text-center text-xs text-lorica-textDim flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Embedding query…
              </div>
            )}

            {semanticHits && !semanticLoading && (
              <div className="py-1">
                <div className="px-3 py-1 text-[10px] text-lorica-textDim">
                  {semanticHits.length} résultat{semanticHits.length !== 1 ? 's' : ''} — triés par similarité
                </div>

                {semanticHits.map((hit, i) => (
                  <button
                    key={`${hit.path}:${hit.start_line}:${i}`}
                    onClick={() => goToHit(hit)}
                    className="w-full flex flex-col items-start gap-1 px-2 py-1.5 border-b border-lorica-border/50 hover:bg-lorica-panel/40 text-left transition-colors group"
                  >
                    <div className="flex items-center gap-1.5 w-full text-[11px] text-lorica-text">
                      <FileCode size={11} className="text-purple-400 flex-shrink-0" />
                      <span className="truncate flex-1 font-medium">{hit.relative}</span>
                      <span className="text-[9px] text-lorica-textDim font-mono">
                        L{hit.start_line}–{hit.end_line}
                      </span>
                      <span
                        className="text-[9px] font-mono px-1 rounded bg-purple-500/10 text-purple-400"
                        title={`Cosine similarity: ${hit.score.toFixed(4)}`}
                      >
                        {(hit.score * 100).toFixed(0)}
                      </span>
                    </div>
                    <pre className="w-full text-[10px] leading-snug font-mono text-lorica-textDim group-hover:text-lorica-text whitespace-pre-wrap break-words max-h-24 overflow-hidden">
                      {hit.snippet}
                    </pre>
                  </button>
                ))}

                {semanticHits.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-lorica-textDim opacity-60">
                    No matches for that query.
                  </div>
                )}
              </div>
            )}

            {!semanticHits && !semanticLoading && (
              <div className="px-3 py-8 text-center text-xs text-lorica-textDim">
                <Sparkles size={24} className="mx-auto mb-2 opacity-30 text-purple-400" />
                {indexStatus?.exists ? (
                  <div className="opacity-50 space-y-1">
                    <div>Ask in plain language.</div>
                    <div className="text-[10px] opacity-60">
                      e.g. "where do we validate the master password" or<br />
                      "the place that opens large files via mmap"
                    </div>
                  </div>
                ) : (
                  <div className="opacity-50 space-y-1">
                    <div>Build the index first to enable semantic search.</div>
                    <div className="text-[10px] opacity-60">
                      Runs locally — nothing leaves your machine.
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function highlightMatch(text, query, caseSensitive) {
  if (!query) return [{ text, highlight: false }];
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), highlight: false });
      }
      parts.push({ text: match[0], highlight: true });
      lastIndex = regex.lastIndex;
      // Éviter une boucle infinie si la regex correspond à une chaîne vide
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), highlight: false });
    }
    return parts;
  } catch {
    return [{ text, highlight: false }];
  }
}
