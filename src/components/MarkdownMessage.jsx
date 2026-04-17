// src/components/MarkdownMessage.jsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

function MarkdownMessageInner({ content, isStreaming }) {
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
              return (
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: '0.5rem 0',
                    borderRadius: '0.375rem',
                    fontSize: '11px',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                  }}
                  {...props}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
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

// Memoized — only re-renders when content or streaming flag actually changes.
// Completed past messages never re-render on every token of the active one.
const MarkdownMessage = React.memo(
  MarkdownMessageInner,
  (prev, next) => prev.content === next.content && prev.isStreaming === next.isStreaming,
);

export default MarkdownMessage;
