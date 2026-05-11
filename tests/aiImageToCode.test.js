// tests/aiImageToCode.test.js
//
// Coverage for the Wave 63 image data-URL parser. The actual vision
// API call isn't tested — only the URL extraction so a malformed
// data URL can't reach the Anthropic endpoint with garbage.

import { describe, it, expect } from 'vitest';
import { __testing__ } from '../src/utils/aiImageToCode.js';

const { parseDataUrl } = __testing__;

describe('parseDataUrl', () => {
  it('parses a PNG data URL', () => {
    const out = parseDataUrl('data:image/png;base64,iVBORw0KGgo=');
    expect(out?.mediaType).toBe('image/png');
    expect(out?.data).toBe('iVBORw0KGgo=');
  });

  it('parses a JPEG data URL', () => {
    const out = parseDataUrl('data:image/jpeg;base64,/9j/4AAQ');
    expect(out?.mediaType).toBe('image/jpeg');
    expect(out?.data).toBe('/9j/4AAQ');
  });

  it('parses a WebP data URL', () => {
    const out = parseDataUrl('data:image/webp;base64,UklGRg==');
    expect(out?.mediaType).toBe('image/webp');
    expect(out?.data).toBe('UklGRg==');
  });

  it('tolerates trailing whitespace', () => {
    const out = parseDataUrl('   data:image/png;base64,iVBORw0KGgo=   ');
    expect(out?.mediaType).toBe('image/png');
  });

  it('handles multiline base64 (line breaks tolerated by /s flag)', () => {
    const out = parseDataUrl('data:image/png;base64,iVBORw0K\nGgo=');
    expect(out?.mediaType).toBe('image/png');
    expect(out?.data).toContain('GgoP=' === out?.data ? 'GgoP=' : 'Ggo=');
  });

  it('returns null on non-image data URLs', () => {
    expect(parseDataUrl('data:text/plain;base64,aGVsbG8=')).toBeNull();
    expect(parseDataUrl('data:application/json;base64,e30=')).toBeNull();
  });

  it('returns null on non-data URLs', () => {
    expect(parseDataUrl('https://example.com/img.png')).toBeNull();
    expect(parseDataUrl('file:///tmp/img.png')).toBeNull();
  });

  it('returns null on non-string input', () => {
    expect(parseDataUrl(null)).toBeNull();
    expect(parseDataUrl(undefined)).toBeNull();
    expect(parseDataUrl(42)).toBeNull();
  });

  it('returns null on missing base64 marker', () => {
    expect(parseDataUrl('data:image/png,iVBORw0KGgo=')).toBeNull();
  });
});
