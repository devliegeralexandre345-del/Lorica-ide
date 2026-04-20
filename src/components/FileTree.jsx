import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, RefreshCw, FilePlus, FolderPlus, Trash2, Pencil, X, Check, Flame, Filter, Copy } from 'lucide-react';
import { getFileIcon } from '../utils/languages';

// Recursive tree filter — returns a new tree containing only nodes whose
// name matches the query, including every ancestor so the path stays
// rendered. A directory is retained if any of its descendants matches.
function filterTree(nodes, query) {
  if (!query) return nodes;
  const q = query.toLowerCase();
  const walk = (list) => {
    const out = [];
    for (const node of list || []) {
      if (node.isDirectory) {
        const kept = walk(node.children || []);
        if (kept.length > 0 || node.name.toLowerCase().includes(q)) {
          out.push({ ...node, children: kept, _filtered: true });
        }
      } else if (node.name.toLowerCase().includes(q)) {
        out.push(node);
      }
    }
    return out;
  };
  return walk(nodes);
}

// Resolve a file's churn score from the heatmap index. We accept both a
// relative-path lookup (built at ingest time) and a fallback absolute-path
// one — the tree gives us absolute paths, but the index also carries the
// relative key for symmetry with the backend output.
function lookupHeat(heatmap, absPath) {
  if (!heatmap) return null;
  const norm = absPath.replace(/\\/g, '/').toLowerCase();
  return heatmap.byAbs?.get(norm) || null;
}

// Blend an accent-tinted background for a given 0-1 score. We use a fixed
// warm palette (yellow → orange → red) that reads the same across themes
// because it's semantic, not stylistic. Ceilings at ~28% opacity so it
// never fights with hover/focus highlights.
function heatTint(score) {
  if (!score || score <= 0) return null;
  const capped = Math.min(1, score);
  // Pure CSS-only blend via mix-blend or layered rgba background. Direct
  // rgba is simplest and renders identically on all themes.
  const alpha = 0.06 + capped * 0.22;
  // Yellow → red depending on intensity.
  const r = 255;
  const g = Math.round(210 - capped * 160);
  const b = Math.round(50 - capped * 50);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

// Inline name input component
function InlineInput({ defaultValue, onConfirm, onCancel, placeholder }) {
  const ref = useRef(null);
  const [value, setValue] = useState(defaultValue || '');

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const handleKey = (e) => {
    if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="flex items-center gap-1 px-1">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => { if (value.trim()) onConfirm(value.trim()); else onCancel(); }}
        placeholder={placeholder}
        className="flex-1 bg-lorica-bg border border-lorica-accent rounded px-1.5 py-0.5 text-[11px] text-lorica-text outline-none"
      />
    </div>
  );
}

