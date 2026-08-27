import { useCallback, useEffect, useState } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { BottomNav, TABS } from "./components/BottomNav";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { Logo } from "./components/Logo";
import { EyeIcon, EyeOffIcon, LogoutIcon, RefreshIcon } from "./components/icons";
import { AuthScreen } from "./screens/AuthScreen";
import { ResetPasswordPage } from "./screens/ResetPasswordPage";
import { getDeepLink, subscribeDeepLink, type DeepLinkRoute } from "./platform/deepLinks";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { WakingUpScreen } from "./components/WakingUpScreen";
import { ScreenErrorBoundary } from "./components/ScreenErrorBoundary";
import { StatusBanner } from "./components/StatusBanner";
import { useDelayedFlag } from "./lib/useDelayedFlag";
import { HomeScreen } from "./screens/HomeScreen";
import { EntryScreen } from "./screens/EntryScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SpendingScreen } from "./screens/SpendingScreen";
import { useSwipeNav } from "./lib/useSwipeNav";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { useMatchMedia } from "./lib/useMatchMedia";
import { useViewportHeight } from "./lib/useViewportHeight";
import { ViewportDebugOverlay } from "./components/ViewportDebugOverlay";
import { reloadIfNewVersionDeployed } from "./lib/checkForUpdate";
import { useStableScreenTransition } from "./lib/useStableScreenTransition";
import type { Screen } from "./lib/types";

// Build-time constant. Vite inlines `import.meta.env.VITE_VIEWPORT_DEBUG`, so
// in every normal build this folds to `false`, the JSX branch below is dead
// code, and ViewportDebugOverlay is tree-shaken out of the bundle. It is only
// ever true in the temporary diagnostic build made for on-device testing:
//   VITE_VIEWPORT_DEBUG=true npm run build -w frontend
const VIEWPORT_DEBUG = !__NATIVE_CONSUMER_BUILD__ && import.meta.env.VITE_VIEWPORT_DEBUG === "true";

