// tests/setup.js
//
// Global setup: provide a fresh in-memory localStorage for every test
// file. aiCoauthor.js and a handful of other utils touch localStorage at
// module-evaluation time or in their pure-looking helpers, and Node has
// no built-in shim. Keeping this minimal — anything more elaborate (DOM,
// fetch) we add later, only when a test actually needs it.

class MemoryStorage {
  constructor() { this.store = new Map(); }
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
  setItem(k, v) { this.store.set(String(k), String(v)); }
  removeItem(k) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new MemoryStorage();
}
