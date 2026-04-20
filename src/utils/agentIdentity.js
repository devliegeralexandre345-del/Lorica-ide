// src/utils/agentIdentity.js
//
// Persistent identity for the user's agent. Stored at
// `<project>/.lorica/identity.json` (per-project override) with a
// user-wide fallback at `localStorage['lorica.identity.global.v1']`.
//
// The identity carries: a name, tone/verbosity knobs, proactivity level,
// style notes, and a growing `personalMemory` list — short declarative
// facts about the user ("prefers terse answers", "writes Rust daily",
// "dislikes emoji", "uses semicolons"). Every new session prepends a
// compact identity preamble so the agent shows up as the same entity.
//
// The identity preamble is intentionally distinct from Project Brain:
//   • Brain = what's true about the PROJECT (decisions, facts).
//   • Identity = what's true about the USER and the agent's own style.

const GLOBAL_KEY = 'lorica.identity.global.v1';

export const DEFAULT_IDENTITY = {
  name: 'Lorica',
  tone: 'warm',              // 'warm' | 'terse' | 'neutral' | 'playful'
  proactivity: 'balanced',   // 'passive' | 'balanced' | 'proactive'
  verbosity: 'concise',      // 'concise' | 'normal' | 'detailed'
  styleNotes: '',
  personalMemory: [],        // array of short strings
  updatedAt: null,
};

function identityPath(projectPath) {
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath}${sep}.lorica${sep}identity.json`;
}

function ensureDir(projectPath) {
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const dir = `${projectPath}${sep}.lorica`;
  return window.lorica.fs.createDir(dir).catch(() => {});
}

export async function loadIdentity(projectPath) {
  // Project-scoped takes precedence, global is the baseline.
  let global = DEFAULT_IDENTITY;
  try {
    const raw = localStorage.getItem(GLOBAL_KEY);
    if (raw) global = { ...DEFAULT_IDENTITY, ...JSON.parse(raw) };
  } catch {}
  if (!projectPath) return global;
  const p = identityPath(projectPath);
  try {
    const r = await window.lorica.fs.readFile(p);
    if (r?.success) {
      return { ...global, ...JSON.parse(r.data.content || '{}') };
    }
  } catch {}
  return global;
}

export async function saveIdentity(projectPath, identity, { scope = 'project' } = {}) {
  const withTs = { ...identity, updatedAt: new Date().toISOString() };
  if (scope === 'global' || !projectPath) {
    try { localStorage.setItem(GLOBAL_KEY, JSON.stringify(withTs)); } catch {}
    return withTs;
  }
  await ensureDir(projectPath);
  const p = identityPath(projectPath);
  await window.lorica.fs.writeFile(p, JSON.stringify(withTs, null, 2));
  return withTs;
}

/**
 * Build the preamble that gets prepended to the agent's system prompt.
 * Kept short — the identity is a *lens*, not a dumping ground.
 */
export function buildIdentityPreamble(identity) {
  if (!identity) return '';
  const lines = [];
  if (identity.name && identity.name !== 'Lorica') {
    lines.push(`You are "${identity.name}", the user's personal coding agent.`);
  }
  const toneMap = {
    warm:    'Warm and encouraging, never condescending.',
    terse:   'Very terse. No greetings, no confirmations, only signal.',
    neutral: 'Neutral professional tone.',
    playful: 'Light and playful when appropriate; never at the expense of accuracy.',
  };
  if (identity.tone && toneMap[identity.tone]) lines.push(`Tone: ${toneMap[identity.tone]}`);
  const verbMap = {
    concise:  'Default to concise answers (1-3 paragraphs). Expand only on request.',
    normal:   'Default to normal detail.',
    detailed: 'Default to detailed, comprehensive explanations.',
  };
  if (identity.verbosity && verbMap[identity.verbosity]) lines.push(verbMap[identity.verbosity]);
  const proactMap = {
    passive:    'Do only what is asked. Never volunteer side tasks.',
    balanced:   'Suggest related follow-ups when obviously useful, but do not act on them unless asked.',
    proactive:  'Volunteer related improvements, fix adjacent issues when safe, flag risks proactively.',
  };
  if (identity.proactivity && proactMap[identity.proactivity]) lines.push(proactMap[identity.proactivity]);
  if (identity.styleNotes?.trim()) lines.push(`Style notes: ${identity.styleNotes.trim()}`);
  if (identity.personalMemory?.length) {
    lines.push('Things you know about the user:');
    for (const m of identity.personalMemory.slice(0, 15)) lines.push(`  • ${m}`);
  }
  return lines.join('\n');
}
