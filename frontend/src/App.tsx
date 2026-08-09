import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { BottomNav, TABS } from "./components/BottomNav";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { Logo } from "./components/Logo";
import { EyeIcon, EyeOffIcon, LogoutIcon, RefreshIcon } from "./components/icons";
import { AuthScreen } from "./screens/AuthScreen";
import { WakingUpScreen } from "./components/WakingUpScreen";
import { ScreenErrorBoundary } from "./components/ScreenErrorBoundary";
import { useDelayedFlag } from "./lib/useDelayedFlag";
import { HomeScreen } from "./screens/HomeScreen";
import { EntryScreen } from "./screens/EntryScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { useSwipeNav } from "./lib/useSwipeNav";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { useViewportHeight } from "./lib/useViewportHeight";
import { reloadIfNewVersionDeployed } from "./lib/checkForUpdate";
import type { Screen } from "./lib/types";

function AuthedApp() {
  const { today, user, actionError, clearActionError, logout, refresh, earningsHidden, revealEarnings, hideEarningsNow } = useApp();
  const [screen, setScreen] = useState<Screen>("home");

  const todayLabel = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const activeIndex = Math.max(0, TABS.findIndex((t) => t.screen === screen));
  const handleSwipeNavigate = useCallback((index: number) => setScreen(TABS[index].screen), []);
  const { ref: swipeRef, dragX, dragging } = useSwipeNav<HTMLDivElement>(activeIndex, TABS.length, handleSwipeNavigate);

  // Pull-to-refresh — Home only, per the ask. Bound to the same scrollable
  // pane as the swipe-tab gesture; the two never conflict because a single
  // touch gesture locks to one axis or the other (see usePullToRefresh),
  // never both. Refreshes data every pull; also silently reloads the page
  // if a newer build has been deployed since this tab was opened, so a pull
  // gets you both the latest numbers *and* the latest app, not just one.
  const handlePullRefresh = useCallback(async () => {
    await refresh();
    await reloadIfNewVersionDeployed();
  }, [refresh]);
  const { pullY, pulling, refreshing } = usePullToRefresh(swipeRef, screen === "home", handlePullRefresh);

  // Which way the tab just changed (bottom-nav tap or a completed swipe both
  // land here) — drives a directional slide on mount instead of a plain
  // fade, so tapping a tab feels like the same physical motion as swiping to
  // it, not two different transitions depending on how you got there.
  const prevIndexRef = useRef(activeIndex);
  const direction = activeIndex === prevIndexRef.current ? 0 : activeIndex > prevIndexRef.current ? 1 : -1;
  useEffect(() => {
    prevIndexRef.current = activeIndex;
  }, [activeIndex]);
  const screenTransitionClass = `screen-transition${direction === 1 ? " dir-fwd" : direction === -1 ? " dir-back" : ""}`;

  // Purely cosmetic: the shell fades in rather than snapping in. This used
  // to double as the (unsuccessful) fix for the post-login bottom-nav gap —
  // the theory being that an opacity animation forces a fresh composite
  // every frame, so the shell would end up painted against settled layout.
  // It doesn't work, because re-compositing is not re-laying-out: a box laid
  // out at the wrong height just gets repainted at the wrong height. The
  // height is now measured directly instead (lib/viewportHeight.ts), and
  // correctness no longer depends on this transition in any way — removing
  // it would change how the entrance looks and nothing else.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const trackStyle = useMemo(
    () => ({
      // Horizontal (tab swipe) and vertical (pull-to-refresh) drags share
      // this one transform — safe to combine because a single gesture only
      // ever drives one of the two axes at a time (see usePullToRefresh).
      transform: `translate(${dragX}px, ${pullY}px)`,
      transition: dragging || pulling ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
    }),
    [dragX, dragging, pullY, pulling]
  );

  return (
    <div className={`app-shell${entered ? " is-entered" : ""}`}>
      <div className="app-frame">
        <div className="nav app-nav">
          <div className="app-nav-identity">
            <span className="nav-brand">
              <Logo size={22} />
              Wage Tracker
            </span>
            <span className="app-nav-greeting">Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}</span>
            <span className="app-nav-date">{todayLabel}</span>
          </div>
          <button
            type="button"
            className={`app-nav-eye-btn${earningsHidden ? "" : " is-visible"}`}
            onClick={() => (earningsHidden ? revealEarnings() : hideEarningsNow())}
            aria-label={earningsHidden ? "Show earnings for 20 minutes" : "Hide earnings"}
            title={earningsHidden ? "Show earnings for 20 minutes" : "Hide earnings"}
            aria-pressed={!earningsHidden}
          >
            {earningsHidden ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
          </button>
          <button
            type="button"
            className="app-nav-logout"
            onClick={logout}
            aria-label="Log out"
            data-confirm="Log out of Wage Tracker? Any shift in progress keeps counting in the background."
            data-confirm-tone="danger"
          >
            <LogoutIcon size={16} />
            <span className="app-nav-logout-label">Log out</span>
          </button>
        </div>

        {actionError && (
          <div className="form-error" role="alert" style={{ margin: "0 var(--space-4)" }} onClick={clearActionError}>
            {actionError}
          </div>
        )}

        <main className="app-main" ref={swipeRef}>
          {screen === "home" && (
            <div
              className={`pull-refresh-indicator${refreshing ? " is-refreshing" : ""}`}
              style={{
                opacity: Math.min(1, pullY / 40),
                transform: `translate(-50%, ${pullY}px) scale(${Math.min(1, 0.7 + pullY / 170)})`,
              }}
              aria-hidden="true"
            >
              <RefreshIcon size={18} />
            </div>
          )}
          <div className="swipe-track" style={trackStyle}>
            <div key={screen} className={screenTransitionClass}>
              <ScreenErrorBoundary key={screen}>
                {screen === "home" && <HomeScreen />}
                {screen === "entry" && <EntryScreen />}
                {screen === "report" && <ReportScreen />}
                {screen === "history" && <HistoryScreen />}
                {screen === "settings" && <SettingsScreen />}
              </ScreenErrorBoundary>
            </div>
          </div>
        </main>

        <BottomNav screen={screen} onNavigate={setScreen} />
      </div>
    </div>
  );
}

function Root() {
  const { status, authBusy } = useApp();

  // Covers every path that can stall on a cold backend: the silent
  // session check on load (status === "loading") *and* an explicit
  // login/signup submission (authBusy) — same treatment either way, since
  // from the user's side both are just "the app is waiting on the server."
  // Delayed by 500ms so a normal, already-warm response never flashes this
  // screen — it only escalates once a wait is actually starting to look
  // like a Render cold start rather than ordinary network latency.
  const isWaiting = status === "loading" || authBusy;
  const showWakingScreen = useDelayedFlag(isWaiting, 500);

  if (showWakingScreen) return <WakingUpScreen />;
  // Still within the 500ms grace window of the initial session check —
  // previously blank here too, so no visible change on the fast path.
  if (status === "loading") return null;
  return status === "loggedIn" ? <AuthedApp /> : <AuthScreen />;
}

export default function App() {
  // Measures the real visible viewport into `--app-viewport-height` for the
  // whole session (see lib/viewportHeight.ts). Mounted here, outside
  // AppProvider's auth gate, so the value is already published before the
  // authenticated shell ever renders — the shell never has to wait on
  // WebKit re-resolving `dvh` for itself.
  useViewportHeight();

  return (
    <AppProvider>
      <ConfirmProvider>
        <Root />
      </ConfirmProvider>
    </AppProvider>
  );
}
