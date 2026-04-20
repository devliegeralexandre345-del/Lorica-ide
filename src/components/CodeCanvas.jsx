// src/components/CodeCanvas.jsx
//
// The Code Canvas — an interactive, zoomable graph of the project's file
// dependency graph. Each file is a node, each import is a directed edge.
// Click a node to open the file; hover to highlight its neighborhood.
//
// Why SVG and not canvas: graphs in this project are small (≤200 nodes by
// default) and SVG gives us free hit-testing, CSS transitions, and
// accessibility. If we needed to scale to 10k nodes we'd swap in a WebGL
// renderer — for now the extra machinery wouldn't pay for itself.
//
// Zoom/pan is implemented by transforming a root <g>. We keep transform
// state in React so the minimap (future work) can read it too.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Network, ZoomIn, ZoomOut, Maximize2, Search, Filter, Map as MapIcon } from 'lucide-react';
import { buildProjectGraph, layoutGraph } from '../utils/projectGraph';

// Distinct hues per file extension so related files cluster visually.
const EXT_COLOR = {
  js:  '#f7df1e', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6',
  py:  '#3776ab', rs: '#dea584', go: '#00add8',
  c:   '#a8b9cc', h: '#a8b9cc', cpp: '#f34b7d', hpp: '#f34b7d',
  java:'#b07219', cs: '#178600',
};
const DEFAULT_EXT_COLOR = '#a855f7';

