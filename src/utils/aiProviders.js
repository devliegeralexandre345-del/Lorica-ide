// src/utils/aiProviders.js
//
// Single source of truth for AI provider config. Until Wave 11 we had
// `https://api.anthropic.com/...` and `https://api.deepseek.com/...`
// hardcoded across ~10 files; Wave 11 adds **Ollama** (local LLM via
// http://localhost:11434) and that's a third URL too many to keep
// inlining everywhere. This module owns the URLs, the request-body
// shape per provider, and the response parser so the rest of the app
// can switch providers by id.
//
// Privacy posture (per provider):
//   • anthropic — cloud, BYOK, requests over HTTPS
//   • deepseek  — cloud, BYOK, requests over HTTPS
//   • ollama    — **localhost only**. Zero network egress. The
//                 IDE-shipped DNA: privacy-first means a real local
//                 option, not "trust us with your code".

export const PROVIDERS = ['anthropic', 'deepseek', 'ollama', 'openrouter'];

export const PROVIDER_LABELS = {
  anthropic:  'Anthropic Claude',
  deepseek:   'DeepSeek',
  ollama:     'Ollama (local)',
  openrouter: 'OpenRouter (BYOK aggregator)',
};

// Default model per provider. Anthropic / DeepSeek are pinned to the
// latest model that's stable as of the v2.3 release. Ollama is a moving
// target (depends on what the user `ollama pull`-ed), so we default to
// the most common one and let Settings override it. OpenRouter exposes
// hundreds of models via OpenAI-compatible API; default to a fast +
// cheap one and let Settings override.
export const PROVIDER_DEFAULT_MODELS = {
  anthropic:  'claude-sonnet-4-20250514',
  deepseek:   'deepseek-chat',
  ollama:     'llama3.1:8b',
  openrouter: 'anthropic/claude-3.5-haiku',
};

// Endpoint URL per provider. Ollama's URL is dynamic — the user can
// override the base in Settings (e.g. an Ollama server on another
// machine on their LAN). We expose `getEndpoint(provider, baseUrl?)`
// rather than a constant so the override flows through.
const ANTHROPIC_BASE   = 'https://api.anthropic.com';
const DEEPSEEK_BASE    = 'https://api.deepseek.com';
const OPENROUTER_BASE  = 'https://openrouter.ai/api';
const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';

export function getEndpoint(provider, baseUrl) {
  switch (provider) {
    case 'anthropic': return `${ANTHROPIC_BASE}/v1/messages`;
    case 'deepseek':  return `${DEEPSEEK_BASE}/v1/chat/completions`;
    // Ollama exposes an OpenAI-compatible API at /v1/chat/completions
    // since v0.1.31. Using it (rather than /api/chat) lets us share the
    // request body shape with DeepSeek and keeps this module small.
    case 'ollama':
      return `${(baseUrl || OLLAMA_DEFAULT_BASE).replace(/\/$/, '')}/v1/chat/completions`;
    // OpenRouter speaks OpenAI-compatible at /api/v1/chat/completions.
    // Same body / response shape as DeepSeek + Ollama — only auth
    // differs (Bearer token like DeepSeek).
    case 'openrouter':
      return `${OPENROUTER_BASE}/v1/chat/completions`;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// Headers per provider. Anthropic uses `x-api-key` + a version header;
// DeepSeek uses standard `Authorization: Bearer`; Ollama needs no auth
// because it's localhost-bound (and rejects the header gracefully if
// it slipped through anyway).
export function getHeaders(provider, apiKey) {
  switch (provider) {
    case 'anthropic':
      return {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-api-key': apiKey || '',
      };
    case 'deepseek':
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey || ''}`,
      };
    case 'ollama':
      // Ollama tolerates a bearer header but doesn't require one. Sending
      // an empty bearer can confuse some reverse proxies, so we skip it.
      return { 'Content-Type': 'application/json' };
    case 'openrouter':
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey || ''}`,
        // OpenRouter encourages clients to identify themselves via these
        // optional headers; doing so unlocks better routing and lets the
        // dashboard attribute usage correctly.
        'HTTP-Referer': 'https://github.com/devliegeralexandre345-del/Lorica-ide',
        'X-Title': 'Lorica IDE',
      };
    default:
      return { 'Content-Type': 'application/json' };
  }
}

