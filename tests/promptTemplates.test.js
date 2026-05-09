// tests/promptTemplates.test.js
//
// Coverage for the .lorica/prompts/*.md frontmatter parser and the
// {{selection}} / {{file}} / {{open_files}} expander (Wave 1).

import { describe, it, expect } from 'vitest';
import {
  parsePromptFile,
  expandPrompt,
  buildInstructionsPrefix,
} from '../src/utils/promptTemplates.js';

describe('parsePromptFile', () => {
  it('returns the whole input as body when there is no frontmatter', () => {
    const r = parsePromptFile('Just a body, no fence.');
    expect(r.meta).toEqual({});
    expect(r.body).toBe('Just a body, no fence.');
  });

  it('parses name + description from frontmatter', () => {
    const text = [
      '---',
      'name: Explain selection',
      'description: Walk through the highlighted code',
      '---',
      'Body of the prompt.',
    ].join('\n');
    const r = parsePromptFile(text);
    expect(r.meta).toEqual({
      name: 'Explain selection',
      description: 'Walk through the highlighted code',
    });
    expect(r.body).toBe('Body of the prompt.');
  });

  it('strips quotes around values', () => {
    const text = '---\nname: "Quoted name"\ndescription: \'single quoted\'\n---\nbody';
    const r = parsePromptFile(text);
    expect(r.meta.name).toBe('Quoted name');
    expect(r.meta.description).toBe('single quoted');
  });

  it('lowercases keys (so "Name" still works)', () => {
    const text = '---\nName: foo\nDescription: bar\n---\nbody';
    const r = parsePromptFile(text);
    expect(r.meta).toEqual({ name: 'foo', description: 'bar' });
  });

  it('ignores unknown / blank / commented frontmatter lines', () => {
    const text = [
      '---',
      'name: kept',
      '# comment line',
      '',
      'unknown: ignored',
      '---',
      'body',
    ].join('\n');
    const r = parsePromptFile(text);
    expect(r.meta).toEqual({ name: 'kept' });
  });

  it('handles CRLF line endings', () => {
    const text = '---\r\nname: crlf\r\n---\r\nBody.';
    const r = parsePromptFile(text);
    expect(r.meta.name).toBe('crlf');
    expect(r.body).toBe('Body.');
  });

  it('handles non-string input gracefully', () => {
    expect(parsePromptFile(undefined)).toEqual({ meta: {}, body: '' });
    expect(parsePromptFile(null)).toEqual({ meta: {}, body: '' });
    expect(parsePromptFile(42)).toEqual({ meta: {}, body: '42' });
  });

  it('preserves an empty body after the closing fence', () => {
    const r = parsePromptFile('---\nname: only-meta\n---\n');
    expect(r.meta.name).toBe('only-meta');
    expect(r.body).toBe('');
  });
});

describe('expandPrompt', () => {
  it('substitutes known placeholders', () => {
    const out = expandPrompt('Sel: {{selection}} / file: {{file}} / list: {{open_files}}', {
      selection: 'foo',
      file: 'src/foo.js',
      openFiles: ['a.js', 'b.js'],
    });
    expect(out).toBe('Sel: foo / file: src/foo.js / list: a.js\nb.js');
  });

  it('leaves unknown placeholders untouched (typo-friendly)', () => {
    const out = expandPrompt('hi {{unknown}} {{selection}}', { selection: 'x' });
    expect(out).toBe('hi {{unknown}} x');
  });

  it('treats missing fields as empty strings', () => {
    expect(expandPrompt('[{{selection}}] [{{file}}]')).toBe('[] []');
  });

  it('filters falsy entries out of openFiles before joining', () => {
    expect(expandPrompt('{{open_files}}', { openFiles: ['a', '', null, 'b'] })).toBe('a\nb');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(expandPrompt('{{ selection }}', { selection: 'X' })).toBe('X');
  });

  it('coerces non-string body to string', () => {
    expect(expandPrompt(null)).toBe('');
    expect(expandPrompt(123)).toBe('123');
  });
});

describe('buildInstructionsPrefix', () => {
  it('returns null for empty / whitespace-only input', () => {
    expect(buildInstructionsPrefix('')).toBeNull();
    expect(buildInstructionsPrefix('   \n\t  ')).toBeNull();
    expect(buildInstructionsPrefix(undefined)).toBeNull();
  });

  it('frames the instructions with a project header and a separator', () => {
    const out = buildInstructionsPrefix('Be brief.');
    expect(out).toContain('Project instructions (from .lorica/instructions.md):');
    expect(out).toContain('Be brief.');
    expect(out).toContain('---');
    expect(out).toContain('User message:');
    // User message header should land at the very end so the next line
    // appended by the caller is the user's actual message.
    expect(out.endsWith('User message:\n')).toBe(true);
  });
});