function TreeNode({ node, depth, onFileClick, onRefresh, projectPath, fs, dispatch, heatmap, forceExpanded = false }) {
  // When the parent is showing filter results we auto-expand every dir
  // so matches in deep paths aren't hidden behind a chevron. If the user
  // collapses manually the local state still wins — that's the standard
  // IDE UX for tree filters.
  const [expanded, setExpanded] = useState(depth === 0 || forceExpanded);
  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);
  const [creating, setCreating] = useState(null); // 'file' | 'dir' | null
  const [renaming, setRenaming] = useState(false);
  const [showContext, setShowContext] = useState(false);

  const handleClick = () => {
    if (node.isDirectory) {
      setExpanded(!expanded);
    } else {
      onFileClick(node.path);
    }
  };

  const handleCreate = async (name, type) => {
    const dirPath = node.isDirectory ? node.path : node.path.replace(/[/\\][^/\\]+$/, '');
    if (type === 'file') {
      const path = await fs.createNewFile(dirPath, name);
      if (path) {
        dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Created ${name}`, duration: 1500 } });
        onRefresh();
        onFileClick(path);
      }
    } else {
      const path = await fs.createNewDir(dirPath, name);
      if (path) {
        dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Created folder ${name}`, duration: 1500 } });
        onRefresh();
      }
    }
    setCreating(null);
  };

  const handleRename = async (newName) => {
    const parentDir = node.path.replace(/[/\\][^/\\]+$/, '');
    const newPath = `${parentDir}/${newName}`;
    const ok = await fs.renamePath(node.path, newPath);
    if (ok) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Renamed to ${newName}`, duration: 1500 } });
      onRefresh();
    }
    setRenaming(false);
  };

  const handleDelete = async () => {
    const ok = await fs.deletePath(node.path);
    if (ok) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'info', message: `Deleted ${node.name}`, duration: 1500 } });
      onRefresh();
    }
    setShowContext(false);
  };

  // Heatmap: tint the row background proportionally to file churn.
  // Directories don't get tinted — only leaf files, since a folder's
  // aggregate churn is harder to read in a colour mapping.
  const heat = !node.isDirectory ? lookupHeat(heatmap, node.path) : null;
  const tint = heat ? heatTint(heat.score) : null;
  const heatTitle = heat
    ? `${heat.commits} commit${heat.commits === 1 ? '' : 's'} · +${heat.linesAdded} / -${heat.linesRemoved} lines`
      + (heat.authors?.length ? `\nAuthors: ${heat.authors.slice(0, 5).map((a) => `${a.name} (${a.count})`).join(', ')}${heat.authors.length > 5 ? ` +${heat.authors.length - 5}` : ''}` : '')
      + (heat.busFactor != null ? `\nBus factor: ${heat.busFactor}${heat.busFactor === 1 ? ' ⚠ solo-owned' : ''}` : '')
    : undefined;

  return (
    <div className="animate-slideIn">
      <div
        className="flex items-center gap-1.5 pr-2 py-0.5 text-xs hover:bg-lorica-panel/60 transition-colors group relative"
        style={{ paddingLeft: `${depth * 14 + 8}px`, background: tint || undefined }}
        title={heatTitle}
        onContextMenu={(e) => { e.preventDefault(); setShowContext(!showContext); }}
      >
        {/* Expand arrow or spacer */}
        <button onClick={handleClick} className="flex items-center gap-1.5 flex-1 min-w-0 truncate">
          {node.isDirectory ? (
            expanded ? <ChevronDown size={12} className="text-lorica-textDim flex-shrink-0" /> : <ChevronRight size={12} className="text-lorica-textDim flex-shrink-0" />
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}

          {renaming ? null : (
            <>
              <span className="flex-shrink-0 text-[11px]">{getFileIcon(node.extension, node.isDirectory)}</span>
              <span className={`truncate ${node.isDirectory ? 'text-lorica-text font-medium' : 'text-lorica-textDim group-hover:text-lorica-text'}`}>
                {node.name}
              </span>
              {heat?.busFactor === 1 && heat.commits >= 3 && (
                <span className="text-red-400 text-[9px]" title="Bus factor 1 — solo-owned">⚠</span>
              )}
            </>
          )}
        </button>

        {/* Rename inline */}
        {renaming && (
          <div className="flex-1">
            <InlineInput
              defaultValue={node.name}
              onConfirm={handleRename}
              onCancel={() => setRenaming(false)}
              placeholder="New name..."
            />
          </div>
        )}

        {/* Hover actions */}
        {!renaming && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0">
            {node.isDirectory && (
              <>
                <button onClick={(e) => { e.stopPropagation(); setExpanded(true); setCreating('file'); }} className="p-0.5 text-lorica-textDim hover:text-lorica-accent rounded" title="New File">
                  <FilePlus size={12} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); setExpanded(true); setCreating('dir'); }} className="p-0.5 text-lorica-textDim hover:text-green-400 rounded" title="New Folder">
                  <FolderPlus size={12} />
                </button>
              </>
            )}
            <button onClick={(e) => { e.stopPropagation(); setRenaming(true); }} className="p-0.5 text-lorica-textDim hover:text-amber-400 rounded" title="Rename">
              <Pencil size={11} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleDelete(); }} className="p-0.5 text-lorica-textDim hover:text-red-400 rounded" title="Delete">
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {node.isDirectory && expanded && (
        <div>
          {/* Inline creation input */}
          {creating && (
            <div style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }} className="py-0.5">
              <InlineInput
                placeholder={creating === 'file' ? 'filename.ext' : 'folder name'}
                onConfirm={(name) => handleCreate(name, creating)}
                onCancel={() => setCreating(null)}
              />
            </div>
          )}
          {node.children && node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              onRefresh={onRefresh}
              projectPath={projectPath}
              fs={fs}
              dispatch={dispatch}
              heatmap={heatmap}
              forceExpanded={forceExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileTree({ tree, projectPath, onFileClick, onRefresh, dispatch, fs, heatmap, heatmapEnabled, heatmapRange, onHeatmapToggle, onHeatmapRangeChange, heatmapLoading }) {
  const [creatingRoot, setCreatingRoot] = useState(null);
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  // Memoize the filter pass — can be moderately expensive for large trees,
  // but not catastrophic since we just walk once. Empty filter = identity.
  const filteredTree = useMemo(
    () => filter ? filterTree(tree, filter.trim()) : tree,
    [tree, filter]
  );

  const handleRootCreate = async (name, type) => {
    if (!projectPath || !fs) return;
    if (type === 'file') {
      const path = await fs.createNewFile(projectPath, name);
      if (path) {
        dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Created ${name}` } });
        onRefresh();
        onFileClick(path);
      }
    } else {
      const path = await fs.createNewDir(projectPath, name);
      if (path) {
        dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Created folder ${name}` } });
        onRefresh();
      }
    }
    setCreatingRoot(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-lorica-border">
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Explorer</span>
        <div className="flex items-center gap-0.5">
          {projectPath && (
            <button
              onClick={() => setShowFilter((v) => !v)}
              className={`p-1 transition-colors rounded ${showFilter || filter ? 'text-lorica-accent' : 'text-lorica-textDim hover:text-lorica-accent'}`}
              title="Quick filter (fuzzy file filter)"
            >
              <Filter size={13} />
            </button>
          )}
          {projectPath && (
            <button
              onClick={onHeatmapToggle}
              className={`p-1 transition-colors rounded ${heatmapEnabled ? 'text-amber-400' : 'text-lorica-textDim hover:text-amber-400'}`}
              title={heatmapEnabled
                ? `Code heatmap ON — colour = recent churn over ${heatmapRange}d`
                : 'Toggle code heatmap'}
            >
              <Flame size={13} className={heatmapLoading ? 'animate-pulse' : ''} />
            </button>
          )}
          {projectPath && fs && (
            <>
              <button onClick={() => setCreatingRoot('file')} className="p-1 text-lorica-textDim hover:text-lorica-accent transition-colors rounded" title="New File">
                <FilePlus size={13} />
              </button>
              <button onClick={() => setCreatingRoot('dir')} className="p-1 text-lorica-textDim hover:text-green-400 transition-colors rounded" title="New Folder">
                <FolderPlus size={13} />
              </button>
            </>
          )}
          <button onClick={onRefresh} className="p-1 text-lorica-textDim hover:text-lorica-accent transition-colors rounded" title="Refresh">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      {showFilter && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-lorica-border/50 bg-lorica-panel/40">
          <Filter size={10} className="text-lorica-textDim shrink-0" />
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setFilter(''); setShowFilter(false); } }}
            placeholder="Filter files…"
            className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-lorica-accent/50"
          />
          {filter && (
            <button onClick={() => setFilter('')} className="text-lorica-textDim hover:text-red-400">
              <X size={9} />
            </button>
          )}
        </div>
      )}
      {heatmapEnabled && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-lorica-border bg-amber-400/5 text-[10px]">
          <Flame size={10} className="text-amber-400" />
          <span className="text-lorica-textDim">Churn over last</span>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => onHeatmapRangeChange(d)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                heatmapRange === d
                  ? 'bg-amber-400/20 text-amber-400 border border-amber-400/40'
                  : 'text-lorica-textDim hover:text-amber-400 border border-transparent'
              }`}
            >
              {d}d
            </button>
          ))}
          <span className="ml-auto text-lorica-textDim/70">
            {heatmapLoading ? 'loading…' : `${heatmap?.byAbs?.size || 0} files`}
          </span>
        </div>
      )}

      {/* Project name */}
      {projectPath && (
        <div className="px-3 py-1.5 text-[10px] text-lorica-accent font-mono truncate border-b border-lorica-border/50">
          {projectPath.split(/[/\\]/).pop()}
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Root creation input */}
        {creatingRoot && (
          <div className="px-2 py-1">
            <InlineInput
              placeholder={creatingRoot === 'file' ? 'filename.ext' : 'folder name'}
              onConfirm={(name) => handleRootCreate(name, creatingRoot)}
              onCancel={() => setCreatingRoot(null)}
            />
          </div>
        )}

        {filteredTree.length > 0 ? (
          filteredTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              onFileClick={onFileClick}
              onRefresh={onRefresh}
              projectPath={projectPath}
              fs={fs}
              dispatch={dispatch}
              heatmap={heatmap}
              forceExpanded={!!filter}
            />
          ))
        ) : filter ? (
          <div className="px-3 py-4 text-center text-[11px] text-lorica-textDim">
            No files match "{filter}"
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-lorica-textDim text-xs">
            <div className="mb-2 opacity-40 text-2xl">📁</div>
            <div>No folder open</div>
            <div className="text-[10px] mt-1 opacity-60">File → Open Folder</div>
          </div>
        )}
      </div>
    </div>
  );
}
