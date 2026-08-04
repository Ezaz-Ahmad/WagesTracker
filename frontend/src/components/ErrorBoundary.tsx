import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere below it so a bug in one screen shows a
 * recoverable message instead of a blank white page for the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-shell">
          <div className="app-frame" style={{ padding: "var(--space-4)" }}>
            <h6 className="section-title">Something went wrong</h6>
            <p className="card-body">
              The app hit an unexpected error. Try reloading — if it keeps happening, your data is safe on the server.
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
