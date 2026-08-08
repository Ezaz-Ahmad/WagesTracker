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
        // `.app-shell` fades in via the `.is-entered` class App.tsx adds a
        // couple of frames after mount (see app.css) — this static fallback
        // never goes through that flow, so without `is-entered` here too it
        // would sit at the class's base `opacity: 0` forever, making the one
        // screen meant to catch a fatal error itself invisible.
        <div className="app-shell is-entered">
          <div className="app-frame" style={{ padding: "var(--space-4)" }}>
            <h1 className="section-title">Something went wrong</h1>
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
