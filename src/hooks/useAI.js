import { useCallback } from 'react';
import { hasAIConsentOrPrompt } from '../utils/aiConsent';

// Language context limits (character counts)
const LANG_CONTEXT_LIMITS = {
  // Langages verbeux → limite haute
  java:       12000,
  csharp:     12000,
  cpp:        12000,
  c:          12000,
  // Langages courants
  typescript: 10000,
  javascript: 10000,
  tsx:        10000,
  jsx:        10000,
  python:     10000,
  rust:       10000,
  go:         10000,
  // Langages légers / config
  json:        6000,
  yaml:        6000,
  toml:        6000,
  xml:         6000,
  html:        8000,
  css:         6000,
  scss:        6000,
  sql:         8000,
  // Markdown / texte
  markdown:    5000,
  md:          5000,
  txt:         4000,
  // Fallback
  default:     8000,
};

function truncateCodeByLanguage(code, language) {
  const langKey = language.toLowerCase();
  const limit = LANG_CONTEXT_LIMITS[langKey] || LANG_CONTEXT_LIMITS.default;
  
  if (code.length <= limit) {
    return code;
  }
  
  // Keep first 60% and last 40%
  const firstPartLength = Math.floor(limit * 0.6);
  const lastPartLength = limit - firstPartLength;
  
  const firstPart = code.substring(0, firstPartLength);
  const lastPart = code.substring(code.length - lastPartLength);
  
  // Count lines skipped in the removed middle part
  const middlePart = code.substring(firstPartLength, code.length - lastPartLength);
  const linesSkipped = (middlePart.match(/\n/g) || []).length;
  
  return `${firstPart}\n// ... [${linesSkipped} lines truncated] ...\n${lastPart}`;
}

export function useAI(state, dispatch) {
  const sendMessage = useCallback(async (userMessage, codeContext = null) => {
    // Validate API key based on provider
    if (state.aiProvider === 'anthropic' && !state.aiApiKey) {
      dispatch({
        type: 'ADD_AI_MESSAGE',
        message: { role: 'assistant', content: '⚠️ Please set your Anthropic API key in Settings first.' },
      });
      return;
    }
    if (state.aiProvider === 'deepseek' && !state.aiDeepseekKey) {
      dispatch({
        type: 'ADD_AI_MESSAGE',
        message: { role: 'assistant', content: '⚠️ Configure your DeepSeek API key in Settings first. Get it at platform.deepseek.com' },
      });
      return;
    }

    // RGPD gate: no data leaves the machine until the user has seen the
    // consent modal at least once. Opens the modal as a side effect if
    // not yet accepted — user re-runs the action after agreeing.
    if (!hasAIConsentOrPrompt(state, dispatch)) {
      dispatch({
        type: 'ADD_AI_MESSAGE',
        message: { role: 'assistant', content: '⏸️ Approbation nécessaire avant le premier envoi à l\'IA. Voir la fenêtre de consentement.' },
      });
      return;
    }

    dispatch({ type: 'ADD_AI_MESSAGE', message: { role: 'user', content: userMessage } });
    dispatch({ type: 'SET_AI_LOADING', value: true });

    try {
      const systemPrompt = `You are Lorica AI Copilot, an expert programming assistant embedded in a code editor. 
Be concise, direct, and helpful. Format code with markdown code blocks. 
If code context is provided, reference it specifically in your answers.`;

      const messages = [];
      
      // Add recent conversation history (last 10 messages)
      const recentMessages = state.aiMessages.slice(-10);
      for (const msg of recentMessages) {
        messages.push({ role: msg.role, content: msg.content });
      }

      // Build current message with optional code context
      let content = userMessage;
      if (codeContext) {
        // Apply language-specific truncation
        const truncatedCode = truncateCodeByLanguage(codeContext.code, codeContext.language);
        content = `Current file: ${codeContext.fileName} (${codeContext.language})\n\n\`\`\`${codeContext.language}\n${truncatedCode}\n\`\`\`\n\n${userMessage}`;
      }
      messages.push({ role: 'user', content });

      let response;
      let data;
      
      if (state.aiProvider === 'anthropic') {
        // Anthropic API call
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': state.aiApiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: systemPrompt,
            messages,
          }),
        });
        data = await response.json();

        if (data.content && data.content[0]) {
          dispatch({
            type: 'ADD_AI_MESSAGE',
            message: { role: 'assistant', content: data.content[0].text },
          });
        } else if (data.error) {
          dispatch({
            type: 'ADD_AI_MESSAGE',
            message: { role: 'assistant', content: `❌ Error: ${data.error.message}` },
          });
        }
      } else if (state.aiProvider === 'deepseek') {
        // DeepSeek API (OpenAI compatible)
        // Convert messages format: Anthropic uses system in body, DeepSeek expects system as a message
        const deepseekMessages = [
          { role: 'system', content: systemPrompt },
          ...messages
        ];
        
        response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.aiDeepseekKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            max_tokens: 4096,
            messages: deepseekMessages,
          }),
        });
        data = await response.json();

        if (data.choices && data.choices[0]) {
          dispatch({
            type: 'ADD_AI_MESSAGE',
            message: { role: 'assistant', content: data.choices[0].message.content },
          });
        } else if (data.error) {
          dispatch({
            type: 'ADD_AI_MESSAGE',
            message: { role: 'assistant', content: `❌ Error: ${data.error.message}` },
          });
        }
      }
    } catch (err) {
      dispatch({
        type: 'ADD_AI_MESSAGE',
        message: { role: 'assistant', content: `❌ Connection error: ${err.message}` },
      });
    } finally {
      dispatch({ type: 'SET_AI_LOADING', value: false });
    }
  }, [state.aiApiKey, state.aiDeepseekKey, state.aiProvider, state.aiMessages, dispatch]);

  const quickAction = useCallback(async (action, code, fileName, language) => {
    const prompts = {
      explain: 'Explain this code clearly and concisely:',
      refactor: 'Refactor this code for better readability and performance. Show the improved version:',
      fix: 'Find and fix any bugs in this code. Explain what was wrong:',
      document: 'Add clear documentation comments to this code:',
      optimize: 'Optimize this code for performance:',
      test: 'Write unit tests for this code:',
    };

    const prompt = prompts[action] || `${action} this code:`;
    await sendMessage(prompt, { code, fileName, language });
  }, [sendMessage]);

  return { sendMessage, quickAction };
}

