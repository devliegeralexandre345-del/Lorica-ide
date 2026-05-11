// tests/aiTestGenerator.test.js
//
// Coverage for the Wave 44 test-generator's JSON parser. The actual
// network round-trip in generateTests() isn't exercised here — we
// only care that an arbitrary model output can't slip past parsing
// and write a corrupt test file to disk.

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiTestGenerator.js';

const { parseTestJson } = __testing__;

const VALID = {
  path: 'tests/foo.test.js',
  framework: 'vitest',
  content: 'import { foo } from "../src/foo";\ntest("returns 1", () => expect(foo()).toBe(1));',
};

describe('parseTestJson', () => {
  it('parses a clean JSON payload', () => {
    const out = parseTestJson(JSON.stringify(VALID));
    expect(out?.path).toBe('tests/foo.test.js');
    expect(out?.framework).toBe('vitest');
    expect(out?.content).toContain('expect(foo()).toBe(1)');
  });

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify(VALID) + '\n```';
    const out = parseTestJson(raw);
    expect(out?.path).toBe('tests/foo.test.js');
  });

  it('strips bare ``` fences', () => {
    const raw = '```\n' + JSON.stringify(VALID) + '\n```';
    const out = parseTestJson(raw);
    expect(out?.framework).toBe('vitest');
  });

  it('extracts the JSON block from prose-wrapped output', () => {
    const raw = `Sure, here are the tests:\n${JSON.stringify(VALID)}\nLet me know if you want more!`;
    const out = parseTestJson(raw);
    expect(out?.path).toBe('tests/foo.test.js');
  });

  it('returns null on non-string input', () => {
    expect(parseTestJson(null)).toBeNull();
    expect(parseTestJson(undefined)).toBeNull();
    expect(parseTestJson(42)).toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseTestJson('not json at all')).toBeNull();
    expect(parseTestJson('')).toBeNull();
    expect(parseTestJson('{ this is broken')).toBeNull();
  });

  it('returns null when path is missing or empty', () => {
    const bad = { ...VALID, path: '' };
    expect(parseTestJson(JSON.stringify(bad))).toBeNull();
    const noPath = { framework: 'vitest', content: 'test' };
    expect(parseTestJson(JSON.stringify(noPath))).toBeNull();
  });

  it('returns null when content is missing or empty', () => {
    const bad = { ...VALID, content: '' };
    expect(parseTestJson(JSON.stringify(bad))).toBeNull();
    const noContent = { path: 'a.test.js', framework: 'vitest' };
    expect(parseTestJson(JSON.stringify(noContent))).toBeNull();
  });

  it('defaults framework to "unknown" when missing', () => {
    const noFramework = { path: 'a.test.js', content: 'test("x", () => {})' };
    const out = parseTestJson(JSON.stringify(noFramework));
    expect(out?.framework).toBe('unknown');
  });

  it('trims whitespace from path and framework', () => {
    const padded = { ...VALID, path: '  tests/foo.test.js  ', framework: '  pytest  ' };
    const out = parseTestJson(JSON.stringify(padded));
    expect(out?.path).toBe('tests/foo.test.js');
    expect(out?.framework).toBe('pytest');
  });

  it('rejects non-string content (object/array values)', () => {
    const bad = { path: 'a.test.js', framework: 'vitest', content: ['line1', 'line2'] };
    expect(parseTestJson(JSON.stringify(bad))).toBeNull();
  });
});
