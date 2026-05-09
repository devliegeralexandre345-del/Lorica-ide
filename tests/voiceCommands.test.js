// tests/voiceCommands.test.js
//
// Coverage for the Wave 25 voice command parser. The intent catalog
// is deliberately small + bilingual (English + French); we pin a few
// representative phrases per intent so a future tweak to the keyword
// lists doesn't accidentally drop the common ones.

import { describe, it, expect } from 'vitest';
import { parseVoiceCommand, listIntents } from '../src/utils/voiceCommands.js';

describe('parseVoiceCommand', () => {
  it('returns null on empty / whitespace-only input', () => {
    expect(parseVoiceCommand('')).toBeNull();
    expect(parseVoiceCommand('   ')).toBeNull();
  });

  it('returns null when nothing matches an intent', () => {
    expect(parseVoiceCommand('lorem ipsum dolor sit amet')).toBeNull();
  });

  it('matches "open settings" → open.settings', () => {
    const r = parseVoiceCommand('open settings');
    expect(r?.intent.id).toBe('open.settings');
  });

  it('matches the French equivalent "ouvre les paramètres"', () => {
    const r = parseVoiceCommand('ouvre les paramètres');
    expect(r?.intent.id).toBe('open.settings');
  });

  it('matches "save the file" → save.file', () => {
    const r = parseVoiceCommand('save the file');
    expect(r?.intent.id).toBe('save.file');
  });

  it('matches "sauvegarde ce fichier" → save.file', () => {
    const r = parseVoiceCommand('sauvegarde ce fichier');
    expect(r?.intent.id).toBe('save.file');
  });

  it('matches "open the terminal" → open.terminal', () => {
    const r = parseVoiceCommand('open the terminal');
    expect(r?.intent.id).toBe('open.terminal');
  });

  it('matches "ouvre le terminal" → open.terminal', () => {
    const r = parseVoiceCommand('ouvre le terminal');
    expect(r?.intent.id).toBe('open.terminal');
  });

  it('matches "show the source control" → open.git', () => {
    const r = parseVoiceCommand('show the source control');
    expect(r?.intent.id).toBe('open.git');
  });

  it('matches "open the AI copilot" → open.copilot', () => {
    const r = parseVoiceCommand('open the AI copilot');
    expect(r?.intent.id).toBe('open.copilot');
  });

  it('matches "ouvre les annotations" → open.annotations', () => {
    const r = parseVoiceCommand('ouvre les annotations');
    expect(r?.intent.id).toBe('open.annotations');
  });

  it('matches "start live share" → open.collab', () => {
    const r = parseVoiceCommand('start live share');
    expect(r?.intent.id).toBe('open.collab');
  });

  it('matches "toggle zen mode" → toggle.zen', () => {
    const r = parseVoiceCommand('toggle zen mode');
    expect(r?.intent.id).toBe('toggle.zen');
  });

  it('matches "ouvre les raccourcis" → open.cheatsheet', () => {
    const r = parseVoiceCommand('ouvre les raccourcis');
    expect(r?.intent.id).toBe('open.cheatsheet');
  });

  it('returns a confidence score in (0, 1]', () => {
    const r = parseVoiceCommand('open settings');
    expect(r?.confidence).toBeGreaterThan(0);
    expect(r?.confidence).toBeLessThanOrEqual(1);
  });

  it('rejects an action without an object (just "open" alone)', () => {
    const r = parseVoiceCommand('open');
    // Only one token, no object → score < minScore (default 2).
    expect(r).toBeNull();
  });
});

describe('listIntents', () => {
  it('returns every intent with id, label, and triggers', () => {
    const list = listIntents();
    expect(list.length).toBeGreaterThan(5);
    for (const i of list) {
      expect(typeof i.id).toBe('string');
      expect(typeof i.label).toBe('string');
      expect(Array.isArray(i.triggers)).toBe(true);
    }
  });
});
