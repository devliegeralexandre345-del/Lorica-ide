// src/hooks/useAgent.js
import { useCallback, useRef } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { buildToolsForPermissions, NON_DESTRUCTIVE_TOOLS } from '../utils/agentTools';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

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

export function useAgent(state, dispatch) {
  const abortRef = useRef(null);
  const approvalRef = useRef({});

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
            const resp = await tauriFetch(toolCall.input.url);
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
            dispatch({ type: 'AGENT_APPEND_STREAM', text: ev.delta.text });
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
        }
      }
    }

    return { textContent, toolUses, stopReason };
  }

  // --- OpenAI/DeepSeek SSE parser ---
  async function parseOpenAIStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let textContent = '';
    const toolUses = []; // keyed by index
    const toolByIndex = {}; // index -> toolUses entry
    let finishReason = null;

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

        const choice = ev.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta || {};

        if (delta.content) {
          textContent += delta.content;
          dispatch({ type: 'AGENT_APPEND_STREAM', text: delta.content });
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

    return {
      textContent,
      toolUses,
      stopReason: finishReason === 'tool_calls' ? 'tool_use' : finishReason,
    };
  }

  const sendMessage = useCallback(async (userMessage, activeFile) => {
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

    const config = state.agentConfig;
    const projectPath = state.projectPath;
    const tools = buildToolsForPermissions(config.permissions);
    const systemPrompt = `You are Lorica Agent, an expert AI embedded in the Lorica IDE. You have direct access to the user's codebase via tools. Be concise, precise, and always use tools to read files before modifying them. Project path: ${projectPath || 'unknown'}.`;

    // Build message history in a neutral form, then convert per-provider at fetch time
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

        if (provider === 'anthropic') {
          // Anthropic format
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

          response = await tauriFetch(ANTHROPIC_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 8096,
              stream: true,
              tools: tools.length > 0 ? tools : undefined,
              system: systemPrompt,
              messages: apiMessages,
            }),
            signal: controller.signal,
          });
          parseStreamFn = parseAnthropicStream;
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

          response = await tauriFetch(DEEPSEEK_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'deepseek-chat',
              max_tokens: 4096,
              stream: true,
              tools: tools.length > 0 ? toOpenAITools(tools) : undefined,
              messages: apiMessages,
            }),
            signal: controller.signal,
          });
          parseStreamFn = parseOpenAIStream;
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

        const { textContent, toolUses, stopReason } = await parseStreamFn(response);

        history.push({
          role: 'assistant',
          content: textContent,
          toolCalls: toolUses.map((tu) => ({ id: tu.id, name: tu.name, input: tu.input || {} })),
        });

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
        const hint = e.message === 'Failed to fetch'
          ? ' (vérifie ta connexion, la clé API, ou que l\'URL n\'est pas bloquée par CORS)'
          : '';
        dispatch({
          type: 'AGENT_ADD_MESSAGE',
          message: { role: 'assistant', content: `❌ Erreur: ${e.message}${hint}` },
        });
      }
    } finally {
      dispatch({ type: 'AGENT_SET_LOADING', value: false });
    }
  }, [state.aiApiKey, state.aiDeepseekKey, state.aiProvider, state.agentConfig, state.agentMessages, state.projectPath, dispatch]);

  return { sendMessage, approveToolCall, rejectToolCall, stop };
}