function AuthedApp() {
  const {
    today,
    user,
    actionError,
    clearActionError,
    sessionNotice,
    dismissSessionNotice,
    logout,
    refresh,
    connected,
    retryConnectivity,
    earningsHidden,
    revealEarnings,
    hideEarningsNow,
  } = useApp();
  const [screen, setScreen] = useState<Screen>("home");

  const todayLabel = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const activeIndex = Math.max(0, TABS.findIndex((t) => t.screen === screen));
  const handleSwipeNavigate = useCallback((index: number) => setScreen(TABS[index].screen), []);
  const { ref: swipeRef } = useSwipeNav<HTMLDivElement>(activeIndex, TABS.length, handleSwipeNavigate);

  // Pull-to-refresh — Home only, per the ask. Bound to the same scrollable
  // pane as the swipe-tab gesture. Neither gesture moves the pane itself:
  // pull distance only animates the small indicator and tab navigation is
  // committed on release. Refreshes data every pull; also silently reloads the page
  // if a newer build has been deployed since this tab was opened, so a pull
  // gets you both the latest numbers *and* the latest app, not just one.
  const handlePullRefresh = useCallback(async () => {
    await refresh();
    await reloadIfNewVersionDeployed();
  }, [refresh]);
  const { indicatorRef: pullIndicatorRef, refreshing } = usePullToRefresh(swipeRef, screen === "home", handlePullRefresh);

  // Which way the tab just changed (bottom-nav tap or a completed swipe both
  // land here) — drives a directional slide on mount instead of a plain
  // fade, so tapping a tab feels like the same physical motion as swiping to
  // it, not two different transitions depending on how you got there.
  const screenTransitionClass = useStableScreenTransition(screen);

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

  return (
    <div className={`app-shell${entered ? " is-entered" : ""}`}>
      <div className="app-frame">
        {/* A <header> rather than a plain div: this is the app's banner, and
            with <main> and <nav> already in place it was the one missing
            landmark. Screen-reader landmark navigation could reach the
            content and the tabs but not the log-out / privacy controls. */}
        <header className="nav app-nav">
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
        </header>

        {/* The device-limit notice. The backend has sent this on the login
            response ever since per-installation sessions landed, but the
            client destructured it away, so the one thing it exists to
            explain — "your oldest unused device was signed out" — was never
            said. Informational tone and role="status", not an error: the
            login succeeded, and dressing it in red would read as a failure.
            Shown once and dismissible; nothing re-sets it, so switching tabs
            or re-rendering can't bring it back (AppContext.sessionNotice). */}
        {(!connected || sessionNotice || actionError) && (
          <div className="app-shell-banner" aria-label="Notifications">
            {!connected && (
            <StatusBanner tone="warning">
              <span className="offline-banner-content">
                <span><strong>You're offline.</strong> Loaded information remains available, but changes cannot be saved.</span>
                <button type="button" className="offline-retry-btn" onClick={() => void retryConnectivity()}>Retry</button>
              </span>
            </StatusBanner>
            )}
            {sessionNotice && (
            <StatusBanner tone="info" onDismiss={dismissSessionNotice} dismissLabel="Dismiss this notice">
              {sessionNotice}
            </StatusBanner>
            )}
            {actionError && (
            <StatusBanner tone="danger" onDismiss={clearActionError} dismissLabel="Dismiss this error">
              {actionError}
            </StatusBanner>
            )}
          </div>
        )}

        <main className="app-main" ref={swipeRef}>
          {screen === "home" && (
            <div
              className={`pull-refresh-indicator${refreshing ? " is-refreshing" : ""}`}
              ref={pullIndicatorRef}
              aria-hidden="true"
            >
              <RefreshIcon size={18} />
            </div>
          )}
          <div className="swipe-track">
            <div key={screen} className={screenTransitionClass}>
              <ScreenErrorBoundary key={screen}>
                {screen === "home" && <HomeScreen onNavigate={setScreen} />}
                {screen === "entry" && <EntryScreen />}
                {screen === "spending" && <SpendingScreen />}
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

function useDeepLink(): DeepLinkRoute | null {
  const [deepLink, setDeepLink] = useState<DeepLinkRoute | null>(getDeepLink);
  useEffect(() => subscribeDeepLink(setDeepLink), []);
  return deepLink;
}

function Root() {
  const { status, authBusy, biometricPromptActive } = useApp();
  const deepLink = useDeepLink();
  const isDesktop = useMatchMedia("(min-width: 960px)");

  // Shown once per "loggedOut" stretch, on top of AuthScreen — see
  // WelcomeScreen's own doc comment. Reset back to "not yet dismissed"
  // every time `status` freshly becomes "loggedOut" (covers both the very
  // first cold launch, which starts "loading" then falls through to
  // "loggedOut" below, and every later logout, which goes "loggedIn" ->
  // "loggedOut") rather than only once ever, so it reappears after each
  // logout exactly as asked for, instead of only the first install.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  useEffect(() => {
    if (status === "loggedOut") setWelcomeDismissed(false);
  }, [status]);

  // Covers every path that can stall on a cold backend: the silent
  // session check on load (status === "loading") *and* an explicit
  // login/signup submission (authBusy) — same treatment either way, since
  // from the user's side both are just "the app is waiting on the server."
  // Delayed by 500ms so a normal, already-warm response never flashes this
  // screen — it only escalates once a wait is actually starting to look
  // like a Render cold start rather than ordinary network latency.
  //
  // `biometricPromptActive` is excluded from `status === "loading"` here on
  // purpose: the automatic cold-launch Face ID/Touch ID attempt runs inside
  // that same "loading" window (see AppContext's restoreSession), and this
  // screen's connection/workspace stages describe server
  // cold-starts specifically — showing it while the user is actually
  // looking at the system Face ID prompt would be actively misleading. The
  // screen stays blank (the same fallback already used for the initial
  // grace window below) for that stretch instead.
  //
  // This is deliberately the narrower `biometricPromptActive` flag, not the
  // wider `biometricBusy` (which also covers AppContext's post-unlock
  // `fetchMeWithToken` re-validation call). Using `biometricBusy` here used
  // to leave the app on a blank white screen with nothing shown at all for
  // the entire cold-start wait after a *successful* Face ID unlock — the
  // system prompt was long gone, but the wider flag still suppressed this
  // screen for the network wait that followed it. See
  // `biometricPromptActive`'s own doc comment on AppContext.
  const isWaiting = (status === "loading" && !biometricPromptActive) || authBusy;
  const showWakingScreen = useDelayedFlag(isWaiting, 500);

  // A Universal Link is an explicit navigation request and takes priority
  // over a restored session or the mobile welcome gate.
  if (deepLink?.screen === "reset-password") {
    // A second Universal Link can arrive while the first reset screen is
    // still mounted. Key by the credential so React discards the first
    // screen's validation/form state and verifies the new link instead.
    return <ResetPasswordPage key={deepLink.token} token={deepLink.token} />;
  }
  if (showWakingScreen) return <WakingUpScreen />;
  // Still within the 500ms grace window of the initial session check —
  // previously blank here too, so no visible change on the fast path.
  if (status === "loading") return null;
  // WelcomeScreen is deliberately hidden by CSS from 960px upward because
  // AuthScreen already includes the same marketing panel beside its form on
  // desktop. Keep the render gate aligned with that breakpoint: rendering a
  // CSS-hidden WelcomeScreen *instead of* AuthScreen leaves a successfully
  // mounted React tree with no visible UI — the production white-screen
  // failure this condition prevents.
  if (status === "loggedOut" && !welcomeDismissed && !isDesktop) {
    return <WelcomeScreen onContinue={() => setWelcomeDismissed(true)} />;
  }
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
        {VIEWPORT_DEBUG && <ViewportDebugOverlay />}
      </ConfirmProvider>
    </AppProvider>
  );
}
