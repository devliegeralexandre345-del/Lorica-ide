// src/hooks/useAgent.js
import { useCallback, useRef } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { buildToolsForPermissions, NON_DESTRUCTIVE_TOOLS } from '../utils/agentTools';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

// Default models per provider (overridable via state.agentConfig.model)
const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  deepseek: 'deepseek-chat',
};

// Convert Anthropic-style tool defs to OpenAI/DeepSeek format
function toOpenAITools(anthropicTools) {
  return anthropicTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// --- Fetch strategy selector ---
// DeepSeek allows browser CORS, so native fetch works and streams well.
// Anthropic requires the dangerous-direct-browser-access header + sometimes blocks — route through Tauri.
// If native fetch fails for DeepSeek, we fall back to tauriFetch.
async function robustFetch(url, opts, preferNative) {
  // Strip Tauri-specific options
  const init = { ...opts };
  if (preferNative) {
    try {
      return await fetch(url, init);
    } catch (e) {
      // Fall back to Tauri HTTP plugin
      try {
        return await tauriFetch(url, init);
      } catch (e2) {
        throw new Error(`Native fetch failed (${e.message}); Tauri fetch also failed (${e2.message})`);
      }
    }
  }
  try {
    return await tauriFetch(url, init);
  } catch (e) {
    try {
      return await fetch(url, init);
    } catch (e2) {
      throw new Error(`Tauri fetch failed (${e.message}); native fetch also failed (${e2.message})`);
    }
  }
}

export function useAgent(state, dispatch) {
  const abortRef = useRef(null);
  const approvalRef = useRef({});
  const lastUserMessageRef = useRef(null);
  // Stream buffering — avoid dispatching per token (freezes UI).
  // Throttled to ~80ms (≈12 fps) which is plenty for reading and leaves the
  // main thread free for clicks/scrolls/terminal input.
  const streamBufRef = useRef('');
  const flushTimerRef = useRef(null);
  const STREAM_FLUSH_MS = 80;

  const flushStream = useCallback(() => {
    flushTimerRef.current = null;
    const text = streamBufRef.current;
    if (!text) return;
    streamBufRef.current = '';
    dispatch({ type: 'AGENT_APPEND_STREAM', text });
  }, [dispatch]);

  const queueStreamAppend = useCallback((text) => {
    streamBufRef.current += text;
    if (flushTimerRef.current == null) {
      flushTimerRef.current = setTimeout(flushStream, STREAM_FLUSH_MS);
    }
  }, [flushStream]);

  const approveToolCall = useCallback((id) => {
    approvalRef.current[id]?.resolve(true);
    delete approvalRef.current[id];
  }, []);

  const rejectToolCall = useCallback((id) => {
    approvalRef.current[id]?.resolve(false);
    delete approvalRef.current[id];
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    if (streamBufRef.current) {
      const text = streamBufRef.current;
      streamBufRef.current = '';
      dispatch({ type: 'AGENT_APPEND_STREAM', text });
    }
    dispatch({ type: 'AGENT_SET_LOADING', value: false });
  }, [dispatch]);

  function waitForApproval(id) {
    return new Promise((resolve) => {
      approvalRef.current[id] = { resolve };
    });
  }

  // Execute a single tool call (provider-agnostic)
  async function executeTool(toolCall, config, projectPath) {
    const isDestructive = !NON_DESTRUCTIVE_TOOLS.has(toolCall.name);

    if (isDestructive && !config.autoApprove) {
      if (toolCall.name === 'write_file' && toolCall.input?.path) {
        try {
          const r = await window.lorica.fs.readFile(toolCall.input.path);
          if (r.success) {
            dispatch({
              type: 'AGENT_UPDATE_TOOL_CALL',
              id: toolCall.id,
              updates: { oldContent: r.data.content },
            });
          }
        } catch (_) {}
      }

      const approved = await waitForApproval(toolCall.id);
      if (!approved) {
        dispatch({ type: 'AGENT_UPDATE_TOOL_CALL', id: toolCall.id, updates: { status: 'rejected' } });
        return 'Action rejected by user.';
      }
    }

    dispatch({ type: 'AGENT_UPDATE_TOOL_CALL', id: toolCall.id, updates: { status: 'running' } });

    try {
      let result = '';

      switch (toolCall.name) {
        case 'read_file': {
          const r = await window.lorica.fs.readFile(toolCall.input.path);
          result = r.success ? r.data.content : `Error: ${r.error}`;
          break;
        }
        case 'write_file': {
          const r = await window.lorica.fs.writeFile(toolCall.input.path, toolCall.input.content);
          if (r.success) {
            result = 'File written successfully.';
            const name = toolCall.input.path.split(/[\\/]/).pop();
            const ext = name.includes('.') ? name.split('.').pop() : '';
            dispatch({
              type: 'OPEN_FILE',
              file: { path: toolCall.input.path, name, content: toolCall.input.content, extension: ext, dirty: false },
            });
          } else {
            result = `Error: ${r.error}`;
          }
          break;
        }
        case 'list_dir': {
          const r = await window.lorica.fs.readDir(toolCall.input.path);
          if (r.success) {
            result = r.data.map((e) => `${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
          } else {
            result = `Error: ${r.error}`;
          }
          break;
        }
        case 'create_file': {
          const r = await window.lorica.fs.createFile(toolCall.input.path);
          result = r.success ? 'File created.' : `Error: ${r.error}`;
          break;
        }
        case 'delete_file': {
          const r = await window.lorica.fs.deletePath(toolCall.input.path);
          result = r.success ? 'Deleted.' : `Error: ${r.error}`;
          break;
        }
        case 'run_command': {
          const cwd = toolCall.input.cwd || projectPath;
          const r = await window.lorica.terminal.runCommand(toolCall.input.command, cwd);
          if (r.success) {
            const d = r.data;
            result = `exit ${d.exit_code}\n${d.stdout}${d.stderr ? '\nSTDERR:\n' + d.stderr : ''}`.trim();
          } else {
            result = `Error: ${r.error}`;
          }
          break;
        }
        case 'search_files': {
          const r = await window.lorica.search.searchInFiles(
            projectPath,
            toolCall.input.query,
            toolCall.input.case_sensitive ?? false,
            50
          );
          if (r.success) {
            const matches = r.data.matches.slice(0, 20);
            result = matches.length === 0
              ? 'No matches found.'
              : matches.map((m) => `${m.preview}:${m.line} — ${m.text}`).join('\n');
          } else {
            result = `Error: ${r.error}`;
          }
          break;
        }
        case 'fetch_url': {
          try {
            const resp = await robustFetch(toolCall.input.url, {}, true);
            const text = await resp.text();
            result = text.length > 8000 ? text.slice(0, 8000) + '\n[truncated]' : text;
          } catch (e) {
            result = `Fetch error: ${e.message}`;
          }
          break;
        }
        default:
          result = `Unknown tool: ${toolCall.name}`;
      }

      dispatch({ type: 'AGENT_UPDATE_TOOL_CALL', id: toolCall.id, updates: { status: 'done', result } });
      return result;
    } catch (e) {
      const errMsg = `Error: ${e.message}`;
      dispatch({ type: 'AGENT_UPDATE_TOOL_CALL', id: toolCall.id, updates: { status: 'error', result: errMsg } });
      return errMsg;
    }
  }

  async function buildInitialContext(config, activeFile, projectPath) {
    if (config.context === 'none' || !projectPath) return null;

    if (config.context === 'active' && activeFile) {
      return `Current open file: ${activeFile.name}\n\`\`\`${activeFile.extension}\n${activeFile.content}\n\`\`\``;
    }

    if (config.context === 'tree' || config.context === 'tree_keys') {
      const r = await window.lorica.fs.readDir(projectPath);
      if (!r.success) return null;
      const flatten = (entries, indent = '') =>
        entries.map((e) =>
          `${indent}${e.isDirectory ? '[D]' : '[F]'} ${e.name}${e.children ? '\n' + flatten(e.children, indent + '  ') : ''}`
        ).join('\n');
      let ctx = `Project structure (${projectPath}):\n${flatten(r.data)}`;

      if (config.context === 'tree_keys') {
        for (const keyFile of ['package.json', 'README.md', 'Cargo.toml']) {
          const candidate = `${projectPath}/${keyFile}`;
          const fr = await window.lorica.fs.readFile(candidate);
          if (fr.success) {
            ctx += `\n\n--- ${keyFile} ---\n${fr.data.content.slice(0, 3000)}`;
          }
        }
      }
      return ctx;
    }
    return null;
  }

  // --- Anthropic SSE parser ---
  async function parseAnthropicStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let textContent = '';
    const toolUses = [];
    let stopReason = null;
    let activeToolIdx = -1;
    let usage = null;

    dispatch({ type: 'AGENT_ADD_MESSAGE', message: { role: 'assistant', content: '', toolCalls: [] } });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(raw); } catch { continue; }

        if (ev.type === 'content_block_start') {
          if (ev.content_block.type === 'tool_use') {
            const toolCall = {
              id: ev.content_block.id,
              name: ev.content_block.name,
              inputAccum: '',
              input: null,
              status: 'pending',
            };
            toolUses.push(toolCall);
            activeToolIdx = toolUses.length - 1;
            dispatch({
              type: 'AGENT_ADD_TOOL_CALL',
              toolCall: { id: toolCall.id, name: toolCall.name, input: {}, status: 'pending' },
            });
          } else if (ev.content_block.type === 'text') {
            activeToolIdx = -1;
          }
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta.type === 'text_delta') {
            textContent += ev.delta.text;
            queueStreamAppend(ev.delta.text);
          } else if (ev.delta.type === 'input_json_delta' && activeToolIdx >= 0) {
            toolUses[activeToolIdx].inputAccum += ev.delta.partial_json;
          }
        } else if (ev.type === 'content_block_stop') {
          if (activeToolIdx >= 0 && toolUses[activeToolIdx].input === null) {
            try {
              toolUses[activeToolIdx].input = JSON.parse(toolUses[activeToolIdx].inputAccum);
              dispatch({
                type: 'AGENT_UPDATE_TOOL_CALL',
                id: toolUses[activeToolIdx].id,
                updates: { input: toolUses[activeToolIdx].input },
              });
            } catch (_) {
              toolUses[activeToolIdx].input = {};
            }
          }
        } else if (ev.type === 'message_delta') {
          stopReason = ev.delta?.stop_reason || stopReason;
          if (ev.usage) usage = { ...(usage || {}), ...ev.usage };
        } else if (ev.type === 'message_start' && ev.message?.usage) {
          usage = { ...(usage || {}), ...ev.message.usage };
        }
      }
    }

    // Flush any pending buffered text before finishing the stream.
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    if (streamBufRef.current) flushStream();

    return { textContent, toolUses, stopReason, usage };
  }

  // --- OpenAI/DeepSeek SSE parser ---
  async function parseOpenAIStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let textContent = '';
    const toolUses = [];
    const toolByIndex = {};
    let finishReason = null;
    let usage = null;

    dispatch({ type: 'AGENT_ADD_MESSAGE', message: { role: 'assistant', content: '', toolCalls: [] } });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(raw); } catch { continue; }

        if (ev.usage) usage = ev.usage;

        const choice = ev.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta || {};

        if (delta.content) {
          textContent += delta.content;
          queueStreamAppend(delta.content);
        }

        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index ?? 0;
            let entry = toolByIndex[idx];
            if (!entry) {
              entry = {
                id: tcDelta.id || `call_${idx}_${Date.now()}`,
                name: tcDelta.function?.name || '',
                inputAccum: '',
                input: null,
                status: 'pending',
              };
              toolByIndex[idx] = entry;
              toolUses.push(entry);
              dispatch({
                type: 'AGENT_ADD_TOOL_CALL',
                toolCall: { id: entry.id, name: entry.name, input: {}, status: 'pending' },
              });
            }
            if (tcDelta.id && !entry.idEmitted) {
              entry.id = tcDelta.id;
              entry.idEmitted = true;
            }
            if (tcDelta.function?.name && !entry.name) {
              entry.name = tcDelta.function.name;
            }
            if (tcDelta.function?.arguments) {
              entry.inputAccum += tcDelta.function.arguments;
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
    }

    // Finalize tool input parsing
    for (const tu of toolUses) {
      try {
        tu.input = tu.inputAccum ? JSON.parse(tu.inputAccum) : {};
      } catch {
        tu.input = {};
      }
      dispatch({
        type: 'AGENT_UPDATE_TOOL_CALL',
        id: tu.id,
        updates: { input: tu.input, name: tu.name },
      });
    }

    // Flush any pending buffered text before finishing.
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    if (streamBufRef.current) flushStream();

    return {
      textContent,
      toolUses,
      stopReason: finishReason === 'tool_calls' ? 'tool_use' : finishReason,
      usage,
    };
  }

  // --- Non-streaming DeepSeek fallback (used when stream fails) ---
  async function callDeepSeekNonStreaming(apiMessages, tools, model, apiKey, signal) {
    const body = {
      model,
      max_tokens: 4096,
      stream: false,
      messages: apiMessages,
    };
    if (tools && tools.length > 0) body.tools = tools;

    // Try native fetch first (DeepSeek allows CORS)
    let response;
    try {
      response = await fetch(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (nativeErr) {
      // Fall back to Tauri
      response = await tauriFetch(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    }
    if (!response.ok) {
      let errMsg = `HTTP ${response.status} ${response.statusText}`;
      try {
        const err = await response.json();
        errMsg = err.error?.message || err.message || errMsg;
      } catch {}
      throw new Error(errMsg);
    }
    return response.json();
  }

  const runAgentLoop = useCallback(async (userMessage, activeFile) => {
    const provider = state.aiProvider || 'anthropic';
    const apiKey = provider === 'anthropic' ? state.aiApiKey : state.aiDeepseekKey;
    const providerLabel = provider === 'anthropic' ? 'Anthropic' : 'DeepSeek';

    if (!apiKey) {
      dispatch({
        type: 'AGENT_ADD_MESSAGE',
        message: { role: 'assistant', content: `⚠️ Configure ta clé API ${providerLabel} dans les Paramètres.` },
      });
      return;
    }

    lastUserMessageRef.current = { userMessage, activeFile };

    const config = state.agentConfig;
    const model = config?.model || DEFAULT_MODELS[provider];
    const projectPath = state.projectPath;
    const tools = buildToolsForPermissions(config.permissions);
    const activeFileInfo = activeFile
      ? `\nActive file: ${activeFile.path || activeFile.name} (language: ${activeFile.extension || 'plain'}).`
      : '';
    const systemPrompt = `You are Lorica Agent, an expert AI embedded in the Lorica IDE.
You have direct access to the user's codebase via tools. Be concise, precise, and always use tools to read files before modifying them.
- Project path: ${projectPath || 'unknown'}.${activeFileInfo}
- When making code changes, PREFER write_file over re-creating files. Always read_file first.
- When running commands, prefer non-interactive flags. Never run commands that keep running indefinitely (use background=false style).
- Format your answers with concise Markdown. Code blocks should include a language identifier.`;

    // Build message history in a neutral form
    const history = [];

    const ctxText = await buildInitialContext(config, activeFile, projectPath);
    if (ctxText) {
      history.push({ role: 'user', content: ctxText });
      history.push({ role: 'assistant', content: "Contexte reçu. Comment puis-je t'aider ?", toolCalls: [] });
    }

    for (const msg of state.agentMessages) {
      if (msg.role === 'user') {
        history.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        history.push({
          role: 'assistant',
          content: msg.content || '',
          toolCalls: (msg.toolCalls || []).map((tc) => ({ id: tc.id, name: tc.name, input: tc.input || {} })),
        });
      } else if (msg.role === 'tool_results') {
        history.push({ role: 'tool_results', results: msg.results });
      }
    }

    dispatch({ type: 'AGENT_ADD_MESSAGE', message: { role: 'user', content: userMessage } });
    history.push({ role: 'user', content: userMessage });

    dispatch({ type: 'AGENT_SET_LOADING', value: true });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      while (true) {
        let response;
        let parseStreamFn;
        let requestBody;
        let endpoint;
        let headers;
        let preferNativeFetch;

        if (provider === 'anthropic') {
          const apiMessages = [];
          for (const h of history) {
            if (h.role === 'user') {
              apiMessages.push({ role: 'user', content: h.content });
            } else if (h.role === 'assistant') {
              const content = [];
              if (h.content) content.push({ type: 'text', text: h.content });
              for (const tc of h.toolCalls || []) {
                content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input || {} });
              }
              if (content.length > 0) apiMessages.push({ role: 'assistant', content });
            } else if (h.role === 'tool_results') {
              apiMessages.push({ role: 'user', content: h.results });
            }
          }

          endpoint = ANTHROPIC_ENDPOINT;
          headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          };
          requestBody = {
            model,
            max_tokens: 8096,
            stream: true,
            tools: tools.length > 0 ? tools : undefined,
            system: systemPrompt,
            messages: apiMessages,
          };
          parseStreamFn = parseAnthropicStream;
          preferNativeFetch = false; // Anthropic often blocks direct browser — prefer Tauri HTTP
        } else {
          // DeepSeek / OpenAI-compatible format
          const apiMessages = [{ role: 'system', content: systemPrompt }];
          for (const h of history) {
            if (h.role === 'user') {
              apiMessages.push({ role: 'user', content: h.content });
            } else if (h.role === 'assistant') {
              const msg = { role: 'assistant', content: h.content || '' };
              if (h.toolCalls && h.toolCalls.length > 0) {
                msg.tool_calls = h.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: JSON.stringify(tc.input || {}) },
                }));
              }
              apiMessages.push(msg);
            } else if (h.role === 'tool_results') {
              for (const r of h.results) {
                apiMessages.push({
                  role: 'tool',
                  tool_call_id: r.tool_use_id,
                  content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
                });
              }
            }
          }

          endpoint = DEEPSEEK_ENDPOINT;
          headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          };
          requestBody = {
            model,
            max_tokens: 4096,
            stream: true,
            tools: tools.length > 0 ? toOpenAITools(tools) : undefined,
            messages: apiMessages,
          };
          parseStreamFn = parseOpenAIStream;
          preferNativeFetch = true; // DeepSeek supports CORS — native fetch is faster and more reliable
        }

        // ── Attempt streaming request ──
        let streamError = null;
        try {
          response = await robustFetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          }, preferNativeFetch);
        } catch (e) {
          streamError = e;
        }

        // ── Fallback: if stream failed or response is not ok/streamable, try non-streaming for DeepSeek ──
        if (provider === 'deepseek' && (streamError || !response || !response.ok)) {
          if (streamError) {
            console.warn('[agent] DeepSeek stream fetch failed, falling back to non-streaming:', streamError);
          } else if (!response.ok) {
            let errText = response.statusText;
            try {
              const e = await response.json();
              errText = e.error?.message || e.message || errText;
            } catch {}
            // Auth or validation errors — don't try non-streaming
            if (response.status === 401 || response.status === 403 || response.status === 400) {
              dispatch({
                type: 'AGENT_ADD_MESSAGE',
                message: { role: 'assistant', content: `❌ DeepSeek API Error (${response.status}): ${errText}` },
              });
              break;
            }
            console.warn('[agent] DeepSeek stream returned', response.status, '— trying non-streaming');
          }

          try {
            const apiMessages = requestBody.messages;
            const data = await callDeepSeekNonStreaming(
              apiMessages,
              requestBody.tools,
              model,
              apiKey,
              controller.signal,
            );
            const choice = data.choices?.[0];
            const msg = choice?.message || {};
            const textContent = msg.content || '';

            // Emit assistant message
            dispatch({ type: 'AGENT_ADD_MESSAGE', message: { role: 'assistant', content: '', toolCalls: [] } });
            if (textContent) dispatch({ type: 'AGENT_APPEND_STREAM', text: textContent });

            const toolUses = [];
            for (const tc of msg.tool_calls || []) {
              let input = {};
              try { input = JSON.parse(tc.function?.arguments || '{}'); } catch {}
              const entry = { id: tc.id, name: tc.function?.name, input, status: 'pending' };
              toolUses.push(entry);
              dispatch({ type: 'AGENT_ADD_TOOL_CALL', toolCall: entry });
            }

            history.push({
              role: 'assistant',
              content: textContent,
              toolCalls: toolUses.map((tu) => ({ id: tu.id, name: tu.name, input: tu.input })),
            });

            const stopReason = choice?.finish_reason === 'tool_calls' ? 'tool_use' : choice?.finish_reason;

            if (stopReason !== 'tool_use' || toolUses.length === 0) break;

            const toolResults = [];
            for (const tu of toolUses) {
              const result = await executeTool(tu, config, projectPath);
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) });
            }
            dispatch({
              type: 'AGENT_ADD_MESSAGE',
              message: { role: 'tool_results', results: toolResults, content: '' },
            });
            history.push({ role: 'tool_results', results: toolResults });
            continue; // loop
          } catch (fallbackErr) {
            dispatch({
              type: 'AGENT_ADD_MESSAGE',
              message: {
                role: 'assistant',
                content: `❌ DeepSeek network error: ${fallbackErr.message}\n\n**Diagnostics**:\n- Endpoint: ${DEEPSEEK_ENDPOINT}\n- Vérifie que ta clé API commence par \`sk-\`\n- Vérifie ta connexion internet\n- La clé peut avoir expiré ou ne plus avoir de crédits`,
              },
            });
            break;
          }
        }

        if (streamError) {
          dispatch({
            type: 'AGENT_ADD_MESSAGE',
            message: {
              role: 'assistant',
              content: `❌ Network error: ${streamError.message}\n\nVérifie ta clé API, ta connexion, ou les permissions HTTP de Tauri.`,
            },
          });
          break;
        }

        if (!response.ok) {
          let errMsg = response.statusText;
          try {
            const err = await response.json();
            errMsg = err.error?.message || err.message || errMsg;
          } catch {}
          dispatch({
            type: 'AGENT_ADD_MESSAGE',
            message: { role: 'assistant', content: `❌ ${providerLabel} API Error (${response.status}): ${errMsg}` },
          });
          break;
        }

        const { textContent, toolUses, stopReason, usage } = await parseStreamFn(response);

        history.push({
          role: 'assistant',
          content: textContent,
          toolCalls: toolUses.map((tu) => ({ id: tu.id, name: tu.name, input: tu.input || {} })),
        });

        if (usage) {
          dispatch({ type: 'AGENT_UPDATE_USAGE', usage });
        }

        if (stopReason !== 'tool_use' || toolUses.length === 0) break;

        const toolResults = [];
        for (const tu of toolUses) {
          const result = await executeTool(tu, config, projectPath);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) });
        }

        dispatch({
          type: 'AGENT_ADD_MESSAGE',
          message: { role: 'tool_results', results: toolResults, content: '' },
        });

        history.push({ role: 'tool_results', results: toolResults });
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        dispatch({
          type: 'AGENT_ADD_MESSAGE',
          message: { role: 'assistant', content: `❌ Erreur: ${e.message}` },
        });
      }
    } finally {
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      if (streamBufRef.current) {
        const text = streamBufRef.current;
        streamBufRef.current = '';
        dispatch({ type: 'AGENT_APPEND_STREAM', text });
      }
      dispatch({ type: 'AGENT_SET_LOADING', value: false });
    }
  }, [state.aiApiKey, state.aiDeepseekKey, state.aiProvider, state.agentConfig, state.agentMessages, state.projectPath, dispatch]);

  const sendMessage = runAgentLoop;

  const retryLastMessage = useCallback(async () => {
    const last = lastUserMessageRef.current;
    if (!last) return;
    // Remove the last assistant turn(s) after the last user message from state so the retry replaces them
    const msgs = [...state.agentMessages];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        // Keep up to (but not including) this user message
        const trimmed = msgs.slice(0, i);
        dispatch({ type: 'AGENT_SET_MESSAGES', messages: trimmed });
        break;
      }
    }
    await runAgentLoop(last.userMessage, last.activeFile);
  }, [state.agentMessages, dispatch, runAgentLoop]);

  return { sendMessage, approveToolCall, rejectToolCall, stop, retryLastMessage };
}
