// src/utils/completions/recencyStore.js
//
// Per-language "what did the user pick recently from the autocomplete
// dropdown" store. The static completion source reads this on every
// query to apply a small (<= +20) `boost` to recently accepted entries
// so they sort to the top — the IDE behavior users expect from VS
// Code, IntelliJ, etc. ("what I just typed appears first next time").
//
// Why a module-level store rather than React state:
//   - The static completion source factory is created inside
//     `Editor.jsx` once per file (and we are NOT allowed to touch the
//     Editor) — it has no React context. A singleton lets `useRecent
//     Completions` warm the in-memory cache from localStorage and have
//     the static source see it synchronously on every keystroke.
//   - Reads happen on every keystroke; calling React selectors per
//     keystroke is wasteful.
//
// Persistence:
//   - One localStorage key per language: `lorica.completions.recent.<lang>`.
//   - Cap each language's map at LRU_LIMIT entries; on overflow we
//     evict the oldest timestamp.
//   - Writes are debounced (200 ms) so a burst of completion accepts
//     produces one localStorage write.
//   - All localStorage access is wrapped in try/catch — incognito
//     / private mode and storage-full both degrade silently to
//     "in-memory only this session".

const STORAGE_PREFIX = 'lorica.completions.recent.';
const LRU_LIMIT = 200;
const FLUSH_DELAY_MS = 200;

// language → Map<label, lastUsedTimestamp>
const memory = new Map();
const dirty = new Set(); // languages with pending writes
let flushTimer = null;

// Test seam — incognito-mode detection. We probe once and cache the
// result so we don't pay the try/catch cost on every read.
let storageAvailable = null;
function isStorageOK() {
  if (storageAvailable !== null) return storageAvailable;
  try {
    const k = '__lorica_recency_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  return storageAvailable;
}

/**
 * Load the recency map for one language from localStorage into the
 * in-memory cache. Idempotent: re-calling does nothing if already loaded.
 *
 * @param {string} language
 */
export function hydrateLanguage(language) {
  if (!language) return;
  if (memory.has(language)) return;
  if (!isStorageOK()) {
    memory.set(language, new Map());
    return;
  }
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + language);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const m = new Map();
        for (const [label, ts] of Object.entries(parsed)) {
          if (typeof ts === 'number' && Number.isFinite(ts)) {
            m.set(String(label), ts);
          }
        }
        memory.set(language, m);
        return;
      }
    }
  } catch {
    // Corrupt JSON or storage error — fall through to fresh map.
  }
  memory.set(language, new Map());
}

/**
 * Read-only view: returns the Map for a language, hydrating on first
 * access. Always returns a Map (possibly empty), never undefined, so
 * callers don't need null-checks.
 *
 * @param {string} language
 * @returns {Map<string, number>}
 */
export function getRecencyMap(language) {
  if (!language) return new Map();
  if (!memory.has(language)) hydrateLanguage(language);
  return memory.get(language) || new Map();
}

/**
 * Record that the user just accepted a completion. Updates the
 * in-memory map immediately, schedules a debounced flush to
 * localStorage. LRU-evicts the oldest entry if the map exceeds
 * LRU_LIMIT.
 *
 * @param {string} language
 * @param {string} label
 */
export function recordCompletion(language, label) {
  if (!language || !label) return;
  if (!memory.has(language)) hydrateLanguage(language);
  const m = memory.get(language);
  m.set(String(label), Date.now());

  // LRU eviction — only when we cross the limit. Cheap O(n) walk to
  // find the oldest, which is fine since LRU_LIMIT is 200.
  if (m.size > LRU_LIMIT) {
    let oldestKey = null;
    let oldestTs = Infinity;
    for (const [k, t] of m) {
      if (t < oldestTs) { oldestTs = t; oldestKey = k; }
    }
    if (oldestKey != null) m.delete(oldestKey);
  }

  dirty.add(language);
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_DELAY_MS);
}

function flushNow() {
  if (!isStorageOK()) { dirty.clear(); return; }
  for (const language of dirty) {
    const m = memory.get(language);
    if (!m) continue;
    try {
      const obj = Object.fromEntries(m);
      localStorage.setItem(STORAGE_PREFIX + language, JSON.stringify(obj));
    } catch {
      // QuotaExceeded or other — drop the write silently. Recency is
      // a quality-of-life feature, not a correctness one.
    }
  }
  dirty.clear();
}

/**
 * Compute a bounded boost for a label given the current recency map.
 * Newer accepts → larger boost, capped at +MAX_BOOST. Entries older
 * than MAX_AGE_MS get no boost (return 0).
 *
 * Caller adds this to the entry's existing `boost` (default 0). The
 * returned value lives in the same -99..99 range CodeMirror's `boost`
 * field expects, so we keep it modest.
 *
 * @param {Map<string, number>} map
 * @param {string} label
 * @param {number} now
 * @returns {number}
 */
const MAX_BOOST = 20;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export function recencyBoost(map, label, now = Date.now()) {
  if (!map || map.size === 0) return 0;
  const ts = map.get(label);
  if (!ts) return 0;
  const age = now - ts;
  if (age < 0) return MAX_BOOST;
  if (age >= MAX_AGE_MS) return 0;
  // Linear ramp: brand-new = MAX_BOOST, MAX_AGE = 0.
  return MAX_BOOST * (1 - age / MAX_AGE_MS);
}

/** Test seam — clear the in-memory cache. */
export function __resetRecency() {
  memory.clear();
  dirty.clear();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  storageAvailable = null;
}
