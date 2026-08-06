import { useCallback, useEffect, useMemo, useState } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { BottomNav, TABS } from "./components/BottomNav";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { Logo } from "./components/Logo";
import { LogoutIcon } from "./components/icons";
import { LoginGapDebug } from "./components/LoginGapDebug";
import { AuthScreen } from "./screens/AuthScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { EntryScreen } from "./screens/EntryScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { useSwipeNav } from "./lib/useSwipeNav";
import type { Screen } from "./lib/types";

function AuthedApp() {
  const { today, user, actionError, clearActionError, logout } = useApp();
  const [screen, setScreen] = useState<Screen>("home");

  const todayLabel = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const activeIndex = Math.max(0, TABS.findIndex((t) => t.screen === screen));
  const handleSwipeNavigate = useCallback((index: number) => setScreen(TABS[index].screen), []);
  const { ref: swipeRef, dragX, dragging } = useSwipeNav<HTMLDivElement>(activeIndex, TABS.length, handleSwipeNavigate);

  // Both a JS scroll nudge and a forced display-toggle repaint failed to
  // fix this (confirmed on-device) and the scroll nudge actively made
  // things worse — it seems to trigger iOS's own toolbar hide/show
  // heuristic, which then keeps oscillating on its own for a couple of
  // seconds instead of settling once. Fighting the browser's compositor
  // directly isn't working, so instead of forcing an instantaneous repaint,
  // fade the shell in over a real CSS transition. An opacity animation
  // forces a fresh composite on every frame it runs, so whatever the state
  // is by the time the fade finishes (layout is confirmed to settle within
  // well under a second on its own), that's what gets painted — no scroll
  // tricks, nothing that can destabilize the toolbar.
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
      transform: `translateX(${dragX}px)`,
      transition: dragging ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
    }),
    [dragX, dragging]
  );

  return (
    <div className={`app-shell${entered ? " is-entered" : ""}`}>
      <LoginGapDebug />
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

        <div className="app-main" ref={swipeRef}>
          <div className="swipe-track" style={trackStyle}>
            <div key={screen} className="screen-transition">
              {screen === "home" && <HomeScreen />}
              {screen === "entry" && <EntryScreen />}
              {screen === "report" && <ReportScreen />}
              {screen === "history" && <HistoryScreen />}
              {screen === "settings" && <SettingsScreen />}
            </div>
          </div>
        </div>

        <BottomNav screen={screen} onNavigate={setScreen} />
      </div>
    </div>
  );
}

function Root() {
  const { status } = useApp();
  if (status === "loading") return null;
  return status === "loggedIn" ? <AuthedApp /> : <AuthScreen />;
}

export default function App() {
  return (
    <AppProvider>
      <ConfirmProvider>
        <Root />
      </ConfirmProvider>
    </AppProvider>
  );
}
