import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A second, finer-grained safety net underneath the app-wide ErrorBoundary
 * (see components/ErrorBoundary.tsx). That top-level one is the last resort
 * — it catches anything, but its fallback replaces the *entire* app,
 * including the nav bar and bottom tab bar, so a bug in, say, the report
 * chart would strand someone with no way to navigate anywhere except a full
 * reload.
 *
 * This one wraps just the current tab's content in App.tsx, keyed by which
 * screen is active. If a screen crashes, only its content area shows a
 * small recoverable card — the top nav and bottom tab bar (rendered as
 * siblings outside this boundary) stay fully interactive, so switching to
 * any other tab keeps working normally. Switching tabs also naturally
 * remounts this boundary (new `key`), so the error clears itself the moment
 * you navigate away — no stale error screen waiting if you come back later.
 */
export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled screen error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen-narrow screen-transition">
          <div className="card elev-sm anim-rise screen-error-card">
            <div className="card-title">This screen hit a snag</div>
            <p className="card-body" style={{ margin: 0 }}>
              Nothing was lost — your data's saved on the server. Try again, or switch to another tab below.
            </p>
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
