// tests/aiProvidersOpenRouter.test.js
//
// Coverage for the OpenRouter additions in Wave 19. Pins the URL,
// header shape, OpenAI-compatible body shape, response extraction, and
// the keyless / supportsTools predicates so a future refactor doesn't
// silently regress.

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
  resolveProviderConfig,
} from '../src/utils/aiProviders.js';

describe('catalog includes OpenRouter', () => {
  it('lists openrouter alongside the other 3 providers', () => {
    expect(PROVIDERS).toEqual(['anthropic', 'deepseek', 'ollama', 'openrouter']);
    expect(PROVIDER_LABELS.openrouter).toBe('OpenRouter (BYOK aggregator)');
    expect(PROVIDER_DEFAULT_MODELS.openrouter).toBe('anthropic/claude-3.5-haiku');
  });
});

describe('getEndpoint(openrouter)', () => {
  it('returns the canonical OpenRouter chat-completions URL', () => {
    expect(getEndpoint('openrouter')).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

describe('getHeaders(openrouter)', () => {
  it('uses Authorization Bearer plus the courtesy attribution headers', () => {
    const h = getHeaders('openrouter', 'sk-or-XXX');
    expect(h.Authorization).toBe('Bearer sk-or-XXX');
    expect(h['HTTP-Referer']).toBeTruthy();
    expect(h['X-Title']).toBe('Lorica IDE');
    expect(h['Content-Type']).toBe('application/json');
  });
  it('falls back to an empty bearer rather than throwing on missing key', () => {
    const h = getHeaders('openrouter');
    expect(h.Authorization).toBe('Bearer ');
  });
});

describe('buildChatBody(openrouter)', () => {
  const messages = [{ role: 'user', content: 'hi' }];
  it('matches the OpenAI shape (system message prepended)', () => {
    const body = buildChatBody({
      provider: 'openrouter',
      model: 'meta-llama/llama-3.1-405b',
      system: 'be brief',
      messages,
    });
    expect(body.model).toBe('meta-llama/llama-3.1-405b');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(body.messages[1]).toEqual(messages[0]);
  });
});

describe('extractText(openrouter)', () => {
  it('reads OpenAI-style choices', () => {
    const json = { choices: [{ message: { content: 'reply' } }] };
    expect(extractText('openrouter', json)).toBe('reply');
  });
});

describe('predicates with openrouter', () => {
  it('isKeyless: false (still requires a BYOK key)', () => {
    expect(isKeyless('openrouter')).toBe(false);
  });
  it('supportsTools: true (forwards to upstream model capabilities)', () => {
    expect(supportsTools('openrouter')).toBe(true);
  });
});

describe('resolve helpers', () => {
  it('resolveApiKey reads aiOpenRouterKey for openrouter', () => {
    expect(resolveApiKey('openrouter', { aiOpenRouterKey: 'sk-or-X' })).toBe('sk-or-X');
    expect(resolveApiKey('openrouter', {})).toBe('');
  });

  it('resolveModel respects aiOpenRouterModel override', () => {
    expect(resolveModel('openrouter', { aiOpenRouterModel: 'openai/gpt-4o-mini' }))
      .toBe('openai/gpt-4o-mini');
    expect(resolveModel('openrouter', null)).toBe(PROVIDER_DEFAULT_MODELS.openrouter);
  });

  it('resolveProviderConfig packs provider + key + model + keyOk together', () => {
    const cfg = resolveProviderConfig({
      aiProvider: 'openrouter',
      aiOpenRouterKey: 'sk-or-X',
      aiOpenRouterModel: 'qwen/qwen-2.5-72b',
    });
    expect(cfg.provider).toBe('openrouter');
    expect(cfg.apiKey).toBe('sk-or-X');
    expect(cfg.model).toBe('qwen/qwen-2.5-72b');
    expect(cfg.keyOk).toBe(true);
  });

  it('resolveProviderConfig flips keyOk false when openrouter has no key', () => {
    const cfg = resolveProviderConfig({ aiProvider: 'openrouter' });
    expect(cfg.keyOk).toBe(false);
  });

  it('resolveProviderConfig keeps Ollama keyOk=true even with no key', () => {
    const cfg = resolveProviderConfig({ aiProvider: 'ollama' });
    expect(cfg.keyOk).toBe(true);
  });
});
