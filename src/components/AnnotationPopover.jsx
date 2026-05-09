// src/components/AnnotationPopover.jsx
//
// Inline read-only preview of the annotations attached to a line
// (Wave 15). Anchored at the gutter dot the user just clicked. Shows
// up to 4 notes per line; if the line has more, a footer line nudges
// the user to open the panel for the full list.
//
// Read-only by design — editing requires the panel (which has the
// rich textarea + colour picker + delete affordance). The popover is
// for "what does this dot say" without breaking flow.

import React, { useEffect, useRef } from 'react';
import { StickyNote, ChevronRight, Pin } from 'lucide-react';
import { renderInlineMarkdown } from '../utils/inlineMarkdown';

const COLOR_BG = {
  amber:   { bg: 'bg-amber-400/10',   border: 'border-amber-400/40',   dot: 'bg-amber-400'   },
  blue:    { bg: 'bg-sky-400/10',     border: 'border-sky-400/40',     dot: 'bg-sky-400'     },
  rose:    { bg: 'bg-rose-400/10',    border: 'border-rose-400/40',    dot: 'bg-rose-400'    },
  emerald: { bg: 'bg-emerald-400/10', border: 'border-emerald-400/40', dot: 'bg-emerald-400' },
  violet:  { bg: 'bg-violet-400/10',  border: 'border-violet-400/40',  dot: 'bg-violet-400'  },
};

const MAX_NOTES = 4;

function fmtAge(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export default function AnnotationPopover({ peek, onClose, onOpenPanel }) {
  const ref = useRef(null);

  // Click-outside / Escape to close. Clicks inside the popover OR on
  // another gutter dot (which would re-open with new content) skip the
  // close to avoid a "click-flicker" feel.
  useEffect(() => {
    if (!peek) return undefined;
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      if (e.target?.closest?.('.cm-annotation-dot')) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [peek, onClose]);

  if (!peek) return null;

  const list = (peek.annotations || []).slice(0, MAX_NOTES);
  const overflow = (peek.annotations || []).length - list.length;

  // Position: the gutter handler captured the dot's right edge. We
  // clamp to the viewport to avoid spilling off-screen on narrow
  // splits.
  const x = Math.min(peek.anchor?.x || 0, window.innerWidth - 360);
  const y = Math.min(peek.anchor?.y || 0, window.innerHeight - 200);

  return (
    <div
      ref={ref}
      className="fixed z-40 w-[340px] lorica-glass rounded-lg shadow-[0_0_24px_rgba(0,0,0,0.4)] border border-lorica-border animate-fadeIn overflow-hidden"
      style={{ left: x, top: y }}
      role="dialog"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-lorica-border bg-lorica-surface/40">
        <StickyNote size={11} className="text-amber-400" />
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">
          Line {peek.line} · {peek.annotations?.length || 0} note{(peek.annotations?.length || 0) === 1 ? '' : 's'}
        </span>
        <div className="flex-1" />
        <button
          onClick={onOpenPanel}
          className="flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-lorica-accent"
          title="Open full annotations panel for editing"
        >
          edit <ChevronRight size={9} />
        </button>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {list.map((a) => {
          const meta = COLOR_BG[a.color] || COLOR_BG.amber;
          return (
            <div
              key={a.id}
              className={`px-3 py-2 border-b border-lorica-border/60 last:border-b-0 ${meta.bg}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                {a.pinned && <Pin size={9} className="text-lorica-textDim" />}
                {a.author && (
                  <span className="text-[9px] italic text-lorica-textDim truncate max-w-[140px]">
                    {a.author}
                  </span>
                )}
                <div className="flex-1" />
                <span className="text-[9px] text-lorica-textDim">{fmtAge(a.updatedAt || a.createdAt)}</span>
              </div>
              <div className="text-[11px] text-lorica-text whitespace-pre-wrap font-sans leading-snug">
                {a.text
                  ? renderInlineMarkdown(a.text)
                  : <span className="italic text-lorica-textDim">(empty note)</span>}
              </div>
              {/* Wave 20 — show reply count, with the latest 2 replies
                  as a preview. Full thread requires the panel for
                  add/edit (the popover stays read-only). */}
              {Array.isArray(a.replies) && a.replies.length > 0 && (
                <div className="mt-2 pl-3 border-l border-lorica-border/50 space-y-1">
                  {a.replies.slice(-2).map((r) => (
                    <div key={r.id} className="text-[10px] text-lorica-textDim">
                      <span className="italic mr-1">{r.author || 'anon'}:</span>
                      <span className="text-lorica-text">
                        {renderInlineMarkdown(r.text)}
                      </span>
                    </div>
                  ))}
                  {a.replies.length > 2 && (
                    <div className="text-[9px] text-lorica-textDim/70">+ {a.replies.length - 2} earlier replies — open panel</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {overflow > 0 && (
          <button
            onClick={onOpenPanel}
            className="w-full px-3 py-1.5 text-[10px] text-lorica-textDim hover:text-lorica-accent hover:bg-lorica-border/30 text-left"
          >
            + {overflow} more — open panel to see all
          </button>
        )}
      </div>
    </div>
  );
}