export default function CodeCanvas({ state, dispatch, onFileOpen }) {
  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [filter, setFilter] = useState('');
  const [extFilters, setExtFilters] = useState(new Set()); // empty = all
  const [showMinimap, setShowMinimap] = useState(true);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef(null);
  const draggingRef = useRef(null);
  const abortRef = useRef(null);

  // Derive the set of extensions present in the graph for the filter UI.
  const extensionCounts = useMemo(() => {
    const c = new Map();
    for (const n of graph?.nodes || []) c.set(n.ext, (c.get(n.ext) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph?.nodes]);

  const isNodeVisible = (n) => {
    if (extFilters.size > 0 && !extFilters.has(n.ext)) return false;
    return true;
  };
  const toggleExt = (ext) => {
    setExtFilters((cur) => {
      const next = new Set(cur);
      if (next.has(ext)) next.delete(ext); else next.add(ext);
      return next;
    });
  };

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: 'SET_PANEL', panel: 'showCodeCanvas', value: false });
  };

  // Build the graph when the panel opens. Cached within the panel's
  // lifetime — closing and re-opening rebuilds (cheap for small projects,
  // simpler than maintaining a stale cache).
  useEffect(() => {
    if (!state.showCodeCanvas) return;
    if (!state.projectPath || !state.fileTree) return;
    setLoading(true);
    abortRef.current = new AbortController();
    (async () => {
      try {
        const raw = await buildProjectGraph(
          state.fileTree, state.projectPath, state.openFiles,
          { signal: abortRef.current.signal, maxFiles: 200 },
        );
        if (abortRef.current.signal.aborted) return;
        const laid = layoutGraph(raw, { iterations: 150, width: 1400, height: 900 });
        setGraph(laid);
      } finally {
        setLoading(false);
      }
    })();
    return () => abortRef.current?.abort();
  }, [state.showCodeCanvas, state.projectPath, state.fileTree]);

  // Pan handler — we attach move/up listeners to document rather than the
  // SVG so the drag doesn't stop if the cursor leaves the SVG bounds. This
  // is the standard pattern for any drag interaction — cost is one pair of
  // attach/detach per drag start.
  const onMouseDown = (e) => {
    if (e.target.tagName === 'circle' || e.target.tagName === 'text') return;
    e.preventDefault();
    draggingRef.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    const onMove = (ev) => {
      if (!draggingRef.current) return;
      const dx = ev.clientX - draggingRef.current.x;
      const dy = ev.clientY - draggingRef.current.y;
      setTransform((t) => ({ ...t, x: draggingRef.current.tx + dx, y: draggingRef.current.ty + dy }));
    };
    const onUp = () => {
      draggingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({ ...t, k: Math.max(0.2, Math.min(3, t.k * delta)) }));
  };

  const resetView = () => setTransform({ x: 0, y: 0, k: 1 });

  // Highlight neighborhood of hovered node.
  const highlight = useMemo(() => {
    if (!hovered || !graph) return null;
    const inEdges = new Set();
    const outEdges = new Set();
    const neighbors = new Set([hovered]);
    graph.edges.forEach((e, i) => {
      if (e.a.id === hovered) { outEdges.add(i); neighbors.add(e.b.id); }
      if (e.b.id === hovered) { inEdges.add(i);  neighbors.add(e.a.id); }
    });
    return { inEdges, outEdges, neighbors };
  }, [hovered, graph]);

  // Fuzzy filter — not just substring; scores tokens. We use a tiny
  // two-pass: substring wins first, then fuzzy char-skip for the rest.
  // Matches + extension-filter applied.
  const matching = useMemo(() => {
    if (!graph) return null;
    const q = filter.trim().toLowerCase();
    if (!q && extFilters.size === 0) return null;
    const fuzzyMatch = (label) => {
      if (!q) return true;
      const s = label.toLowerCase();
      if (s.includes(q)) return true;
      // char-skip match
      let i = 0;
      for (const c of s) {
        if (c === q[i]) i++;
        if (i === q.length) return true;
      }
      return false;
    };
    return new Set(graph.nodes.filter((n) => fuzzyMatch(n.label) && isNodeVisible(n)).map((n) => n.id));
  }, [filter, graph, extFilters]);

  if (!state.showCodeCanvas) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md animate-fadeIn flex flex-col" onClick={close}>
      <div className="flex-1 flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Top bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border bg-lorica-panel/80 backdrop-blur-xl">
          <Network size={16} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">Code Canvas</div>
          <div className="text-[10px] text-lorica-textDim">
            {graph ? `${graph.nodes.length} files · ${graph.edges.length} imports` : 'building…'}
          </div>
          <div className="flex items-center gap-2 bg-lorica-bg rounded-lg border border-lorica-border px-2 py-1 ml-4">
            <Search size={12} className="text-lorica-textDim" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files…"
              className="bg-transparent outline-none text-[11px] text-lorica-text placeholder:text-lorica-textDim/50 w-48"
            />
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowMinimap((v) => !v)}
            className={`p-1.5 rounded transition-colors ${
              showMinimap ? 'text-lorica-accent bg-lorica-accent/10' : 'text-lorica-textDim hover:text-lorica-accent'
            }`}
            title="Toggle minimap"
          >
            <MapIcon size={13} />
          </button>
          <button onClick={() => setTransform((t) => ({ ...t, k: Math.min(3, t.k * 1.2) }))}
            className="p-1.5 rounded hover:bg-lorica-border/40 text-lorica-textDim hover:text-lorica-accent transition-colors" title="Zoom in">
            <ZoomIn size={13} />
          </button>
          <button onClick={() => setTransform((t) => ({ ...t, k: Math.max(0.2, t.k * 0.8) }))}
            className="p-1.5 rounded hover:bg-lorica-border/40 text-lorica-textDim hover:text-lorica-accent transition-colors" title="Zoom out">
            <ZoomOut size={13} />
          </button>
          <button onClick={resetView}
            className="p-1.5 rounded hover:bg-lorica-border/40 text-lorica-textDim hover:text-lorica-accent transition-colors" title="Reset view">
            <Maximize2 size={13} />
          </button>
          <button onClick={close}
            className="p-1.5 rounded hover:bg-lorica-border/40 text-lorica-textDim hover:text-lorica-text transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Extension filter row — one chip per extension present in the graph. */}
        {!loading && extensionCounts.length > 0 && (
          <div className="flex items-center gap-1 px-5 py-1.5 border-b border-lorica-border bg-lorica-panel/40 flex-wrap">
            <Filter size={10} className="text-lorica-textDim shrink-0" />
            <button
              onClick={() => setExtFilters(new Set())}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                extFilters.size === 0 ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
              }`}
            >
              All
            </button>
            {extensionCounts.map(([ext, count]) => (
              <button
                key={ext}
                onClick={() => toggleExt(ext)}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  extFilters.has(ext) ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim hover:text-lorica-text'
                }`}
              >
                {ext} · {count}
              </button>
            ))}
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 overflow-hidden relative" style={{ background: 'var(--color-bg)' }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-lorica-textDim text-xs gap-3">
              <Loader2 size={30} className="text-lorica-accent animate-spin" />
              Scanning the project and building the dependency graph…
            </div>
          )}

          {!loading && graph && (
            <svg
              ref={svgRef}
              className="w-full h-full cursor-grab active:cursor-grabbing"
              onMouseDown={onMouseDown}
              onWheel={onWheel}
            >
              <defs>
                <marker id="arrow" viewBox="0 -5 10 10" refX="12" refY="0" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0,-4L10,0L0,4" fill="var(--color-border)" />
                </marker>
                <marker id="arrow-active" viewBox="0 -5 10 10" refX="12" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,-4L10,0L0,4" fill="var(--color-accent)" />
                </marker>
                <radialGradient id="nodeGlow">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                {/* Edges */}
                {graph.edges.map((e, i) => {
                  const isIn  = highlight?.inEdges.has(i);
                  const isOut = highlight?.outEdges.has(i);
                  const isActive = isIn || isOut;
                  const dim = highlight && !isActive;
                  return (
                    <line
                      key={i}
                      x1={e.a.x} y1={e.a.y}
                      x2={e.b.x} y2={e.b.y}
                      stroke={isActive ? 'var(--color-accent)' : 'var(--color-border)'}
                      strokeWidth={isActive ? 1.5 : 0.8}
                      strokeOpacity={dim ? 0.12 : 0.55}
                      markerEnd={isActive ? 'url(#arrow-active)' : 'url(#arrow)'}
                    />
                  );
                })}
                {/* Nodes.
                    Perf: at low zoom (<0.6) we skip the <text> label, which
                    collapses ~200 DOM nodes and their font-shaping work. The
                    user can zoom in to read names. Hovered node always has
                    its label so hover tooltip equivalence is preserved. */}
                {graph.nodes.map((n) => {
                  const color = EXT_COLOR[n.ext] || DEFAULT_EXT_COLOR;
                  const r = 4 + Math.min(10, Math.sqrt(n.degree) * 2.2);
                  const isHovered = hovered === n.id;
                  const dim =
                    (highlight && !highlight.neighbors.has(n.id)) ||
                    (matching && !matching.has(n.id));
                  const showLabel = transform.k >= 0.6 || isHovered || matching?.has(n.id);
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      style={{ cursor: 'pointer', opacity: dim ? 0.18 : 1, transition: 'opacity 120ms' }}
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => { onFileOpen(n.path); close(); }}
                    >
                      {isHovered && <circle r={r * 3} fill="url(#nodeGlow)" />}
                      <circle
                        r={r}
                        fill={color}
                        fillOpacity={0.85}
                        stroke={isHovered ? 'var(--color-accent)' : color}
                        strokeWidth={isHovered ? 2 : 1}
                      />
                      {showLabel && (
                        <text
                          y={r + 11}
                          textAnchor="middle"
                          fontSize="9"
                          fontFamily="JetBrains Mono, monospace"
                          fill={isHovered ? 'var(--color-accent)' : 'var(--color-textDim)'}
                          style={{ pointerEvents: 'none' }}
                        >
                          {n.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Minimap overlay — small SVG bird's eye view with a viewport
              rectangle. Clicking or dragging on the minimap re-centers the
              transform. Cheap: same data, different scale. */}
          {!loading && graph && showMinimap && (
            <Minimap
              graph={graph}
              transform={transform}
              setTransform={setTransform}
              matching={matching}
            />
          )}

          {/* Info card for hovered node */}
          {hovered && graph && (() => {
            const n = graph.nodes.find((x) => x.id === hovered);
            if (!n) return null;
            return (
              <div className="absolute bottom-4 left-4 lorica-glass rounded-xl px-4 py-2.5 max-w-[440px] animate-fadeIn">
                <div className="text-xs font-semibold text-lorica-text">{n.label}</div>
                <div className="text-[10px] text-lorica-textDim truncate">{n.path}</div>
                <div className="text-[10px] text-lorica-textDim mt-1">
                  {n.degree} connection{n.degree === 1 ? '' : 's'} · {n.ext.toUpperCase()}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Legend */}
        <div className="px-5 py-2 border-t border-lorica-border text-[10px] text-lorica-textDim flex items-center gap-3 flex-wrap bg-lorica-panel/80 backdrop-blur-xl">
          {Object.entries(EXT_COLOR).map(([ext, c]) => (
            <span key={ext} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: c }} />
              {ext}
            </span>
          ))}
          <div className="flex-1" />
          <span>Drag to pan · Scroll to zoom · Click a node to open</span>
        </div>
      </div>
    </div>
  );
}

// Minimap — small SVG in the bottom-right of the canvas. Shows every
// node + a viewport rectangle derived from the current transform. Click
// or drag to recenter. We compute the node bounding box once per graph
// and map viewport coordinates into that space.
function Minimap({ graph, transform, setTransform, matching }) {
  const W = 180, H = 120;
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graph.nodes) {
      if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x; if (n.y > maxY) maxY = n.y;
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const pad = 30;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [graph.nodes]);
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const sx = W / bw;
  const sy = H / bh;
  const proj = (x, y) => ({ x: (x - bounds.minX) * sx, y: (y - bounds.minY) * sy });

  // Approximate the on-screen viewport. The canvas main SVG doesn't
  // expose its client rect here, but at scale k=1 with transform (0,0)
  // we assume the viewport maps 1:1 to a 1400×900 content area (same
  // dimensions the layout uses). This is a visual hint, not a precise
  // overlay.
  const viewportBounds = {
    x: (-transform.x / transform.k - bounds.minX) * sx,
    y: (-transform.y / transform.k - bounds.minY) * sy,
    w: (1400 / transform.k) * sx,
    h: (900 / transform.k) * sy,
  };

  const recenter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = (e.clientX - rect.left) / W;
    const localY = (e.clientY - rect.top) / H;
    const worldX = bounds.minX + localX * bw;
    const worldY = bounds.minY + localY * bh;
    setTransform({
      ...transform,
      x: -worldX * transform.k + 700,
      y: -worldY * transform.k + 450,
    });
  };

  return (
    <div
      className="absolute bottom-14 right-4 rounded border border-lorica-border bg-lorica-panel/80 backdrop-blur-md shadow-[0_0_20px_rgba(0,0,0,0.3)] overflow-hidden pointer-events-auto"
      style={{ width: W + 2, height: H + 2 }}
      onClick={recenter}
    >
      <svg width={W} height={H} className="cursor-crosshair">
        {graph.edges.map((e, i) => {
          const a = proj(e.a.x, e.a.y), b = proj(e.b.x, e.b.y);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-border)" strokeOpacity={0.3} strokeWidth={0.4} />;
        })}
        {graph.nodes.map((n) => {
          const p = proj(n.x, n.y);
          const isMatch = !matching || matching.has(n.id);
          return (
            <circle key={n.id} cx={p.x} cy={p.y} r={isMatch ? 1.8 : 0.8}
              fill={isMatch ? 'var(--color-accent)' : 'var(--color-border)'}
              fillOpacity={isMatch ? 0.9 : 0.4}
            />
          );
        })}
        <rect
          x={Math.max(0, viewportBounds.x)}
          y={Math.max(0, viewportBounds.y)}
          width={Math.min(W, viewportBounds.w)}
          height={Math.min(H, viewportBounds.h)}
          fill="var(--color-accent)"
          fillOpacity={0.12}
          stroke="var(--color-accent)"
          strokeOpacity={0.5}
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
