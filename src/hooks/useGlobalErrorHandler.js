// src/hooks/useGlobalErrorHandler.js
//
// Catches truly global errors that React's ErrorBoundaries can't see:
//   • Unhandled promise rejections (async bugs in event handlers,
//     fire-and-forget LLM calls that lose their .catch, etc.)
//   • Uncaught runtime errors on the window
//
// We log them to the console (so devs see the real stack in DevTools)
// AND surface a toast so the user knows something went sideways, but
// we deliberately DON'T try to recover the app — that's what the
// ErrorBoundaries are for. This is purely a loud-fail trace so nothing
// dies silently.

import { useEffect } from 'react';

export function useGlobalErrorHandler(dispatch) {
  useEffect(() => {
    const onRejection = (e) => {
      // Known-benign aborts — we throw AbortError from agent calls all
      // the time when the user cancels. Don't toast those.
      const msg = e?.reason?.message || String(e?.reason || '');
      if (e?.reason?.name === 'AbortError') return;
      if (/resource id \d+ is invalid/i.test(msg)) return;
      // eslint-disable-next-line no-console
      console.error('[Lorica] Unhandled promise rejection:', e.reason);
      dispatch({
        type: 'ADD_TOAST',
        toast: {
          type: 'error',
          message: `Background error: ${String(msg).slice(0, 120)}`,
          duration: 5000,
        },
      });
    };

    const onError = (e) => {
      // ErrorBoundary already handles React render errors; this fires
      // for things ErrorBoundary can't — image load failures, etc.
      if (e?.filename?.includes('.png') || e?.filename?.includes('.jpg')) return;
      // eslint-disable-next-line no-console
      console.error('[Lorica] Uncaught error:', e.error || e.message);
    };

    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, [dispatch]);
}
