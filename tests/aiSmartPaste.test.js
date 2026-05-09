// tests/aiSmartPaste.test.js
//
// Coverage for the language detector + dispatch logic added in Wave
// 11.3. The translation HTTP call itself isn't tested here (would
// need a mock server) — only the pure heuristics + the
// shouldOfferTranslation gate that decides whether the AI should be
// hit at all.

import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  shouldOfferTranslation,
  stripCodeFences,
} from '../src/utils/aiSmartPaste.js';

describe('detectLanguage', () => {
  it('returns null for empty / non-string / too-short input', () => {
    expect(detectLanguage(null)).toBeNull();
    expect(detectLanguage('')).toBeNull();
    expect(detectLanguage(42)).toBeNull();
    expect(detectLanguage('foo')).toBeNull();
  });

  it('detects Python via def + import patterns', () => {
    const code = `
import os
def greet(name: str) -> str:
    return f"hello {name}"
    `;
    const r = detectLanguage(code);
    expect(r?.lang).toBe('python');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('detects Rust via fn / let / impl', () => {
    const code = `
impl Greeter {
    pub fn greet(&self, name: &str) -> String {
        let mut s = String::new();
        format!("hello {}", name)
    }
}
    `;
    const r = detectLanguage(code);
    expect(r?.lang).toBe('rust');
  });

  it('detects TypeScript via interface + type annotations', () => {
    const code = `
interface User {
  id: number;
  name: string;
}
const u: User = { id: 1, name: 'a' };
    `;
    const r = detectLanguage(code);
    expect(r?.lang).toBe('typescript');
  });

  it('detects JavaScript via const + arrow functions when no TS markers', () => {
    const code = `
const greet = (name) => {
  console.log("hello " + name);
};
    `;
    const r = detectLanguage(code);
    expect(['javascript', 'typescript']).toContain(r?.lang);
  });

  it('detects Go via package + func + := patterns', () => {
    const code = `
package main

import "fmt"

func greet(name string) {
    msg := "hello " + name
    fmt.Println(msg)
}
    `;
    const r = detectLanguage(code);
    expect(r?.lang).toBe('go');
  });

  it('detects SQL by keyword patterns', () => {
    const code = `
SELECT users.id, users.name
FROM users
WHERE users.active = true
ORDER BY users.created_at DESC;
    `;
    const r = detectLanguage(code);
    expect(r?.lang).toBe('sql');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('detects Bash via shebang + variable substitution', () => {
    const code = `#!/usr/bin/env bash
set -euo pipefail
NAME="\${1:-world}"
echo "hello $NAME"
    `;
    const r = detectLanguage(code);
    expect(r?.lang).toBe('bash');
    expect(r.confidence).toBeGreaterThanOrEqual(1);
  });

  it('returns null when nothing scores above 0.3 (gibberish)', () => {
    const code = 'lorem ipsum dolor sit amet, consectetur adipiscing elit';
    expect(detectLanguage(code)).toBeNull();
  });
});

describe('shouldOfferTranslation', () => {
  it('returns false when source detection is missing or low-confidence', () => {
    expect(shouldOfferTranslation(null, 'rust')).toBe(false);
    expect(shouldOfferTranslation({ lang: 'python', confidence: 0.2 }, 'rust')).toBe(false);
  });

  it('returns false when no target language is provided', () => {
    expect(shouldOfferTranslation({ lang: 'python', confidence: 0.9 }, '')).toBe(false);
    expect(shouldOfferTranslation({ lang: 'python', confidence: 0.9 }, null)).toBe(false);
  });

  it('returns false when source equals target (after alias normalisation)', () => {
    expect(shouldOfferTranslation({ lang: 'typescript', confidence: 0.9 }, 'ts')).toBe(false);
    expect(shouldOfferTranslation({ lang: 'javascript', confidence: 0.9 }, 'jsx')).toBe(false);
    expect(shouldOfferTranslation({ lang: 'cpp', confidence: 0.9 }, 'h')).toBe(false);
    expect(shouldOfferTranslation({ lang: 'bash', confidence: 0.9 }, 'sh')).toBe(false);
  });

  it('returns true when source != target and confidence is sufficient', () => {
    expect(shouldOfferTranslation({ lang: 'python', confidence: 0.9 }, 'rust')).toBe(true);
    expect(shouldOfferTranslation({ lang: 'python', confidence: 0.9 }, 'ts')).toBe(true);
  });
});

describe('stripCodeFences', () => {
  it('removes leading triple-backtick fences with a language tag', () => {
    expect(stripCodeFences('```rust\nfn main() {}\n```')).toBe('fn main() {}');
  });

  it('removes fences without a language tag', () => {
    expect(stripCodeFences('```\nbody\n```')).toBe('body');
  });

  it('leaves bodies that have no fences alone', () => {
    expect(stripCodeFences('plain body\nwith newlines')).toBe('plain body\nwith newlines');
  });

  it('handles non-string input gracefully', () => {
    expect(stripCodeFences(null)).toBe('');
    expect(stripCodeFences(undefined)).toBe('');
  });
});
