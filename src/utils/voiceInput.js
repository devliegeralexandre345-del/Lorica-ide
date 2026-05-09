// src/utils/voiceInput.js
//
// Thin wrapper around the Web Speech API for the agent input. Optional
// and opt-in (the AgentCopilot mic button only appears when
// `lorica.voice.enabled` is true in localStorage). The roadmap calls
// this out as Wave 8 / V2.3 medium-tier:
//
//   "Web Speech API is free in Tauri's webview on Windows/macOS.
//    Optional, opt-in, GDPR-clean if local-only (Web Speech is
//    on-device on macOS / via Edge speech on Windows). Linux needs
//    fallback."
//
// Browser surface:
//   • Safari / Tauri-on-macOS exposes `webkitSpeechRecognition`. macOS
//     dictation is on-device after the first download.
//   • Chrome / Edge expose both `SpeechRecognition` and the prefixed
//     variant. Edge on Windows uses the OS speech engine, also local.
//   • Linux WebView2/Webkit2GTK does not expose the API. The factory
//     returns `null` there; the caller hides the mic button.
//
// We deliberately keep the API surface dead simple: `start(onResult)`
// returns a stop function. No streaming, no interim partial events to
// the caller — the agent input is short-form and the user wants a
// single transcribed string.

export const VOICE_TOGGLE_KEY = 'lorica.voice.enabled';

export function isVoiceFeatureEnabled() {
  try { return localStorage.getItem(VOICE_TOGGLE_KEY) === 'true'; }
  catch { return false; }
}

export function setVoiceFeatureEnabled(enabled) {
  try { localStorage.setItem(VOICE_TOGGLE_KEY, enabled ? 'true' : 'false'); } catch {}
}

// Returns the Web Speech API constructor for this browser, or null when
// none is available. Caller should check the return before showing UI
// that depends on speech recognition.
export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  // Standard non-prefixed name (rare today) wins, otherwise vendor prefix.
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isVoiceSupported() {
  return getSpeechRecognitionCtor() != null;
}

/**
 * Start a one-shot dictation session. Calls `onTranscript(text, {final})`
 * with each partial / final result. Returns a function that stops the
 * session early (call it on unmount or when the user clicks the mic
 * button again).
 *
 * `onError(err)` is called with the raw error string from the SpeechRecognition
 * event. Common values: `not-allowed` (mic perm denied), `no-speech`,
 * `aborted` (we stopped it), `network`. The caller maps these to user-
 * friendly toasts.
 *
 * The session ends naturally when the user pauses for a few seconds —
 * that's the API's default `continuous: false` behaviour. We don't fight
 * it because dictating long-form into the agent input is rare.
 *
 * @returns {() => void} stop fn (idempotent — safe to call after end)
 */
export function startDictation({
  onTranscript,
  onError,
  onEnd,
  language = 'en-US',
  interim = true,
} = {}) {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    if (onError) onError('not-supported');
    return () => {};
  }

  const recog = new Ctor();
  recog.continuous = false;        // single utterance
  recog.interimResults = !!interim;
  recog.maxAlternatives = 1;
  recog.lang = language;

  let stopped = false;

  recog.onresult = (event) => {
    let text = '';
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      text += r[0].transcript;
      if (r.isFinal) isFinal = true;
    }
    if (typeof onTranscript === 'function') {
      onTranscript(text, { final: isFinal });
    }
  };
  recog.onerror = (event) => {
    if (typeof onError === 'function') onError(event.error || 'unknown');
  };
  recog.onend = () => {
    if (typeof onEnd === 'function') onEnd();
  };

  try {
    recog.start();
  } catch (e) {
    // Some browsers throw if start() is called while another session is
    // active — treat as a no-op rather than crashing the caller.
    if (typeof onError === 'function') onError(String(e?.message || e));
  }

  return () => {
    if (stopped) return;
    stopped = true;
    try { recog.abort(); } catch {}
  };
}