// Build the request body for a chat-style call. Anthropic's `messages`
// endpoint is shaped differently from OpenAI/DeepSeek/Ollama's chat
// completions, so we branch on provider once here and downstream
// callers stay agnostic. `messages` follows the OpenAI shape
// (`{role, content}`); we adapt for Anthropic.
export function buildChatBody({
  provider,
  model,
  messages,
  system,
  maxTokens,
  temperature,
  stream,
}) {
  if (provider === 'anthropic') {
    return {
      model: model || PROVIDER_DEFAULT_MODELS.anthropic,
      max_tokens: maxTokens ?? 4096,
      ...(typeof temperature === 'number' ? { temperature } : {}),
      ...(system ? { system } : {}),
      ...(stream ? { stream: true } : {}),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  }
  // DeepSeek + Ollama + OpenRouter share the OpenAI shape.
  const oaiMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : [...messages];
  return {
    model: model || PROVIDER_DEFAULT_MODELS[provider],
    messages: oaiMessages,
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

// Extract the text content from a provider's response JSON. Throws if
// the shape doesn't match — caller catches and surfaces.
export function extractText(provider, json) {
  if (!json || typeof json !== 'object') {
    throw new Error('Empty response');
  }
  if (provider === 'anthropic') {
    // Anthropic shape: { content: [{ type: 'text', text: '…' }, …] }
    const blocks = json.content || [];
    return blocks
      .filter((b) => b?.type === 'text')
      .map((b) => b.text || '')
      .join('');
  }
  // OpenAI-compatible (DeepSeek + Ollama + OpenRouter):
  //   { choices: [{ message: { content: '…' } }] }
  const choice = (json.choices || [])[0];
  return choice?.message?.content ?? choice?.text ?? '';
}

// True if this provider can be used without a user-supplied API key.
// Ollama runs locally, no key needed. Used by Settings to skip the
// "API key required" warning for Ollama.
export function isKeyless(provider) {
  return provider === 'ollama';
}

// True if the active provider supports tool / function calling. v0
// Lorica agent flow requires tool use (read_file, write_file, …), so
// the agent panel disables itself when this returns false. Anthropic
// always supports it; DeepSeek's `deepseek-chat` does; Ollama depends
// on the model — Llama 3.1+, Qwen 2.5+, and Mistral models with the
// `tool_calling` capability all work, others don't. OpenRouter
// forwards tool calls to whichever upstream model the user picked, so
// it inherits the upstream's capability — we assume "yes" and let
// runtime errors surface if the user picked a model that can't.
export function supportsTools(provider /*, model */) {
  return (
    provider === 'anthropic' ||
    provider === 'deepseek' ||
    provider === 'ollama' ||
    provider === 'openrouter'
  );
}

// Resolve which API key to use for the given provider, given the full
// state object. Ollama returns null (intentional — no key needed).
export function resolveApiKey(provider, state) {
  if (!state) return '';
  switch (provider) {
    case 'anthropic':  return state.aiApiKey || '';
    case 'deepseek':   return state.aiDeepseekKey || '';
    case 'ollama':     return null;
    case 'openrouter': return state.aiOpenRouterKey || '';
    default:           return '';
  }
}

// One-stop helper for call sites that just need provider + key + model
// + ollama base. Call sites build a config object from the reducer
// state in one line instead of repeating the 4-way branch.
export function resolveProviderConfig(state) {
  const provider = state?.aiProvider || 'anthropic';
  return {
    provider,
    apiKey: resolveApiKey(provider, state),
    model: resolveModel(provider, state),
    ollamaBaseUrl: provider === 'ollama' ? resolveOllamaBase(state) : undefined,
    keyOk: isKeyless(provider) || !!resolveApiKey(provider, state),
  };
}

// Resolve the active model for the provider, with state overrides.
// Anthropic uses `state.agentConfig.model` when set (Sonnet/Haiku
// switching), DeepSeek pinned to deepseek-chat, Ollama uses whatever
// the user picked in Settings (`state.aiOllamaModel`), OpenRouter uses
// `state.aiOpenRouterModel` (any of the 100+ upstreams routed through
// their gateway).
export function resolveModel(provider, state, fallback) {
  switch (provider) {
    case 'anthropic':
      return state?.agentConfig?.model || fallback || PROVIDER_DEFAULT_MODELS.anthropic;
    case 'deepseek':
      return fallback || PROVIDER_DEFAULT_MODELS.deepseek;
    case 'ollama':
      return state?.aiOllamaModel || fallback || PROVIDER_DEFAULT_MODELS.ollama;
    case 'openrouter':
      return state?.aiOpenRouterModel || fallback || PROVIDER_DEFAULT_MODELS.openrouter;
    default:
      return fallback || '';
  }
}

// Resolve the Ollama base URL from state (settings override) or fall
// back to the default localhost.
export function resolveOllamaBase(state) {
  return state?.aiOllamaUrl || OLLAMA_DEFAULT_BASE;
}

// Fetch the list of locally-installed Ollama models. Returns an array
// of `{ name, size, modified_at }`. Empty array on any failure (the
// user might just not have Ollama running).
export async function listOllamaModels(baseUrl) {
  const base = (baseUrl || OLLAMA_DEFAULT_BASE).replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.models) ? json.models : [];
  } catch {
    return [];
  }
}

// Fetch OpenRouter's model catalog. Returns an array of
// `{ id, name, context_length, pricing: { prompt, completion } }`.
// The catalog is cached behind a 5-minute revalidate window because
// the list is large (~300 entries) but only changes a few times a
// week. Empty array on failure — the Settings UI falls back to a
// free-text model input.
let openrouterCache = { at: 0, list: [] };
export async function listOpenRouterModels({ apiKey } = {}) {
  if (Date.now() - openrouterCache.at < 5 * 60 * 1000 && openrouterCache.list.length > 0) {
    return openrouterCache.list;
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    // The /models endpoint is callable without an API key, but
    // sending one unlocks model availability scoped to the user's
    // account (e.g. preview models).
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${OPENROUTER_BASE}/v1/models`, { method: 'GET', headers });
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    openrouterCache = { at: Date.now(), list };
    return list;
  } catch {
    return [];
  }
}
