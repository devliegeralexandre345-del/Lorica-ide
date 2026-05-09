// tests/aiThemeGenerator.test.js
//
// Coverage for the Wave 33 AI theme generator's pure helpers. The
// network call (generateTheme) isn't tested here — only the JSON
// validation, slug resolution, and parse-defensiveness so a hostile
// model output can't slip through into the THEMES map.

import { describe, it, expect } from 'vitest';
import {
  themeKeyForName,
  __testing__,
} from '../src/utils/aiThemeGenerator.js';

const { parseThemeJson, isValidThemeShape } = __testing__;

const VALID = {
  name: 'Tokyo Neon',
  bg: '#0a0e17',
  surface: '#111827',
  panel: '#1a2236',
  border: '#1e2d4a',
  accent: '#ff6bff',
  text: '#e2e8f0',
  textDim: '#64748b',
  logoBars: ['#ff6bff', '#c84aff', '#9c89ff', '#7fd2ec', '#bfeff6'],
};

describe('isValidThemeShape', () => {
  it('accepts a full valid theme', () => {
    expect(isValidThemeShape(VALID)).toBe(true);
  });

  it('rejects when name is missing or empty', () => {
    expect(isValidThemeShape({ ...VALID, name: '' })).toBe(false);
    expect(isValidThemeShape({ ...VALID, name: undefined })).toBe(false);
  });

  it('rejects malformed hex values', () => {
    expect(isValidThemeShape({ ...VALID, bg: '0a0e17' })).toBe(false); // missing #
    expect(isValidThemeShape({ ...VALID, accent: '#xyz123' })).toBe(false); // bad chars
    expect(isValidThemeShape({ ...VALID, text: 'rgb(1,2,3)' })).toBe(false); // not hex
  });

  it('rejects fewer than 5 logoBars', () => {
    expect(isValidThemeShape({ ...VALID, logoBars: VALID.logoBars.slice(0, 4) })).toBe(false);
  });

  it('rejects logoBars containing non-hex entries', () => {
    expect(isValidThemeShape({ ...VALID, logoBars: ['#ff6bff', 'red', '#9c89ff', '#7fd2ec', '#bfeff6'] })).toBe(false);
  });

  it('rejects null / non-object input', () => {
    expect(isValidThemeShape(null)).toBe(false);
    expect(isValidThemeShape('string')).toBe(false);
    expect(isValidThemeShape([])).toBe(false);
  });
});

describe('parseThemeJson', () => {
  it('extracts a JSON object from raw model output', () => {
    const raw = JSON.stringify(VALID);
    const out = parseThemeJson(raw);
    expect(out?.name).toBe('Tokyo Neon');
  });

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify(VALID) + '\n```';
    const out = parseThemeJson(raw);
    expect(out?.name).toBe('Tokyo Neon');
  });

  it('extracts the first {...} block from prose-wrapped output', () => {
    const raw = `Sure, here's the theme:\n${JSON.stringify(VALID)}\nLet me know if you want adjustments!`;
    const out = parseThemeJson(raw);
    expect(out?.name).toBe('Tokyo Neon');
  });

  it('returns null on garbage input', () => {
    expect(parseThemeJson('{ this is not valid json')).toBeNull();
    expect(parseThemeJson('')).toBeNull();
    expect(parseThemeJson(null)).toBeNull();
  });

  it('returns null when the parsed object fails validation', () => {
    const bad = { ...VALID, bg: 'not-hex' };
    expect(parseThemeJson(JSON.stringify(bad))).toBeNull();
  });
});

describe('themeKeyForName', () => {
  it('camelCases a multi-word name', () => {
    expect(themeKeyForName('Tokyo Neon Midnight')).toBe('tokyoNeonMidnight');
  });

  it('strips accents and punctuation', () => {
    expect(themeKeyForName('Forêt Magique!!')).toBe('foretMagique');
  });

  it('falls back to "custom" on empty / non-string input', () => {
    expect(themeKeyForName('')).toBe('custom');
    expect(themeKeyForName('   ')).toBe('custom');
  });

  it('appends a numeric suffix on collision', () => {
    expect(themeKeyForName('Midnight', ['midnight'])).toBe('midnight2');
    expect(themeKeyForName('Midnight', ['midnight', 'midnight2'])).toBe('midnight3');
  });
});
