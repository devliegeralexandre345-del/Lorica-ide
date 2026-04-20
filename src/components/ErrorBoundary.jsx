// src/components/ErrorBoundary.jsx
//
// A defensive wrapper that catches React rendering errors thrown by any
// descendant and shows a friendly fallback instead of crashing the whole
// IDE. Each lazy panel (Swarm, Canvas, Omnibar, …) is wrapped individually
// so a bug in one surface can never take down the app.
//
// Why a class component: `componentDidCatch` + `getDerivedStateFromError`
// are still the only React APIs that catch render errors. Hooks can't do
// this today.

import React from 'react';
import { AlertTriangle, RefreshCw, Bug, X } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error(`[Lorica:${this.props.name || 'unknown'}]`, error, info);
    this.setState({ info });
  }

  reset = () => {
    this.setState((s) => ({ error: null, info: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      // Fallback: an inline panel-sized card. Callers control the chrome
      // (modal / sidebar / inline) via the `compact` prop.
      const { name = 'Panel', compact, onDismiss } = this.props;
      return (
        <div className={`flex flex-col ${compact ? 'p-3' : 'p-6'} items-center justify-center text-center`}>
          <AlertTriangle size={compact ? 18 : 28} className="text-amber-400 mb-2" />
          <div className="text-xs font-semibold text-lorica-text">{name} crashed</div>
          <div className="text-[10px] text-lorica-textDim mt-1 max-w-xs">
            The rest of Lorica is unaffected. Retrying usually fixes it; the error has been logged to the console.
          </div>
          {this.state.error?.message && (
            <pre className="mt-2 text-[10px] font-mono text-red-400 whitespace-pre-wrap max-w-xs text-left">
              {String(this.state.error.message).slice(0, 300)}
            </pre>
          )}
          <div className="flex gap-2 mt-3">
            <button onClick={this.reset} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-lorica-accent/15 border border-lorica-accent/40 text-lorica-accent hover:bg-lorica-accent/25">
              <RefreshCw size={10} /> Retry
            </button>
            {onDismiss && (
              <button onClick={onDismiss} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-lorica-border text-lorica-textDim hover:text-lorica-text">
                <X size={10} /> Dismiss
              </button>
            )}
          </div>
        </div>
      );
    }
    // Key trick: remounting the subtree with a fresh key clears any bad
    // state that the caller held onto.
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
