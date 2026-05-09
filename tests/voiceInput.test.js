// tests/voiceInput.test.js
//
// Coverage for the Web Speech API toggle + capability detection added
// in Wave 8. The dictation runtime itself can't run under node:test
// (no SpeechRecognition there), but the toggle / detection helpers are
// pure-function-shaped and worth pinning so a future refactor doesn't
// silently break the AgentCopilot mic gate.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  VOICE_TOGGLE_KEY,
  isVoiceFeatureEnabled,
  setVoiceFeatureEnabled,
  getSpeechRecognitionCtor,
  isVoiceSupported,
} from '../src/utils/voiceInput.js';

describe('voice toggle round-trip', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to disabled', () => {
    expect(isVoiceFeatureEnabled()).toBe(false);
  });

  it('persists "true" / "false" exactly under the documented key', () => {
    setVoiceFeatureEnabled(true);
    expect(localStorage.getItem(VOICE_TOGGLE_KEY)).toBe('true');
    expect(isVoiceFeatureEnabled()).toBe(true);
    setVoiceFeatureEnabled(false);
    expect(localStorage.getItem(VOICE_TOGGLE_KEY)).toBe('false');
    expect(isVoiceFeatureEnabled()).toBe(false);
  });

  it('treats truthy non-"true" strings as disabled (strict equality)', () => {
    // Future-proofing: if anyone writes "1" or "yes" by hand they should
    // NOT silently enable voice input. The toggle is binary on the
    // string literal "true".
    localStorage.setItem(VOICE_TOGGLE_KEY, '1');
    expect(isVoiceFeatureEnabled()).toBe(false);
    localStorage.setItem(VOICE_TOGGLE_KEY, 'yes');
    expect(isVoiceFeatureEnabled()).toBe(false);
  });
});

describe('SpeechRecognition capability detection', () => {
  // Save / restore window globals around each test so we don't leak
  // mocks to siblings.
  let savedStandard, savedWebkit;

  beforeEach(() => {
    savedStandard = globalThis.window?.SpeechRecognition;
    savedWebkit  = globalThis.window?.webkitSpeechRecognition;
    if (!globalThis.window) globalThis.window = {};
  });

  afterEach(() => {
    if (savedStandard === undefined) delete globalThis.window.SpeechRecognition;
    else globalThis.window.SpeechRecognition = savedStandard;
    if (savedWebkit === undefined) delete globalThis.window.webkitSpeechRecognition;
    else globalThis.window.webkitSpeechRecognition = savedWebkit;
  });

  it('returns null when neither standard nor prefixed API is exposed', () => {
    delete globalThis.window.SpeechRecognition;
    delete globalThis.window.webkitSpeechRecognition;
    expect(getSpeechRecognitionCtor()).toBeNull();
    expect(isVoiceSupported()).toBe(false);
  });

  it('prefers the standard non-prefixed API when both are present', () => {
    function StdCtor() {}
    function WebkitCtor() {}
    globalThis.window.SpeechRecognition = StdCtor;
    globalThis.window.webkitSpeechRecognition = WebkitCtor;
    expect(getSpeechRecognitionCtor()).toBe(StdCtor);
    expect(isVoiceSupported()).toBe(true);
  });

  it('falls back to webkitSpeechRecognition (Safari / Tauri-on-macOS)', () => {
    delete globalThis.window.SpeechRecognition;
    function WebkitCtor() {}
    globalThis.window.webkitSpeechRecognition = WebkitCtor;
    expect(getSpeechRecognitionCtor()).toBe(WebkitCtor);
    expect(isVoiceSupported()).toBe(true);
  });
});
