// src/components/MarkdownMessage.jsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
// PrismLight lets us register only the languages we actually need. The
// default `Prism` import pulls in refractor + ~270 language grammars —
// that's ~500 KB minified for features no one uses in an agent chat.
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check } from 'lucide-react';

// --- Language grammars (only the ones an IDE agent chat actually renders)
import js        from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx       from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import ts        from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import tsx       from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import py        from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust      from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import go        from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import bash      from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json      from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import css       from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import scss      from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import markup    from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import sql       from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import yaml      from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import toml      from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import markdown  from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import diff      from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import c         from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp       from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import java      from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import ruby      from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import php       from 'react-syntax-highlighter/dist/esm/languages/prism/php';

// Register once at module load — cheap.
SyntaxHighlighter.registerLanguage('javascript', js);
SyntaxHighlighter.registerLanguage('js', js);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('typescript', ts);
SyntaxHighlighter.registerLanguage('ts', ts);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('python', py);
SyntaxHighlighter.registerLanguage('py', py);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('rs', rust);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('scss', scss);
SyntaxHighlighter.registerLanguage('html', markup);
SyntaxHighlighter.registerLanguage('xml', markup);
SyntaxHighlighter.registerLanguage('markup', markup);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('toml', toml);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('diff', diff);
SyntaxHighlighter.registerLanguage('c', c);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('c++', cpp);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('ruby', ruby);
SyntaxHighlighter.registerLanguage('rb', ruby);
SyntaxHighlighter.registerLanguage('php', php);

/**
 * Try to infer an absolute target file path from the top of a code block.
 * Looks for a common "// src/App.jsx" style comment on the first non-empty
 * line. Returns `null` if nothing recognisable is found — the caller then
 * lets the user pick the target manually.
 */
function detectCodeTarget(code, projectPath) {
  if (!code) return null;
  const firstLine = code.split('\n').find((l) => l.trim().length > 0) || '';
  const patterns = [
    /^\s*\/\/\s*(?:path:\s*|file:\s*)?([^\s*]+\.[a-zA-Z0-9]+)\s*$/,
    /^\s*#\s*(?:path:\s*|file:\s*)?([^\s]+\.[a-zA-Z0-9]+)\s*$/,
    /^\s*\/\*\s*(?:path:\s*|file:\s*)?([^\s*]+\.[a-zA-Z0-9]+)\s*\*\/\s*$/,
    /^\s*<!--\s*(?:path:\s*|file:\s*)?([^\s]+\.[a-zA-Z0-9]+)\s*-->\s*$/,
  ];
  for (const re of patterns) {
    const m = re.exec(firstLine);
    if (m) {
      const hint = m[1];
      // Absolute path?  (drive-letter on Windows OR leading slash on Unix)
      if (/^(?:[a-zA-Z]:[\\/]|\/)/.test(hint)) return hint;
      if (!projectPath) return hint;
      const sep = projectPath.includes('\\') ? '\\' : '/';
      return `${projectPath.replace(/[\\/]$/, '')}${sep}${hint.replace(/\//g, sep)}`;
    }
  }
  return null;
}

function MarkdownMessageInner({ content, isStreaming, onApply, projectPath }) {
  // While streaming, render the raw text as plain pre-wrap — NO Markdown
  // parsing, NO ReactMarkdown, NO Prism. This is the only way to keep the UI
  // responsive while the model emits tokens. The full Markdown pass happens
  // exactly once when streaming ends.
  if (isStreaming) {
    return (
      <div className="text-xs text-lorica-text leading-relaxed whitespace-pre-wrap break-words">
        {content}
        <span className="inline-block w-1.5 h-3 bg-lorica-accent animate-pulse ml-0.5 align-middle" />
      </div>
    );
  }

  return (
    <div className="text-xs text-lorica-text leading-relaxed markdown-agent">
      <ReactMarkdown
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            if (!inline && match) {
              const codeText = String(children).replace(/\n$/, '');
              const hint = detectCodeTarget(codeText, projectPath);
              return (
                <div className="relative my-2 group/codeblock">
                  {onApply && (
                    <button
                      type="button"
                      onClick={() => onApply(codeText, hint)}
                      title={hint ? `Apply to ${hint}` : 'Apply to a file…'}
                      className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold bg-lorica-panel/90 border border-lorica-border text-lorica-accent backdrop-blur-sm hover:bg-lorica-accent/20 hover:border-lorica-accent/50 transition-colors opacity-60 group-hover/codeblock:opacity-100"
                    >
                      <Check size={9} /> Apply
                    </button>
                  )}
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: '0.375rem',
                      fontSize: '11px',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                    }}
                    {...props}
                  >
                    {codeText}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return (
              <code
                className="px-1 py-0.5 rounded text-[11px] bg-lorica-bg border border-lorica-border text-lorica-accent font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>;
          },
          li({ children }) {
            return <li className="text-lorica-text">{children}</li>;
          },
          h1({ children }) {
            return <h1 className="text-sm font-bold text-lorica-text mb-1 mt-2">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-xs font-semibold text-lorica-text mb-1 mt-2">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-xs font-semibold text-lorica-textDim mb-1 mt-1">{children}</h3>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-lorica-accent/40 pl-2 text-lorica-textDim italic my-1">
                {children}
              </blockquote>
            );
          },
          strong({ children }) {
            return <strong className="font-semibold text-lorica-text">{children}</strong>;
          },
          a({ href, children }) {
            return (
              <span className="text-lorica-accent underline cursor-pointer" title={href}>
                {children}
              </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Memoized — only re-renders when content/streaming/project changes. onApply
// is assumed referentially stable (wrap in useCallback at the parent).
// Completed past messages never re-render on every token of the active one.
const MarkdownMessage = React.memo(
  MarkdownMessageInner,
  (prev, next) =>
    prev.content === next.content &&
    prev.isStreaming === next.isStreaming &&
    prev.projectPath === next.projectPath &&
    prev.onApply === next.onApply,
);

export default MarkdownMessage;
