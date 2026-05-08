// src/components/GitGraph.jsx
//
// Pure-SVG git graph view. Loads `cmd_git_graph` (parents + refs), runs
// it through `gitGraphLayout` for lane assignment, then paints:
//   • one <line> per parent edge (curved when changing lanes)
//   • one <circle> per commit
//   • one row of metadata text (subject, author, ago) to the right
//
// A row is clickable → calls `onSelectCommit(hash)` so the parent
// (GitPanel) can render a details/diff view.
//
// Performance:
//   • Default fetch limit is 100 commits — same scale as the Log view's
//     20-commit window but big enough to actually look like a graph.
//   • If the dataset grows past 200 rows we manually window: only
//     render rows in `[scrollTop/ROW_HEIGHT - 10, +60]`. Edges that span
//     the window are still drawn so lines aren't cut off mid-merge.
//   • Layout is memoised on the commits array reference; refresh-only
//     re-renders are free until the underlying log changes.

import React, { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import { GitCommit, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import {
  layoutGitGraph,
  ROW_HEIGHT,
  LANE_WIDTH,
  DOT_RADIUS,
  PADDING_X,
  PADDING_Y,
  laneColor,
} from '../utils/gitGraphLayout';

const VIRTUALIZE_THRESHOLD = 200;
const VIRTUAL_OVERSCAN = 10;     // rows rendered above the visible window
const VIRTUAL_WINDOW = 60;       // rows rendered below the visible window

// Friendly relative-time formatter. Avoids pulling in date-fns / dayjs.
function ago(unixSec) {
  if (!unixSec) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - unixSec);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

// Render one ref label (branch or tag) as a small chip. Tags get a slightly
// dimmer background so the eye picks branch tips first.
const RefChip = memo(function RefChip({ name }) {
  const isTag = name.startsWith('tag: ');
  const display = isTag ? name.slice(5) : name;
  const isHead = name === 'HEAD';
  return (
    <span
      className={`inline-flex items-center px-1 rounded text-[9px] font-mono mr-1 leading-tight ${
        isHead
          ? 'bg-lorica-accent/30 text-lorica-accent border border-lorica-accent/60'
          : isTag
            ? 'bg-lorica-panel/60 text-lorica-textDim border border-lorica-border'
            : 'bg-lorica-accent/15 text-lorica-text border border-lorica-accent/30'
      }`}
      title={name}
    >
      {isTag ? `🏷 ${display}` : display}
    </span>
  );
});

// One row in the right-hand metadata column. Memoised so a hover on a
// neighbour doesn't re-render the whole list.
const CommitRow = memo(function CommitRow({ node, selected, onSelect, top }) {
  return (
    <div
      onClick={() => onSelect(node.hash)}
      className={`absolute left-0 right-0 flex items-center gap-2 px-2 cursor-pointer transition-colors ${
        selected
          ? 'bg-lorica-accent/15'
          : 'hover:bg-lorica-panel/40'
      }`}
      style={{ top, height: ROW_HEIGHT }}
      title={node.message}
    >
      <span
        className="font-mono text-[10px] flex-shrink-0"
        style={{ color: node.color }}
      >
        {node.short_hash}
      </span>
      {node.refs && node.refs.length > 0 && (
        <span className="flex flex-wrap items-center max-w-[40%] overflow-hidden">
          {node.refs.slice(0, 3).map((r) => <RefChip key={r} name={r} />)}
        </span>
      )}
      <span className="flex-1 truncate text-[11px] text-lorica-text">
        {node.message}
      </span>
      <span className="text-[9px] text-lorica-textDim flex-shrink-0">
        {node.author} · {ago(node.date)}
      </span>
    </div>
  );
});

export default function GitGraph({ projectPath, onSelectCommit }) {
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedHash, setSelectedHash] = useState(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const scrollerRef = useRef(null);

  // ----------------------------------------------------------------
  // Fetch
  // ----------------------------------------------------------------
  const fetchGraph = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.lorica.git.graph(projectPath, 100);
      if (res?.success === false) {
        setError(res.error || 'git log failed');
        setCommits([]);
        return;
      }
      const data = Array.isArray(res) ? res : (res?.data || []);
      setCommits(data);
    } catch (e) {
      setError(String(e?.message || e));
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // ----------------------------------------------------------------
  // Layout — memoised on the commits array reference.
  // ----------------------------------------------------------------
  const layout = useMemo(() => layoutGitGraph(commits), [commits]);

  // Track scroller height for virtualization. Resize observer keeps
  // us honest if the side-panel is dragged.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // ----------------------------------------------------------------
  // Window the rendered range only when the dataset is large.
  // For < VIRTUALIZE_THRESHOLD rows we just render everything — DOM
  // overhead is negligible at that scale and we avoid a coordinate-
  // translation pass.
  // ----------------------------------------------------------------
  const totalH = PADDING_Y * 2 + layout.totalRows * ROW_HEIGHT;
  const graphW = PADDING_X * 2 + Math.max(1, layout.maxLane + 1) * LANE_WIDTH;

  const useWindow = layout.totalRows > VIRTUALIZE_THRESHOLD;
  const firstVisibleRow = useWindow
    ? Math.max(0, Math.floor((scrollTop - PADDING_Y) / ROW_HEIGHT) - VIRTUAL_OVERSCAN)
    : 0;
  const lastVisibleRow = useWindow
    ? Math.min(layout.totalRows - 1, firstVisibleRow + VIRTUAL_OVERSCAN + Math.ceil(viewportH / ROW_HEIGHT) + VIRTUAL_WINDOW)
    : layout.totalRows - 1;

  const visibleNodes = useMemo(() => {
    if (!useWindow) return layout.nodes;
    return layout.nodes.slice(firstVisibleRow, lastVisibleRow + 1);
  }, [layout.nodes, useWindow, firstVisibleRow, lastVisibleRow]);

  const visibleEdges = useMemo(() => {
    if (!useWindow) return layout.edges;
    // Keep any edge that intersects the visible window — this prevents
    // long edges (e.g. a stale topic branch merging back to main) from
    // disappearing while the user scrolls past their endpoints.
    const winTop = firstVisibleRow * ROW_HEIGHT + PADDING_Y;
    const winBot = lastVisibleRow * ROW_HEIGHT + PADDING_Y + ROW_HEIGHT;
    return layout.edges.filter((e) =>
      !(Math.max(e.y1, e.y2) < winTop || Math.min(e.y1, e.y2) > winBot)
    );
  }, [layout.edges, useWindow, firstVisibleRow, lastVisibleRow]);

  const handleSelect = useCallback((hash) => {
    setSelectedHash(hash);
    onSelectCommit?.(hash);
  }, [onSelectCommit]);

  // ----------------------------------------------------------------
  // Empty / error states
  // ----------------------------------------------------------------
  if (loading && commits.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-xs text-lorica-textDim">
        <RefreshCw size={14} className="animate-spin mr-2" /> Loading graph…
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-[400px] flex flex-col items-center justify-center px-4 text-center text-xs text-lorica-textDim">
        <GitCommit size={28} className="mb-2 opacity-30" />
        <div>Couldn’t load history</div>
        <div className="opacity-60 mt-1 max-w-xs break-words">{error}</div>
        <button
          onClick={fetchGraph}
          className="mt-3 px-2 py-1 text-[10px] bg-lorica-accent/20 text-lorica-accent rounded hover:bg-lorica-accent/30"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!loading && commits.length === 0) {
    return (
      <div className="h-[400px] flex flex-col items-center justify-center px-4 text-center text-xs text-lorica-textDim">
        <GitCommit size={28} className="mb-2 opacity-30" />
        <div>No commits yet</div>
        <div className="opacity-60 mt-1">Make your first commit to populate the graph.</div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="h-[400px] overflow-auto relative border-t border-lorica-border/50"
      style={{ contain: 'strict' }}
    >
      {/* Spacer fills the full virtual height so the scrollbar reflects the
          real number of commits even when only a slice is rendered. */}
      <div style={{ height: totalH, position: 'relative' }}>
        {/* The SVG sits absolutely-positioned at the left, drawing edges
            and dots across the full chart height. We don't shrink it to
            the visible window because that would require translating every
            edge endpoint and would jitter on every scroll frame. */}
        <svg
          width={graphW}
          height={totalH}
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          {visibleEdges.map((e, i) => {
            // Smooth diagonal: use a cubic Bezier with control points at
            // half-row spacing so lane changes look like rivers rather than
            // angular zigzags. For purely vertical edges (same lane), a
            // straight <line> is cheaper.
            if (e.x1 === e.x2) {
              return (
                <line
                  key={i}
                  x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                  stroke={e.color}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              );
            }
            const midY = (e.y1 + e.y2) / 2;
            const d = `M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`;
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={e.color}
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity={e.merge ? 0.85 : 1}
              />
            );
          })}
          {visibleNodes.map((n) => (
            <g key={n.hash}>
              <circle
                cx={n.x}
                cy={n.y}
                r={DOT_RADIUS + (n.refs && n.refs.length ? 1 : 0)}
                fill={n.color}
                stroke={selectedHash === n.hash ? 'var(--color-text)' : 'var(--color-bg)'}
                strokeWidth={selectedHash === n.hash ? 2 : 1.5}
              />
              {n.parents && n.parents.length >= 2 && (
                // Inner ring for merges so the eye picks them out. Cheap
                // visual cue, no extra data needed.
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={DOT_RADIUS - 1.5}
                  fill="var(--color-bg)"
                />
              )}
            </g>
          ))}
        </svg>

        {/* Right-hand text column. Absolute-positioned rows so we can
            window them cheaply. Left margin equals the SVG width so text
            never overlaps the lanes. */}
        <div style={{ position: 'absolute', left: graphW, right: 0, top: 0, bottom: 0 }}>
          {visibleNodes.map((n) => (
            <CommitRow
              key={n.hash}
              node={n}
              selected={selectedHash === n.hash}
              onSelect={handleSelect}
              top={n.y - ROW_HEIGHT / 2 + PADDING_Y / 2}
            />
          ))}
        </div>

        {/* Subtle status pill bottom-right while a refresh is in flight. */}
        {loading && commits.length > 0 && (
          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-lorica-panel/80 border border-lorica-border text-[9px] text-lorica-textDim flex items-center gap-1">
            <RefreshCw size={10} className="animate-spin" /> refresh
          </div>
        )}
      </div>
    </div>
  );
}
