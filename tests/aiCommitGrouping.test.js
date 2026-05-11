// tests/aiCommitGrouping.test.js
//
// Coverage for the Wave 65 commit-grouping JSON parser. The provider
// round-trip isn't tested — only the parser that protects the panel
// from invalid suggestions.

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiCommitGrouping.js';

const { parseGroupingJson } = __testing__;

const GROUP = {
  subject: 'feat(auth): add SSO login flow',
  body: 'Add the new endpoint and the corresponding UI.',
  files: ['src/auth/sso.ts', 'src/auth/SsoButton.tsx'],
  rationale: 'New feature, ship together.',
};

describe('parseGroupingJson', () => {
  it('parses a single-group payload', () => {
    const out = parseGroupingJson(JSON.stringify({ groups: [GROUP] }));
    expect(out?.groups).toHaveLength(1);
    expect(out.groups[0].subject).toMatch(/SSO/);
    expect(out.groups[0].files).toEqual(['src/auth/sso.ts', 'src/auth/SsoButton.tsx']);
  });

  it('parses multiple groups', () => {
    const groups = [
      GROUP,
      { subject: 'fix: typo', files: ['README.md'] },
      { subject: 'test: cover edge case', body: '', files: ['tests/foo.test.js'] },
    ];
    const out = parseGroupingJson(JSON.stringify({ groups }));
    expect(out?.groups).toHaveLength(3);
  });

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify({ groups: [GROUP] }) + '\n```';
    expect(parseGroupingJson(raw)?.groups).toHaveLength(1);
  });

  it('returns null on garbage', () => {
    expect(parseGroupingJson('not json')).toBeNull();
    expect(parseGroupingJson('')).toBeNull();
    expect(parseGroupingJson(null)).toBeNull();
    expect(parseGroupingJson('{ broken')).toBeNull();
  });

  it('returns null when groups is missing or empty', () => {
    expect(parseGroupingJson(JSON.stringify({}))).toBeNull();
    expect(parseGroupingJson(JSON.stringify({ groups: [] }))).toBeNull();
    expect(parseGroupingJson(JSON.stringify({ groups: null }))).toBeNull();
  });

  it('drops entries with missing subject', () => {
    const out = parseGroupingJson(JSON.stringify({
      groups: [GROUP, { files: ['x.js'] }],
    }));
    expect(out?.groups).toHaveLength(1);
  });

  it('drops entries with empty subject', () => {
    const out = parseGroupingJson(JSON.stringify({
      groups: [GROUP, { subject: '   ', files: ['x.js'] }],
    }));
    expect(out?.groups).toHaveLength(1);
  });

  it('drops entries with missing or empty files array', () => {
    const out = parseGroupingJson(JSON.stringify({
      groups: [
        GROUP,
        { subject: 'no files', files: [] },
        { subject: 'no files', files: null },
        { subject: 'no files' },
      ],
    }));
    expect(out?.groups).toHaveLength(1);
  });

  it('drops entries containing non-string file paths', () => {
    const out = parseGroupingJson(JSON.stringify({
      groups: [GROUP, { subject: 'bad', files: ['ok.js', 42] }],
    }));
    expect(out?.groups).toHaveLength(1);
  });

  it('caps at 5 groups', () => {
    const groups = Array.from({ length: 8 }, (_, i) => ({
      subject: `feat: g${i}`,
      files: [`f${i}.js`],
    }));
    const out = parseGroupingJson(JSON.stringify({ groups }));
    expect(out?.groups).toHaveLength(5);
  });

  it('treats missing body / rationale as empty string', () => {
    const minimal = { subject: 'feat: x', files: ['a.js'] };
    const out = parseGroupingJson(JSON.stringify({ groups: [minimal] }));
    expect(out.groups[0].body).toBe('');
    expect(out.groups[0].rationale).toBe('');
  });
});
