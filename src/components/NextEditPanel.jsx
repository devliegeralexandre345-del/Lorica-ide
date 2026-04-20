// src/components/NextEditPanel.jsx
//
// Small floating panel that appears after an inline AI edit is accepted,
// offering 1-4 predicted follow-up edits across other files. The user can
// ignore it (click away, or press Esc) or click a suggestion to open the
// target file and prefill the Agent with the suggested instruction — the
// agent handles the multi-file context the same way it handles the
// swarm's "Apply via Agent" route, so we don't have to build a second
// editing pipeline.
//
// Intentionally passive: it never auto-applies anything. Even a very
// confident model will occasionally predict useless edits; running them
// silently would erode trust fast.

import React from 'react';
import { Sparkles, ArrowRight, X, Loader2 } from 'lucide-react';
import { recordEditFeedback } from '../utils/predictNextEdit';

export default function NextEditPanel({ state, dispatch }) {
  const data = state.nextEditSuggestions;
  if (!data) return null;
  const close = (outcome = 'ignored') => {
    // Dismissing the whole panel is a soft rejection of every suggestion
    // the user didn't pick. Feeding this back to the predictor nudges it
    // away from similar suggestions in future batches.
    if (outcome === 'rejected') {
      for (const s of (data.suggestions || [])) recordEditFeedback({ outcome: 'rejected', suggestion: s });
    }
    dispatch({ type: 'CLEAR_NEXT_EDITS' });
  };

  const applyOne = (suggestion) => {
    recordEditFeedback({ outcome: 'accepted', suggestion });
    // Other suggestions in the batch are implicitly rejected — the user
    // chose one over them.
    for (const s of (data.suggestions || [])) {
      if (s !== suggestion) recordEditFeedback({ outcome: 'rejected', suggestion: s });
    }
    const text = `Follow-up edit from the last inline change. Apply the following to \`${suggestion.path}\`:\n\n${suggestion.instruction}\n\n(Reason: ${suggestion.reason})\n\nRead the file first, then make the minimal change.`;
    dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
    dispatch({ type: 'AGENT_PREFILL_INPUT', text });
    dispatch({ type: 'CLEAR_NEXT_EDITS' });
  };

  return (
    <div className="fixed top-14 right-4 z-[990] w-[360px] lorica-glass rounded-xl shadow-[0_0_30px_rgba(0,212,255,0.25)] animate-slideInRight overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-lorica-border">
        <Sparkles size={13} className="text-lorica-accent" />
        <div className="text-[11px] font-semibold text-lorica-text">Next edits predicted</div>
        {data.loading && <Loader2 size={12} className="animate-spin text-lorica-accent ml-auto" />}
        {!data.loading && (
          <button onClick={() => close('rejected')} className="ml-auto p-1 rounded hover:bg-lorica-border/40 text-lorica-textDim hover:text-lorica-text transition-colors">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {data.loading && (
          <div className="px-3 py-3 text-[10px] text-lorica-textDim">
            Looking across the project for follow-up edits…
          </div>
        )}
        {!data.loading && (data.suggestions || []).length === 0 && (
          <div className="px-3 py-3 text-[10px] text-lorica-textDim">
            No follow-up edits needed — the change looks self-contained.
          </div>
        )}
        {(data.suggestions || []).map((s, i) => (
          <button
            key={i}
            onClick={() => applyOne(s)}
            className="w-full text-left px-3 py-2 border-b border-lorica-border/50 hover:bg-lorica-accent/10 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-lorica-accent truncate">{s.path}</span>
              <ArrowRight size={10} className="text-lorica-textDim group-hover:text-lorica-accent transition-colors ml-auto shrink-0" />
            </div>
            <div className="text-[10px] text-lorica-text/80 mt-0.5">{s.instruction}</div>
            {s.reason && <div className="text-[9px] text-lorica-textDim italic mt-0.5">{s.reason}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
