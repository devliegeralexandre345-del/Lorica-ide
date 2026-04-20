// src/components/ApiTester.jsx
//
// Postman-lite — a small HTTP request sender built on the Tauri HTTP
// plugin we already ship for the agent. It's a single-pane form
// (method / url / headers / body / response) that covers 95% of day-to-
// day API poking without anyone needing to leave the IDE or install a
// separate tool.
//
// Persistence: request history is kept in localStorage under a single
// capped list. Per-project "collections" are deliberately NOT here —
// when we add them, they go in `.lorica/api/` as JSON files so they
// commit with the project.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  Send, Clock, X, Trash2, Copy, CheckCircle, XCircle, FolderOpen, Save, Plus,
  Settings as SettingsIcon, ListChecks, FileJson,
} from 'lucide-react';

const HISTORY_KEY = 'lorica.apiTester.history.v1';
const ENVS_KEY    = 'lorica.apiTester.envs.v1';
const HISTORY_MAX = 40;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ── Environment variables ─────────────────────────────────────────────
// An env is a flat map of name → value. We store a list of named envs
// (e.g. "dev", "staging", "prod") with an activeName. Variables are
// referenced in URL/headers/body as {{name}} and resolved before send.
function loadEnvs() {
  try {
    const raw = localStorage.getItem(ENVS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { activeName: 'default', envs: [{ name: 'default', vars: {} }] };
}
function saveEnvs(data) {
  try { localStorage.setItem(ENVS_KEY, JSON.stringify(data)); } catch {}
}
function resolveVars(str, vars) {
  if (!str || !vars) return str;
  return str.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, n) =>
    Object.prototype.hasOwnProperty.call(vars, n) ? String(vars[n]) : `{{${n}}}`
  );
}

