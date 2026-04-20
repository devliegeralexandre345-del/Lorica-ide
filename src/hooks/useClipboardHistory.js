// src/hooks/useClipboardHistory.js
//
// A lightweight clipboard history tracker. Hooks the global `copy` event
// on the document and keeps the last N items in memory (+ localStorage so
// they survive reloads). Doesn't try to poll the system clipboard — that
// requires permissions we don't want to ask for, and polling is wasteful.
// We only capture what the user copies from inside Lorica, which is
// already 95% of the useful cases.

import { useEffect } from 'react';

const STORAGE_KEY = 'lorica.clipboard.v1';
const MAX_ITEMS = 30;

export function useClipboardHistory(dispatch) {
  // Restore on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const items = JSON.parse(raw);
        if (Array.isArray(items)) {
          dispatch({ type: 'CLIPBOARD_SET', items: items.slice(0, MAX_ITEMS) });
        }
      }
    } catch {}
  }, [dispatch]);

  // Listen for copy events anywhere in the app. We avoid reading
  // clipboardData directly (different browsers vary) and instead read
  // whatever the user just put on the clipboard right after the event
  // fires. This is consistent across Chromium (Tauri).
  useEffect(() => {
    const onCopy = () => {
      // Defer one tick so the clipboard content has been set.
      setTimeout(async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (!text || text.length === 0) return;
          if (text.length > 10_000) return; // skip huge blobs
          dispatch({ type: 'CLIPBOARD_PUSH', text });
        } catch {
          // Permission denied / not supported — silent.
        }
      }, 0);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
    };
  }, [dispatch]);
}
