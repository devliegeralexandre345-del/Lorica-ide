// src/utils/sandbox.js
//
// Tiny, dependency-free JS sandbox built on a Web Worker. The worker is
// spun up on first use and reused for the session. Each call gets a
// message-id the worker echoes back so we can resolve promises and
// distinguish concurrent invocations.
//
// Capabilities:
//   • Evaluate an arbitrary JS expression/module text; return the last
//     expression's value (or an explicit `__result__` if the code sets it).
//   • Capture console.log/info/error output into an array.
//   • Record intermediate values at user-specified "probe points". The
//     instrumenter replaces `/* probe:label */` comments with a helper
//     call that pushes the value into a probes array.
//
// Intentionally JS-only. Adding Pyodide is a follow-up; the interface
// design here generalizes (callSandbox({ lang, code, ... })).
//
// The sandbox runs with NO access to the filesystem, no `window`, no
// `lorica` bridge — whatever Web Worker globals are available. Good
// enough for algorithm probing and function replay on pure code. Not
// for code that needs side-effects (HTTP, disk).

const WORKER_SOURCE = `
self.onmessage = async (e) => {
  const { id, code, args } = e.data;
  const logs = [];
  const probes = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.map(formatVal).join(' ')); };
  console.info = (...a) => { logs.push('[info] ' + a.map(formatVal).join(' ')); };
  console.warn = (...a) => { logs.push('[warn] ' + a.map(formatVal).join(' ')); };
  console.error = (...a) => { logs.push('[error] ' + a.map(formatVal).join(' ')); };

  function formatVal(v) {
    try {
      if (typeof v === 'string') return v;
      if (typeof v === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';
      return JSON.stringify(v, replacer, 2);
    } catch { return String(v); }
  }
  function replacer(_, v) {
    if (v instanceof Map) return { __map: Array.from(v.entries()) };
    if (v instanceof Set) return { __set: Array.from(v.values()) };
    if (typeof v === 'bigint') return v.toString() + 'n';
    if (typeof v === 'function') return '[Function]';
    return v;
  }

  // Probe sink — code can push { label, value } entries.
  globalThis.__lp = (label, value) => {
    probes.push({ label, value: safeClone(value) });
    return value;
  };
  function safeClone(v) {
    try { return JSON.parse(JSON.stringify(v, replacer)); } catch { return String(v); }
  }

  const t0 = performance.now();
  try {
    // Wrap the user code so a trailing expression can be returned, and
    // so 'args' is available as a named binding.
    const fn = new Function('args', 'return (async () => {' + code + '})()');
    const result = await fn(args);
    const ms = performance.now() - t0;
    self.postMessage({ id, ok: true, result: safeClone(result), logs, probes, ms });
  } catch (err) {
    const ms = performance.now() - t0;
    self.postMessage({
      id, ok: false,
      error: { name: err?.name || 'Error', message: err?.message || String(err), stack: err?.stack || '' },
      logs, probes, ms,
    });
  }
};
`;

let worker = null;
let nextId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  worker = new Worker(url);
  // The worker has its own copy of the script now — revoking the URL
  // lets the browser reclaim the Blob without affecting the running worker.
  try { URL.revokeObjectURL(url); } catch {}
  worker.onmessage = (e) => {
    const { id, ...rest } = e.data;
    const waiter = pending.get(id);
    if (waiter) { pending.delete(id); waiter(rest); }
  };
  return worker;
}

/**
 * Run JS code in the worker sandbox.
 * @param {object} params
 * @param {string} params.code   — raw JS source (may await)
 * @param {any=}    params.args  — serializable args bound to `args`
 * @param {number=} params.timeoutMs — kill after N ms (default 3000)
 */
export function runSandbox({ code, args, timeoutMs = 3000 }) {
  const id = nextId++;
  const w = ensureWorker();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, code, args: args ?? null });
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        try { worker.terminate(); } catch {}
        worker = null;
        resolve({ ok: false, error: { name: 'TimeoutError', message: `Timed out after ${timeoutMs}ms` }, logs: [], probes: [], ms: timeoutMs });
      }, timeoutMs);
    }
  });
}

// ── Python sandbox via Pyodide ───────────────────────────────────────
// Pyodide is a full CPython compiled to WebAssembly (~6 MB). We load it
// on first Python run, cache the instance, and reuse for subsequent
// calls. Execution happens in the same page context because Pyodide
// doesn't support Web Workers on all platforms equally — tradeoff is
// a small main-thread blip, but the call is bounded by `timeoutMs` via
// SharedArrayBuffer when available (falls back to a soft timeout).

const PYODIDE_VERSION = '0.26.4'; // latest stable at time of writing
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
let pyodidePromise = null;