// ── Collections (per-project) ──────────────────────────────────────────
// Stored in `.lorica/api/<slug>.json`. Each collection is an array of
// saved requests: { name, method, url, headers, body, assertions }.
function collectionsDir(projectPath) {
  if (!projectPath) return null;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath}${sep}.lorica${sep}api`;
}

async function listCollections(projectPath) {
  const dir = collectionsDir(projectPath);
  if (!dir) return [];
  const r = await window.lorica.fs.readDir(dir).catch(() => null);
  if (!r?.success) return [];
  const files = (Array.isArray(r.data) ? r.data : []).filter((e) => !e.isDirectory && e.name.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const fr = await window.lorica.fs.readFile(f.path);
      if (!fr?.success) continue;
      const parsed = JSON.parse(fr.data.content);
      out.push({ path: f.path, name: parsed.name || f.name.replace(/\.json$/, ''), requests: parsed.requests || [] });
    } catch {}
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function saveCollection(projectPath, collection) {
  const dir = collectionsDir(projectPath);
  if (!dir) throw new Error('No project open');
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const slug = collection.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const path = `${dir}${sep}${slug}.json`;
  try { await window.lorica.fs.createDir(dir); } catch {}
  await window.lorica.fs.writeFile(path, JSON.stringify({ name: collection.name, requests: collection.requests }, null, 2));
  return { ...collection, path };
}

// ── Assertions — run after a response arrives. Simple DSL ────────────
// Each assertion: { type: 'status' | 'body' | 'header' | 'time',
//                    op: 'eq'|'neq'|'contains'|'lt'|'gt'|'exists',
//                    target?: string, value?: any }
// For body, `target` is a JSON path like "user.id" or "[0].name".
function getPath(obj, path) {
  if (!path) return obj;
  const parts = [];
  let buf = '';
  for (const ch of path) {
    if (ch === '.') { if (buf) parts.push(buf); buf = ''; }
    else if (ch === '[') { if (buf) parts.push(buf); buf = ''; }
    else if (ch === ']') { if (buf) parts.push(/^\d+$/.test(buf) ? +buf : buf); buf = ''; }
    else buf += ch;
  }
  if (buf) parts.push(buf);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function runAssertion(a, resp) {
  let actual;
  if (a.type === 'status') actual = resp.status;
  else if (a.type === 'time') actual = resp.ms;
  else if (a.type === 'header') actual = resp.respHeaders?.[(a.target || '').toLowerCase()];
  else if (a.type === 'body') {
    let parsed; try { parsed = JSON.parse(resp.respBody || 'null'); } catch {}
    actual = getPath(parsed, a.target);
  }
  const v = a.value;
  const check = {
    eq:       () => String(actual) === String(v),
    neq:      () => String(actual) !== String(v),
    contains: () => String(actual ?? '').includes(String(v)),
    lt:       () => Number(actual) < Number(v),
    gt:       () => Number(actual) > Number(v),
    exists:   () => actual !== undefined && actual !== null,
  }[a.op];
  const ok = !!check?.();
  return { ok, actual };
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_MAX))); } catch {}
}

function parseHeaders(text) {
  const out = {};
  for (const line of (text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
function formatHeaders(obj) {
  return Object.entries(obj || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function statusColor(s) {
  if (!s) return 'text-lorica-textDim';
  if (s < 300) return 'text-emerald-400';
  if (s < 400) return 'text-sky-400';
  if (s < 500) return 'text-amber-400';
  return 'text-red-400';
}

export default function ApiTester({ state, dispatch }) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl]       = useState('https://api.github.com/repos/anthropics/anthropic-sdk-typescript');
  const [headers, setHeaders] = useState('Accept: application/json');
  const [body, setBody]     = useState('');
  const [assertions, setAssertions] = useState([]); // [{type, op, target, value}]
  const [assertionResults, setAssertionResults] = useState(null);
  const [resp, setResp]     = useState(null);     // { status, headers, body, ms }
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(() => loadHistory());
  const [rightTab, setRightTab] = useState('response'); // 'response' | 'history' | 'collections' | 'envs'
  const [envState, setEnvState] = useState(() => loadEnvs());
  const [collections, setCollections] = useState([]);
  const [currentRequestName, setCurrentRequestName] = useState('');
  const [targetCollection, setTargetCollection] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const abortRef = useRef(null);
  const bodyNeeded = method !== 'GET' && method !== 'HEAD';
  const projectPath = state?.projectPath;

  // Load collections per-project.
  useEffect(() => {
    (async () => {
      const c = await listCollections(projectPath);
      setCollections(c);
    })();
  }, [projectPath]);

  const activeEnv = envState.envs.find((e) => e.name === envState.activeName) || envState.envs[0];
  const activeVars = activeEnv?.vars || {};

  const persistEnvs = (next) => { setEnvState(next); saveEnvs(next); };
  const addEnv = (name) => {
    if (!name || envState.envs.some((e) => e.name === name)) return;
    persistEnvs({ ...envState, envs: [...envState.envs, { name, vars: {} }], activeName: name });
  };
  const deleteEnv = (name) => {
    const rest = envState.envs.filter((e) => e.name !== name);
    if (rest.length === 0) return;
    persistEnvs({ activeName: rest[0].name, envs: rest });
  };
  const setVar = (envName, k, v) => {
    const envs = envState.envs.map((e) => e.name === envName ? { ...e, vars: { ...e.vars, [k]: v } } : e);
    persistEnvs({ ...envState, envs });
  };
  const deleteVar = (envName, k) => {
    const envs = envState.envs.map((e) => {
      if (e.name !== envName) return e;
      const vars = { ...e.vars };
      delete vars[k];
      return { ...e, vars };
    });
    persistEnvs({ ...envState, envs });
  };

  const close = () => dispatch({ type: 'SET_PANEL', panel: 'showApiTester', value: false });

  const send = async () => {
    if (!url.trim()) return;
    setSending(true);
    setAssertionResults(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = performance.now();
    try {
      // Resolve {{env_vars}} in all the request fields before actual send.
      const rUrl = resolveVars(url.trim(), activeVars);
      const rHeaders = Object.fromEntries(
        Object.entries(parseHeaders(headers)).map(([k, v]) => [k, resolveVars(v, activeVars)])
      );
      const rBody = bodyNeeded && body ? resolveVars(body, activeVars) : undefined;
      const r = await tauriFetch(rUrl, { method, headers: rHeaders, body: rBody, signal: ctrl.signal });
      const respHeaders = {};
      r.headers.forEach?.((v, k) => { respHeaders[k.toLowerCase()] = v; });
      const text = await r.text();
      const ms = Math.round(performance.now() - t0);
      const record = {
        id: `${Date.now()}-${Math.random()}`,
        at: Date.now(), method, url: rUrl, ms,
        reqHeaders: rHeaders, reqBody: bodyNeeded ? rBody : '',
        status: r.status, statusText: r.statusText,
        respHeaders, respBody: text,
      };
      setResp(record);
      setRightTab('response');
      const next = [record, ...history].slice(0, HISTORY_MAX);
      setHistory(next);
      saveHistory(next);
      // Evaluate assertions if any.
      if (assertions.length > 0) {
        const results = assertions.map((a) => ({ ...a, ...runAssertion(a, record) }));
        setAssertionResults(results);
      }
    } catch (e) {
      setResp({ error: e.message, ms: Math.round(performance.now() - t0) });
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  // Save the current request to a collection. If `newCollectionName` is
  // non-empty, create it; otherwise append to an existing one.
  const saveToCollection = async () => {
    if (!projectPath) {
      dispatch({ type: 'ADD_TOAST', toast: { type: 'warning', message: 'Open a project first', duration: 2500 } });
      return;
    }
    const name = (currentRequestName || '').trim() || 'Unnamed request';
    const requestObj = { name, method, url, headers, body, assertions };
    if (newCollectionName.trim()) {
      const saved = await saveCollection(projectPath, { name: newCollectionName.trim(), requests: [requestObj] });
      setCollections((cur) => [...cur, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setTargetCollection(saved.path);
      setNewCollectionName('');
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Collection "${saved.name}" created`, duration: 2000 } });
    } else if (targetCollection) {
      const col = collections.find((c) => c.path === targetCollection);
      if (!col) return;
      const updated = { ...col, requests: [...col.requests, requestObj] };
      const saved = await saveCollection(projectPath, updated);
      setCollections((cur) => cur.map((c) => c.path === saved.path ? saved : c));
      dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: `Saved to "${saved.name}"`, duration: 2000 } });
    }
    setCurrentRequestName('');
  };

  const loadRequest = (r) => {
    setMethod(r.method || 'GET');
    setUrl(r.url || '');
    setHeaders(r.headers || '');
    setBody(r.body || '');
    setAssertions(Array.isArray(r.assertions) ? r.assertions : []);
  };

  const deleteRequest = async (collection, idx) => {
    const updated = { ...collection, requests: collection.requests.filter((_, i) => i !== idx) };
    const saved = await saveCollection(projectPath, updated);
    setCollections((cur) => cur.map((c) => c.path === saved.path ? saved : c));
  };

  const cancel = () => abortRef.current?.abort();

  const replay = (rec) => {
    setMethod(rec.method);
    setUrl(rec.url);
    setHeaders(formatHeaders(rec.reqHeaders));
    setBody(rec.reqBody || '');
    setShowHistory(false);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const prettyBody = useMemo(() => {
    if (!resp?.respBody) return '';
    try { return JSON.stringify(JSON.parse(resp.respBody), null, 2); }
    catch { return resp.respBody; }
  }, [resp]);

  const copyResponse = () => {
    if (!resp?.respBody) return;
    navigator.clipboard.writeText(prettyBody).catch(() => {});
    dispatch({ type: 'ADD_TOAST', toast: { type: 'success', message: 'Response body copied', duration: 1500 } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={close}>
      <div
        className="w-full max-w-5xl h-full max-h-[85vh] lorica-glass rounded-2xl shadow-[0_0_50px_rgba(0,212,255,0.2)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-lorica-border shrink-0">
          <Send size={14} className="text-lorica-accent" />
          <div className="text-sm font-semibold text-lorica-text">API Tester</div>
          <div className="text-[10px] text-lorica-textDim">Native HTTP client (via Tauri)</div>
          <div className="flex-1" />
          {/* Active environment picker */}
          <select
            value={envState.activeName}
            onChange={(e) => persistEnvs({ ...envState, activeName: e.target.value })}
            className="bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[10px] text-lorica-accent outline-none"
            title="Active environment"
          >
            {envState.envs.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
          </select>
          <button onClick={close} className="p-1.5 rounded text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/40">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: request */}
          <div className="flex-1 border-r border-lorica-border flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-lorica-border shrink-0">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] text-lorica-accent outline-none"
              >
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/…"
                className="flex-1 bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] text-lorica-text outline-none focus:border-lorica-accent/50 font-mono"
              />
              {sending ? (
                <button onClick={cancel} className="px-3 py-1 rounded bg-red-500/20 border border-red-500/40 text-red-400 text-[11px] font-semibold">
                  Cancel
                </button>
              ) : (
                <button onClick={send} className="px-3 py-1 rounded bg-lorica-accent/20 border border-lorica-accent/50 text-lorica-accent text-[11px] font-semibold hover:bg-lorica-accent/30 transition-colors">
                  Send
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              <Section label="Headers">
                <textarea
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  rows={4}
                  placeholder="Header: value (one per line)"
                  className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-[11px] font-mono text-lorica-text outline-none focus:border-lorica-accent/50 resize-none"
                />
              </Section>
              {bodyNeeded && (
                <Section label="Body">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                    placeholder='{"key":"value"}'
                    className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1.5 text-[11px] font-mono text-lorica-text outline-none focus:border-lorica-accent/50 resize-none"
                  />
                </Section>
              )}
            </div>
          </div>

          {/* Right: tabbed view — Response / Assertions / History / Collections / Environments */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex border-b border-lorica-border shrink-0">
              {[
                { id: 'response',    label: 'Response',      Icon: FileJson },
                { id: 'assertions',  label: `Asserts${assertions.length ? ` (${assertions.length})` : ''}`, Icon: ListChecks },
                { id: 'history',     label: `History (${history.length})`, Icon: Clock },
                { id: 'collections', label: 'Collections',   Icon: FolderOpen },
                { id: 'envs',        label: 'Envs',          Icon: SettingsIcon },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setRightTab(t.id)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] transition-colors ${
                    rightTab === t.id ? 'text-lorica-accent border-b border-lorica-accent bg-lorica-accent/5'
                                      : 'text-lorica-textDim hover:text-lorica-text hover:bg-lorica-border/30'
                  }`}
                >
                  <t.Icon size={10} /> {t.label}
                </button>
              ))}
            </div>

            {rightTab === 'response' && (
              <>
                <div className="flex items-center gap-3 px-3 py-2 border-b border-lorica-border shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Response</span>
                  {resp && !resp.error && (
                    <>
                      <span className={`text-[11px] font-semibold ${statusColor(resp.status)}`}>
                        {resp.status < 400 ? <CheckCircle size={11} className="inline mr-1" /> : <XCircle size={11} className="inline mr-1" />}
                        {resp.status} {resp.statusText}
                      </span>
                      <span className="text-[10px] text-lorica-textDim">{resp.ms}ms · {resp.respBody?.length || 0} bytes</span>
                      <button onClick={copyResponse} className="ml-auto text-[10px] text-lorica-textDim hover:text-lorica-accent flex items-center gap-1">
                        <Copy size={10} /> Copy
                      </button>
                    </>
                  )}
                  {resp?.error && <span className="text-[11px] font-semibold text-red-400">Error · {resp.ms}ms</span>}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {!resp && <div className="p-6 text-[11px] text-lorica-textDim text-center">Send a request to see the response.</div>}
                  {resp?.error && <div className="p-3 text-[11px] text-red-400 font-mono whitespace-pre-wrap">{resp.error}</div>}
                  {resp && !resp.error && (
                    <>
                      {assertionResults && (
                        <div className="border-b border-lorica-border">
                          {assertionResults.map((a, i) => (
                            <div key={i} className={`flex items-start gap-2 px-3 py-1.5 text-[11px] ${a.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                              {a.ok ? <CheckCircle size={11} className="mt-0.5 shrink-0" /> : <XCircle size={11} className="mt-0.5 shrink-0" />}
                              <span className="font-mono text-[10px]">
                                {a.type}{a.target ? `.${a.target}` : ''} {a.op} {JSON.stringify(a.value)}
                              </span>
                              <span className="text-lorica-textDim text-[10px] ml-auto">actual: {JSON.stringify(a.actual)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {Object.keys(resp.respHeaders || {}).length > 0 && (
                        <details className="px-3 pt-2 text-[10px] text-lorica-textDim">
                          <summary className="cursor-pointer select-none">Response headers ({Object.keys(resp.respHeaders).length})</summary>
                          <pre className="mt-1 font-mono whitespace-pre-wrap text-lorica-text/80">{formatHeaders(resp.respHeaders)}</pre>
                        </details>
                      )}
                      <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap break-words text-lorica-text">{prettyBody}</pre>
                    </>
                  )}
                </div>
              </>
            )}

            {rightTab === 'assertions' && (
              <AssertionsPane assertions={assertions} setAssertions={setAssertions} />
            )}

            {rightTab === 'history' && (
              <div className="flex-1 overflow-y-auto">
                <div className="flex items-center px-3 py-2 border-b border-lorica-border shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Recent requests</span>
                  {history.length > 0 && (
                    <button onClick={clearHistory} className="ml-auto flex items-center gap-1 text-[10px] text-lorica-textDim hover:text-red-400">
                      <Trash2 size={10} /> Clear
                    </button>
                  )}
                </div>
                {history.length === 0 && <div className="p-4 text-[11px] text-lorica-textDim text-center">No requests yet.</div>}
                {history.map((rec) => (
                  <button key={rec.id} onClick={() => replay(rec)} className="w-full text-left px-3 py-1.5 border-b border-lorica-border/40 hover:bg-lorica-accent/10 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-lorica-accent w-12">{rec.method}</span>
                      <span className={`${statusColor(rec.status)} text-[10px] font-mono w-8`}>{rec.status || 'ERR'}</span>
                      <span className="text-lorica-text truncate flex-1">{rec.url}</span>
                      <span className="text-[9px] text-lorica-textDim">{rec.ms}ms</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {rightTab === 'collections' && (
              <CollectionsPane
                projectPath={projectPath}
                collections={collections}
                currentRequestName={currentRequestName}
                setCurrentRequestName={setCurrentRequestName}
                targetCollection={targetCollection}
                setTargetCollection={setTargetCollection}
                newCollectionName={newCollectionName}
                setNewCollectionName={setNewCollectionName}
                onSave={saveToCollection}
                onLoad={loadRequest}
                onDelete={deleteRequest}
              />
            )}

            {rightTab === 'envs' && (
              <EnvsPane envState={envState} addEnv={addEnv} deleteEnv={deleteEnv} setVar={setVar} deleteVar={deleteVar} setActive={(n) => persistEnvs({ ...envState, activeName: n })} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="px-3 py-2 space-y-1">
      <div className="text-[9px] uppercase tracking-widest text-lorica-textDim">{label}</div>
      {children}
    </div>
  );
}

function AssertionsPane({ assertions, setAssertions }) {
  const addAssertion = () => {
    setAssertions([...assertions, { type: 'status', op: 'eq', value: 200 }]);
  };
  const update = (i, patch) => {
    setAssertions(assertions.map((a, j) => (i === j ? { ...a, ...patch } : a)));
  };
  const remove = (i) => setAssertions(assertions.filter((_, j) => j !== i));

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="flex items-center">
        <span className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Response assertions</span>
        <button onClick={addAssertion} className="ml-auto flex items-center gap-1 text-[10px] text-lorica-accent hover:bg-lorica-accent/10 px-1.5 py-0.5 rounded">
          <Plus size={10} /> Add
        </button>
      </div>
      {assertions.length === 0 && (
        <div className="text-[11px] text-lorica-textDim italic">No assertions yet. Add one to check the response after each send.</div>
      )}
      {assertions.map((a, i) => (
        <div key={i} className="bg-lorica-bg border border-lorica-border rounded p-2 space-y-1">
          <div className="flex items-center gap-1">
            <select value={a.type} onChange={(e) => update(i, { type: e.target.value })}
              className="bg-lorica-bg border border-lorica-border rounded px-1 py-0.5 text-[10px] outline-none">
              <option value="status">status</option>
              <option value="body">body (JSON path)</option>
              <option value="header">header</option>
              <option value="time">time (ms)</option>
            </select>
            {(a.type === 'body' || a.type === 'header') && (
              <input value={a.target || ''} onChange={(e) => update(i, { target: e.target.value })}
                placeholder={a.type === 'body' ? 'user.id' : 'content-type'}
                className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[10px] outline-none font-mono" />
            )}
            <select value={a.op} onChange={(e) => update(i, { op: e.target.value })}
              className="bg-lorica-bg border border-lorica-border rounded px-1 py-0.5 text-[10px] outline-none">
              <option value="eq">=</option>
              <option value="neq">≠</option>
              <option value="contains">contains</option>
              <option value="lt">&lt;</option>
              <option value="gt">&gt;</option>
              <option value="exists">exists</option>
            </select>
            {a.op !== 'exists' && (
              <input value={a.value ?? ''} onChange={(e) => update(i, { value: e.target.value })}
                className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[10px] outline-none font-mono" />
            )}
            <button onClick={() => remove(i)} className="text-lorica-textDim hover:text-red-400">
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      ))}
      <div className="text-[9px] text-lorica-textDim pt-1">
        Assertions run automatically after each send. Body JSON paths use dot / [i] (e.g. <code>items[0].id</code>).
      </div>
    </div>
  );
}

function CollectionsPane({ projectPath, collections, currentRequestName, setCurrentRequestName, targetCollection, setTargetCollection, newCollectionName, setNewCollectionName, onSave, onLoad, onDelete }) {
  if (!projectPath) {
    return <div className="flex-1 p-4 text-[11px] text-lorica-textDim text-center">Open a project to use collections.</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-3 border-b border-lorica-border space-y-2 bg-lorica-panel/40">
        <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Save current request</div>
        <input
          value={currentRequestName}
          onChange={(e) => setCurrentRequestName(e.target.value)}
          placeholder="Request name"
          className="w-full bg-lorica-bg border border-lorica-border rounded px-2 py-1 text-[11px] outline-none"
        />
        <div className="flex gap-1">
          <select value={targetCollection} onChange={(e) => { setTargetCollection(e.target.value); setNewCollectionName(''); }}
            className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1.5 py-1 text-[11px] outline-none">
            <option value="">— pick collection —</option>
            {collections.map((c) => <option key={c.path} value={c.path}>{c.name}</option>)}
          </select>
          <span className="text-[10px] text-lorica-textDim self-center">or</span>
          <input value={newCollectionName} onChange={(e) => { setNewCollectionName(e.target.value); setTargetCollection(''); }}
            placeholder="new collection…"
            className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1.5 py-1 text-[11px] outline-none" />
        </div>
        <button onClick={onSave} disabled={!currentRequestName.trim() || (!targetCollection && !newCollectionName.trim())}
          className="flex items-center gap-1 px-2 py-1 rounded bg-lorica-accent/20 border border-lorica-accent/40 text-lorica-accent text-[11px] hover:bg-lorica-accent/30 disabled:opacity-40">
          <Save size={10} /> Save
        </button>
      </div>

      {collections.length === 0 && <div className="p-4 text-[11px] text-lorica-textDim">No collections yet.</div>}
      {collections.map((c) => (
        <details key={c.path} className="border-b border-lorica-border/40">
          <summary className="px-3 py-2 text-[11px] font-semibold text-lorica-text cursor-pointer hover:bg-lorica-accent/5 flex items-center gap-2">
            <FolderOpen size={11} className="text-lorica-accent" />
            {c.name}
            <span className="ml-auto text-[10px] text-lorica-textDim">{c.requests.length} request{c.requests.length === 1 ? '' : 's'}</span>
          </summary>
          {c.requests.map((r, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-1.5 border-t border-lorica-border/30 hover:bg-lorica-accent/5">
              <span className="font-mono text-[10px] text-lorica-accent w-10">{r.method}</span>
              <button onClick={() => onLoad(r)} className="flex-1 text-left text-[11px] text-lorica-text truncate">{r.name}</button>
              <button onClick={() => onDelete(c, i)} className="text-lorica-textDim hover:text-red-400">
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}

function EnvsPane({ envState, addEnv, deleteEnv, setVar, deleteVar, setActive }) {
  const [newEnv, setNewEnv] = useState('');
  const [editEnv, setEditEnv] = useState(envState.activeName);
  const env = envState.envs.find((e) => e.name === editEnv) || envState.envs[0];
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  useEffect(() => { setEditEnv(envState.activeName); }, [envState.activeName]);

  const addVar = () => {
    if (!newKey.trim()) return;
    setVar(env.name, newKey.trim(), newVal);
    setNewKey(''); setNewVal('');
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-3 border-b border-lorica-border space-y-2 bg-lorica-panel/40">
        <div className="text-[10px] uppercase tracking-widest text-lorica-textDim font-semibold">Environments</div>
        <div className="flex gap-1 flex-wrap">
          {envState.envs.map((e) => (
            <div key={e.name} className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
              envState.activeName === e.name ? 'bg-lorica-accent/20 border-lorica-accent text-lorica-accent' : 'border-lorica-border text-lorica-textDim'
            }`}>
              <button onClick={() => setActive(e.name)}>{e.name}</button>
              {envState.envs.length > 1 && (
                <button onClick={() => deleteEnv(e.name)} className="text-lorica-textDim hover:text-red-400"><X size={8} /></button>
              )}
            </div>
          ))}
          <input value={newEnv} onChange={(e) => setNewEnv(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (addEnv(newEnv), setNewEnv(''))}
            placeholder="+ new env"
            className="bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[10px] outline-none w-24" />
        </div>
        <div className="text-[10px] text-lorica-textDim">Editing: <b className="text-lorica-text">{env.name}</b></div>
      </div>

      <div className="p-3 space-y-1">
        {Object.entries(env.vars || {}).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1">
            <code className="w-28 text-[11px] text-amber-300 truncate">{k}</code>
            <input value={v} onChange={(e) => setVar(env.name, k, e.target.value)}
              className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[11px] outline-none font-mono" />
            <button onClick={() => deleteVar(env.name, k)} className="text-lorica-textDim hover:text-red-400"><Trash2 size={10} /></button>
          </div>
        ))}
        <div className="flex items-center gap-1 pt-2 border-t border-lorica-border/30">
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="var_name"
            className="w-28 bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[11px] outline-none" />
          <input value={newVal} onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addVar()}
            placeholder="value"
            className="flex-1 bg-lorica-bg border border-lorica-border rounded px-1.5 py-0.5 text-[11px] outline-none font-mono" />
          <button onClick={addVar} disabled={!newKey.trim()} className="text-[11px] text-lorica-accent px-1.5 py-0.5 rounded hover:bg-lorica-accent/10 disabled:opacity-30">
            <Plus size={10} />
          </button>
        </div>
        <div className="text-[10px] text-lorica-textDim pt-2">
          Reference in URL/headers/body as <code>{'{{var_name}}'}</code>.
        </div>
      </div>
    </div>
  );
}
