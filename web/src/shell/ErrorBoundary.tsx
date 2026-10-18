import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, EmptyState } from '../ui';

interface Props { children: ReactNode; /** Changing this value (e.g. the pathname) clears a caught error. */ resetKey?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route crashed:', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertTriangle size={20} className="text-bad" />}
          title="This screen crashed"
          description={<span className="font-mono text-xs">{this.state.error.message || 'Unknown error'}</span>}
          actions={<Button icon={<RefreshCw size={14} />} onClick={() => window.location.reload()}>Reload</Button>}
        />
      </div>
    );
  }
}
