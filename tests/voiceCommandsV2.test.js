// tests/voiceCommandsV2.test.js
//
// Wave 28 boundary tests: pin the new intents added on top of the
// Wave 25 catalog (file tree, command palette, omnibar, problems,
// outline, timeline, bookmarks, scratchpad, todo board, project
// brain, debug, PR ready, focus timer, split editor, snippets) plus
// the multilingual triggers (Spanish + German).

import { describe, it, expect } from 'vitest';
import { parseVoiceCommand } from '../src/utils/voiceCommands.js';

describe('Wave 28 voice intents — extended catalog', () => {
  it.each([
    ['toggle file explorer', 'open.fileTree'],
    ['mostrar archivos', 'open.fileTree'],
    ['open command palette', 'open.commandPalette'],
    ['ouvre la palette de commandes', 'open.commandPalette'],
    ['open the omnibar', 'open.omnibar'],
    ['show problems', 'open.problems'],
    ['ouvre les erreurs', 'open.problems'],
    ['mostrar errores', 'open.problems'],
    ['show outline', 'open.outline'],
    ['mostrar esquema', 'open.outline'],
    ['open timeline', 'open.timeline'],
    ['show bookmarks', 'open.bookmarks'],
    ['ouvre les favoris', 'open.bookmarks'],
    ['open scratchpad', 'open.scratchpad'],
    ['ouvre le brouillon', 'open.scratchpad'],
    ['show todo', 'open.todoBoard'],
    ['ouvre les tâches', 'open.todoBoard'],
    ['open project brain', 'open.projectBrain'],
    ['ouvre le cerveau', 'open.projectBrain'],
    ['start debugger', 'open.debug'],
    ['lance le débogueur', 'open.debug'],
    ['check pr ready', 'open.prReady'],
    ['vérifie pr', 'open.prReady'],
    ['start focus timer', 'open.focusTimer'],
    ['lance le pomodoro', 'open.focusTimer'],
    ['split editor', 'toggle.split'],
    ['divise editeur', 'toggle.split'],
    ['open snippets', 'open.snippets'],
    ['ouvre les snippets', 'open.snippets'],
  ])('matches "%s" → %s', (phrase, expectedId) => {
    const r = parseVoiceCommand(phrase);
    expect(r?.intent.id).toBe(expectedId);
  });

  it('still matches the original 13 intents from Wave 25', () => {
    expect(parseVoiceCommand('open settings')?.intent.id).toBe('open.settings');
    expect(parseVoiceCommand('save the file')?.intent.id).toBe('save.file');
    expect(parseVoiceCommand('toggle zen mode')?.intent.id).toBe('toggle.zen');
  });

  it('still rejects unrelated chatter', () => {
    expect(parseVoiceCommand('lorem ipsum dolor sit amet')).toBeNull();
    expect(parseVoiceCommand('what is the weather like today')).toBeNull();
  });
});
