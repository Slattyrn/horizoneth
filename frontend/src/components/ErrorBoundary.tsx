import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  componentName?: string;
  /** Auto-reload the whole page on error (used at root). Component-level boundaries
   *  self-retry instead so a localized crash doesn't nuke chart state. */
  reloadOnError?: boolean;
  /** Seconds before auto-retry. 0 disables auto-retry (manual button only). */
  autoRetrySeconds?: number;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
  retryIn?: number;
}

/**
 * Error Boundary to prevent component crashes from blanking the entire UI.
 * Wraps automation components to display safe fallback UI on error. Auto-retries
 * after a delay so unattended sessions self-heal instead of freezing on the
 * error card.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimer: number | null = null;
  private countdownTimer: number | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  // FIXED: Return type was full ErrorBoundaryState but only returns partial fields
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log the error to console for debugging
    console.error(`❌ ${this.props.componentName || 'Component'} crashed:`, error, errorInfo);
    this.setState({ error, errorInfo });

    const delay = this.props.autoRetrySeconds ?? 5;
    if (delay > 0) {
      this.setState({ retryIn: delay });
      this.countdownTimer = window.setInterval(() => {
        this.setState(prev => ({ retryIn: Math.max(0, (prev.retryIn ?? delay) - 1) }));
      }, 1000);
      this.retryTimer = window.setTimeout(() => this.doRetry(), delay * 1000);
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    if (this.countdownTimer) window.clearInterval(this.countdownTimer);
  }

  private doRetry = () => {
    if (this.retryTimer) { window.clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.countdownTimer) { window.clearInterval(this.countdownTimer); this.countdownTimer = null; }
    this.setState({ hasError: false, error: undefined, errorInfo: undefined, retryIn: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-red-800 bg-red-950/30 p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <h3 className="text-lg font-bold text-red-400">
              {this.props.componentName || 'Component'} Error
            </h3>
          </div>
          <div className="bg-red-950/50 border border-red-800/50 rounded-lg p-4">
            <p className="text-sm text-red-300 mb-3">
              ⚠️ This component encountered an error and has been safely isolated to prevent UI blanking.
            </p>
            <p className="text-xs text-red-400 font-mono mb-2">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <details className="text-xs text-gray-400">
              <summary className="cursor-pointer hover:text-gray-300">Stack trace</summary>
              <pre className="mt-2 overflow-x-auto">
                {this.state.error?.stack || 'No stack trace available'}
              </pre>
            </details>
          </div>
          <button
            onClick={this.doRetry}
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {this.state.retryIn && this.state.retryIn > 0 ? `Retry now (auto in ${this.state.retryIn}s)` : 'Retry'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
