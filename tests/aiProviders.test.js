// tests/aiProviders.test.js
//
// Coverage for the centralised AI provider config (Wave 11.1). Pins
// the URL/header/body shape per provider so a future refactor doesn't
// silently break any of the ~10 call sites that read them.

import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_DEFAULT_MODELS,
  getEndpoint,
  getHeaders,
  buildChatBody,
  extractText,
  isKeyless,
  supportsTools,
  resolveApiKey,
  resolveModel,
  resolveOllamaBase,
} from '../src/utils/aiProviders.js';

describe('catalog', () => {
  it('lists the four providers (Wave 19 added openrouter)', () => {
    expect(PROVIDERS).toEqual(['anthropic', 'deepseek', 'ollama', 'openrouter']);
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(['anthropic', 'deepseek', 'ollama', 'openrouter']);
    expect(Object.keys(PROVIDER_DEFAULT_MODELS).sort()).toEqual(['anthropic', 'deepseek', 'ollama', 'openrouter']);
  });
});

describe('getEndpoint', () => {
  it('returns the canonical Anthropic endpoint', () => {
    expect(getEndpoint('anthropic')).toBe('https://api.anthropic.com/v1/messages');
  });
  it('returns the DeepSeek chat-completions endpoint', () => {
    expect(getEndpoint('deepseek')).toBe('https://api.deepseek.com/v1/chat/completions');
  });
  it('defaults Ollama to localhost:11434/v1/chat/completions', () => {
    expect(getEndpoint('ollama')).toBe('http://localhost:11434/v1/chat/completions');
  });
  it('respects a custom Ollama base URL and strips a trailing slash', () => {
    expect(getEndpoint('ollama', 'http://192.168.1.50:11434/'))
      .toBe('http://192.168.1.50:11434/v1/chat/completions');
  });
  it('throws on an unknown provider', () => {
    expect(() => getEndpoint('mystery')).toThrow();
  });
});

describe('getHeaders', () => {
  it('Anthropic uses x-api-key + anthropic-version', () => {
    const h = getHeaders('anthropic', 'sk-ant-XXX');
    expect(h['x-api-key']).toBe('sk-ant-XXX');
    expect(h['anthropic-version']).toBeDefined();
    expect(h['Content-Type']).toBe('application/json');
  });
  it('DeepSeek uses Authorization Bearer', () => {
    const h = getHeaders('deepseek', 'sk-XXX');
    expect(h.Authorization).toBe('Bearer sk-XXX');
  });
  it('Ollama omits any auth header', () => {
    const h = getHeaders('ollama');
    expect(h.Authorization).toBeUndefined();
    expect(h['x-api-key']).toBeUndefined();
    expect(h['Content-Type']).toBe('application/json');
  });
});

describe('buildChatBody', () => {
  const messages = [{ role: 'user', content: 'hello' }];

  it('Anthropic shape includes max_tokens, system, and messages without a system message', () => {
    const body = buildChatBody({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      messages,
      system: 'be terse',
    });
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.system).toBe('be terse');
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toEqual(messages);
  });

  it('OpenAI-shape (DeepSeek) prepends a system message', () => {
    const body = buildChatBody({
      provider: 'deepseek',
      messages,
      system: 'be terse',
    });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be terse' });
    expect(body.messages[1]).toEqual(messages[0]);
  });

  it('Ollama shape mirrors DeepSeek (OpenAI-compatible)', () => {
    const body = buildChatBody({ provider: 'ollama', model: 'llama3.1:8b', messages });
    expect(body.model).toBe('llama3.1:8b');
    expect(body.messages).toEqual(messages);
  });

  it('falls back to per-provider default model when none given', () => {
    const a = buildChatBody({ provider: 'anthropic', messages });
    expect(a.model).toBe(PROVIDER_DEFAULT_MODELS.anthropic);
    const o = buildChatBody({ provider: 'ollama', messages });
    expect(o.model).toBe(PROVIDER_DEFAULT_MODELS.ollama);
  });
});

describe('extractText', () => {
  it('reads Anthropic content blocks', () => {
    const json = { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] };
    expect(extractText('anthropic', json)).toBe('hello world');
  });
  it('reads OpenAI-style choices for DeepSeek + Ollama', () => {
    const json = { choices: [{ message: { content: 'reply' } }] };
    expect(extractText('deepseek', json)).toBe('reply');
    expect(extractText('ollama', json)).toBe('reply');
  });
  it('throws on an empty response', () => {
    expect(() => extractText('anthropic', null)).toThrow();
  });
});

describe('predicates', () => {
  it('isKeyless: only Ollama', () => {
    expect(isKeyless('ollama')).toBe(true);
    expect(isKeyless('anthropic')).toBe(false);
    expect(isKeyless('deepseek')).toBe(false);
  });

  it('supportsTools: all three providers (caller surfaces runtime errors)', () => {
    expect(supportsTools('anthropic')).toBe(true);
    expect(supportsTools('deepseek')).toBe(true);
    expect(supportsTools('ollama')).toBe(true);
  });
});

describe('resolveApiKey / resolveModel / resolveOllamaBase', () => {
  it('resolveApiKey returns the right key per provider', () => {
    const state = { aiApiKey: 'A', aiDeepseekKey: 'D' };
    expect(resolveApiKey('anthropic', state)).toBe('A');
    expect(resolveApiKey('deepseek', state)).toBe('D');
    expect(resolveApiKey('ollama', state)).toBeNull();
  });

  it('resolveModel respects state overrides', () => {
    expect(resolveModel('anthropic', { agentConfig: { model: 'claude-haiku' } }))
      .toBe('claude-haiku');
    expect(resolveModel('ollama', { aiOllamaModel: 'qwen2.5:7b' }))
      .toBe('qwen2.5:7b');
    expect(resolveModel('deepseek', null)).toBe(PROVIDER_DEFAULT_MODELS.deepseek);
  });

  it('resolveOllamaBase falls back to default when state has none', () => {
    expect(resolveOllamaBase(null)).toBe('http://localhost:11434');
    expect(resolveOllamaBase({ aiOllamaUrl: 'http://x' })).toBe('http://x');
  });
});
