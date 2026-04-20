// src/hooks/useAgentTriggers.js
//
// Registers event listeners for every `trigger` declared in a custom
// agent's definition. Supported trigger kinds:
//
//   • onSave — fires when a file transitions from dirty → clean AND the
//     file's relative path matches any of the agent's globs.
//   • shortcut — a keyboard chord; when pressed, the agent starts with
//     the configured prompt pre-filled.
//
// Triggered agents open in the AI panel with a prefilled user message so
// the user still reviews & sends — we never auto-fire the agent's first
// turn. This stays safe by design.

import { useEffect, useRef } from 'react';

function matchesGlob(relPath, pattern) {
  // Very small glob matcher — supports ** and * and literal paths.
  // Good enough for the common "src/**/*.ts" / "*.md" cases.
  const re = new RegExp(
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex chars
      .replace(/\*\*/g, '__DOUBLE_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__DOUBLE_STAR__/g, '.*') +
    '$'
  );
  return re.test(relPath.replace(/\\/g, '/'));
}

function relFromProject(path, projectPath) {
  if (!projectPath || !path) return path || '';
  const norm = (s) => s.replace(/\\/g, '/');
  const a = norm(path); const b = norm(projectPath);
  return a.startsWith(b) ? a.slice(b.length).replace(/^\//, '') : a;
}

function parseChord(str) {
  const parts = (str || '').split('+').map((s) => s.trim().toLowerCase());
  return {
    ctrl: parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
    key: parts[parts.length - 1],
  };
}

export function useAgentTriggers(state, dispatch) {
  const prevDirtyRef = useRef(new Map());

  // Shortcut triggers — one keydown listener for the whole agent list.
  useEffect(() => {
    const handlers = [];
    for (const agent of state.customAgents || []) {
      for (const t of (agent.triggers || [])) {
        if (t.kind !== 'shortcut' || !t.key) continue;
        handlers.push({ agent, trigger: t, chord: parseChord(t.key) });
      }
    }
    if (handlers.length === 0) return;
    const onKey = (e) => {
      for (const h of handlers) {
        const ctrlOk  = (e.ctrlKey || e.metaKey) === h.chord.ctrl;
        const shiftOk = e.shiftKey === h.chord.shift;
        const altOk   = e.altKey === h.chord.alt;
        const keyOk   = (e.key || '').toLowerCase() === h.chord.key;
        if (ctrlOk && shiftOk && altOk && keyOk) {
          e.preventDefault();
          fireAgent(h.agent, h.trigger, { reason: `shortcut ${h.trigger.key}` }, dispatch);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.customAgents, dispatch]);

  // onSave triggers — watch for dirty → clean transitions on open files.
  useEffect(() => {
    if (!(state.customAgents || []).length) return;
    for (const file of state.openFiles || []) {
      if (!file?.path) continue;
      const wasDirty = prevDirtyRef.current.get(file.path);
      prevDirtyRef.current.set(file.path, !!file.dirty);
      if (!wasDirty || file.dirty) continue;
      // Just saved — look for matching agents.
      const relPath = relFromProject(file.path, state.projectPath);
      for (const agent of state.customAgents) {
        for (const t of (agent.triggers || [])) {
          if (t.kind !== 'onSave') continue;
          const globs = Array.isArray(t.globs) ? t.globs : [];
          if (globs.some((g) => matchesGlob(relPath, g))) {
            fireAgent(agent, t, { reason: `save of ${relPath}`, file }, dispatch);
            // Only fire once per save-event per agent.
            break;
          }
        }
      }
    }
  }, [state.openFiles, state.customAgents, state.projectPath, dispatch]);
}

function fireAgent(agent, trigger, ctx, dispatch) {
  const promptBase = trigger.prompt?.trim() || `Trigger: ${ctx.reason}. Proceed with your default role.`;
  const prompt = ctx.file
    ? `${promptBase}\n\nContext — active file: \`${ctx.file.path}\``
    : promptBase;
  // Seed an agent session with this agent's config and pre-fill the user input.
  dispatch({ type: 'SET_PANEL', panel: 'showAIPanel', value: true });
  dispatch({
    type: 'AGENT_SET_CONFIG',
    config: {
      model: agent.model,
      permissions: agent.permissions,
      autoApprove: !!agent.autoApprove,
      context: agent.context || 'none',
      systemPromptOverride: agent.systemPrompt,
      customAgentName: agent.name,
      customAgentIcon: agent.icon,
    },
  });
  dispatch({ type: 'AGENT_PREFILL_INPUT', text: prompt });
  dispatch({ type: 'ADD_TOAST', toast: {
    type: 'info',
    message: `Agent "${agent.name}" triggered — ${ctx.reason}`,
    duration: 2500,
  }});
}
