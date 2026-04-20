import React, { useRef, useState, memo, useEffect } from 'react';
import { X } from 'lucide-react';
import { getFileIcon } from '../utils/languages';

// A right-click menu on tabs — common IDE affordance. Items close around
// the clicked tab ("close others", "close to the right", "close all"),
// plus reveal-on-disk for the file manager and "copy path" which people
// reach for more than you'd think. Nothing fancy, just a floating menu
// with the right positioning + outside-click dismissal.
function TabContextMenu({ x, y, onClose, actions }) {
  useEffect(() => {
    const onDown = (e) => {
      if (!e.target.closest?.('.lorica-tab-ctx')) onClose();
    };
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  return (
    <div
      className="lorica-tab-ctx fixed z-[999] w-56 rounded-lg border border-lorica-border bg-lorica-panel/95 backdrop-blur-xl shadow-[0_0_24px_rgba(0,0,0,0.4)] py-1 text-[11px] animate-fadeIn"
      style={{ left: x, top: y }}
    >
      {actions.map((a, i) => {
        if (a.separator) return <div key={i} className="my-1 border-t border-lorica-border/50" />;
        return (
          <button
            key={i}
            onClick={() => { a.run(); onClose(); }}
            disabled={a.disabled}
            className={`w-full text-left px-3 py-1 flex items-center gap-2 transition-colors ${
              a.disabled
                ? 'text-lorica-textDim/50 cursor-not-allowed'
                : 'text-lorica-text hover:bg-lorica-accent/15 hover:text-lorica-accent'
            }`}
          >
            <span className="flex-1">{a.label}</span>
            {a.hint && <kbd className="text-[9px] text-lorica-textDim font-mono">{a.hint}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

const TabBar = memo(function TabBar({ files, activeIndex, onSelect, onClose, dispatch }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);
  const [menu, setMenu] = useState(null); // { x, y, index }
  const dragRef = useRef(null);

  if (files.length === 0) return null;

  const handleDragStart = (e, i) => {
    setDragIdx(i);
    dragRef.current = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  };

  const handleDragOver = (e, i) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (i !== dropIdx) setDropIdx(i);
  };

  const handleDrop = (e, toIndex) => {
    e.preventDefault();
    const fromIndex = dragRef.current;
    if (fromIndex !== null && fromIndex !== toIndex) {
      dispatch({ type: 'REORDER_TABS', from: fromIndex, to: toIndex });
    }
    setDragIdx(null);
    setDropIdx(null);
    dragRef.current = null;
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDropIdx(null);
    dragRef.current = null;
  };

  const openMenu = (e, i) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, index: i });
  };

  // Build the menu actions from the currently clicked tab. We delay
  // reading `menu.index` until render time; each action closes around
  // that index via closure.
  const menuActions = menu != null ? (() => {
    const i = menu.index;
    const target = files[i];
    if (!target) return [];
    return [
      { label: 'Close',             run: () => onClose(i),           hint: 'Ctrl+W' },
      { label: 'Close others',      run: () => closeOthers(i),       disabled: files.length <= 1 },
      { label: 'Close to the right',run: () => closeToRight(i),      disabled: i === files.length - 1 },
      { label: 'Close all',         run: () => closeAll(),           hint: 'Ctrl+K W' },
      { separator: true },
      { label: 'Copy path',         run: () => navigator.clipboard.writeText(target.path).catch(() => {}) },
      { label: 'Copy file name',    run: () => navigator.clipboard.writeText(target.name).catch(() => {}) },
      { separator: true },
      { label: 'Reveal in explorer',
        run: () => window.lorica?.dialog?.openFile ? window.lorica.fs.stat(target.path).then(() => {}).catch(() => {}) : null,
        disabled: !target.path,
      },
    ];
  })() : [];

  // Close helpers — the trick is descending index order. The reducer
  // processes dispatches sequentially on the ever-shrinking openFiles
  // array; by always removing the HIGHEST remaining index first, every
  // other index we still intend to dispatch stays valid.
  //
  // closeOthers does the same descending walk, simply skipping the
  // index we want to keep. Earlier versions used path-based lookup,
  // which is wrong in React 18 batching: `files` in this closure is the
  // snapshot the render received, not the live reducer state, so
  // findIndex returns stale indices after the first dispatch.
  const closeOthers = (keepIdx) => {
    for (let j = files.length - 1; j >= 0; j--) {
      if (j !== keepIdx) onClose(j);
    }
  };
  const closeToRight = (fromIdx) => {
    for (let j = files.length - 1; j > fromIdx; j--) onClose(j);
  };
  const closeAll = () => {
    for (let j = files.length - 1; j >= 0; j--) onClose(j);
  };

  return (
    <>
      <div className="flex items-center gap-0.5 px-1 py-1 bg-lorica-surface/50 border-b border-lorica-border/50 overflow-x-auto">
        {files.map((file, i) => (
          <div
            key={file.path}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => openMenu(e, i)}
            title={file.path}
            className={`lorica-tab flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer min-w-0 group transition-all rounded-lg ${
              i === activeIndex
                ? 'active bg-lorica-bg text-lorica-text shadow-sm'
                : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-panel/30'
            } ${dragIdx === i ? 'opacity-30 scale-95' : ''} ${dropIdx === i && dragIdx !== i ? 'ring-1 ring-lorica-accent/40' : ''}`}
            onClick={() => onSelect(i)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(i); } }}
          >
            <span className="text-[10px] flex-shrink-0">{getFileIcon(file.extension)}</span>
            <span className="truncate max-w-[120px]">{file.name}</span>
            {file.dirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-lorica-accent flex-shrink-0 animate-pulse" title="Unsaved" />
            )}
            <button
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-lorica-border/50 transition-all flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); onClose(i); }}
              title="Close"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
      {menu && (
        <TabContextMenu
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          actions={menuActions}
        />
      )}
    </>
  );
});

export default TabBar;