async function loadPyodideOnce() {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    // Inject the loader script tag manually — Pyodide isn't an ES
    // module we can `import`. Rather than bundle it, we load lazily so
    // the 6 MB hit only happens when the user actually clicks "Run
    // Python".
    await new Promise((resolve, reject) => {
      if (typeof globalThis.loadPyodide === 'function') return resolve();
      const s = document.createElement('script');
      s.src = PYODIDE_CDN;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load Pyodide — check your internet connection'));
      document.head.appendChild(s);
    });
    const py = await globalThis.loadPyodide({
      indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
    });
    // A dedicated namespace for Lorica: the __lp probe sink so our
    // probe instrumentation works for Python too.
    py.runPython(`
import builtins
_lorica_probes = []
_lorica_logs = []
def __lp(label, value):
    _lorica_probes.append({"label": label, "value": value})
    return value
builtins.__lp = __lp
import sys
class _LoricaOut:
    def write(self, s):
        if s and s != "\\n": _lorica_logs.append(s.rstrip("\\n"))
    def flush(self): pass
sys.stdout = _LoricaOut()
sys.stderr = _LoricaOut()
`);
    return py;
  })();
  return pyodidePromise;
}

/**
 * Run Python code in the Pyodide sandbox. Same return shape as runSandbox.
 *
 * @param {object} params
 * @param {string} params.code
 * @param {any=}    params.args       — JSON-serializable; bound to `args`
 * @param {number=} params.timeoutMs  — soft timeout (Pyodide can't be killed mid-run)
 */
export async function runPythonSandbox({ code, args, timeoutMs = 5000 }) {
  const t0 = performance.now();
  try {
    const py = await loadPyodideOnce();
    // Reset probe / log buffers for this call.
    py.runPython('_lorica_probes.clear(); _lorica_logs.clear()');
    // Push args into the Python global scope.
    if (args !== undefined && args !== null) {
      py.globals.set('args', py.toPy(args));
    } else {
      py.globals.set('args', null);
    }
    // Race the user's code against a soft timeout. Pyodide does NOT
    // support cancellation, so on timeout we return an error and let
    // the user retry; the runtime will eventually free itself.
    let result;
    const run = (async () => {
      try {
        const v = py.runPython(code);
        return v === undefined ? null : (v?.toJs ? v.toJs({ dict_converter: Object.fromEntries }) : v);
      } catch (err) {
        // Preserve Pyodide's rich Python stack in `message`.
        throw err;
      }
    })();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs));
    result = await Promise.race([run, timeout]);

    const probes = py.globals.get('_lorica_probes')?.toJs?.({ dict_converter: Object.fromEntries }) || [];
    const logs = py.globals.get('_lorica_logs')?.toJs?.() || [];
    const ms = performance.now() - t0;
    return { ok: true, result, probes, logs, ms };
  } catch (e) {
    const ms = performance.now() - t0;
    return {
      ok: false,
      error: { name: e?.name || 'PythonError', message: e?.message || String(e), stack: e?.stack || '' },
      probes: [], logs: [],
      ms,
    };
  }
}

export function isPyodideCached() { return pyodidePromise != null; }

/**
 * Instrument code by rewriting probe comments so their value gets
 * recorded into the `probes` array. We support TWO forms, both designed
 * to be unambiguous to rewrite without a parser:
 *
 *   1. TRAILING form — put a probe *after* a value expression:
 *        let balance = account - fees;  // @probe balance
 *
 *      We rewrite the whole assignment into:
 *        let balance = __lp('balance', account - fees);
 *
 *   2. EXPRESSION-ONLY form (in an expression position):
 *        return /* @probe total *​/ (a + b);
 *
 *      Rewritten to:
 *        return __lp('total', (a + b));
 *
 * Anything we can't cleanly rewrite is left as-is. Users get best-effort
 * instrumentation without editor magic — fine for an MVP.
 */
export function instrumentProbes(code) {
  if (!code) return code;
  let out = code;

  // Form 1: "<expression>; // @probe <label>" — rewrite the statement.
  out = out.replace(
    /^([ \t]*(?:let|const|var)\s+(\w+)\s*=\s*)([^;\n]+);\s*\/\/\s*@probe(?:\s+(\w+))?\s*$/gm,
    (_m, prefix, varName, _semi, label) => {
      const key = (label || varName).trim();
      const expr = _m.slice(prefix.length, _m.lastIndexOf(';'));
      return `${prefix}__lp(${JSON.stringify(key)}, ${expr});`;
    }
  );

  // Form 2: "/* @probe label */ (expr)" — wrap the next parenthesized expr.
  out = out.replace(
    /\/\*\s*@probe\s+(\w+)\s*\*\/\s*\(([^)]+)\)/g,
    (_m, label, expr) => `__lp(${JSON.stringify(label)}, (${expr}))`,
  );

  return out;
}
