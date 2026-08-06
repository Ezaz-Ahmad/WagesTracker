import { useCallback, useEffect, useMemo, useState } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { BottomNav, TABS } from "./components/BottomNav";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { Logo } from "./components/Logo";
import { LogoutIcon } from "./components/icons";
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

  // iOS Safari occasionally paints this shell's `100dvh` layout against a
  // stale viewport right at the moment the auth screen unmounts into it
  // (the login keyboard is closing and a big chunk of the DOM is swapping
  // out in the same frame). The result is a gap under the bottom nav that
  // only corrects itself once the user scrolls — because a real scroll is
  // what makes Safari recompute the dynamic viewport. Nudge the content
  // pane by a pixel and back right after mount so that correction happens
  // automatically instead of waiting on the user's first touch.
  useEffect(() => {
    const el = swipeRef.current;
    if (!el) return;
    el.scrollTop = 1;
    const id = requestAnimationFrame(() => {
      el.scrollTop = 0;
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trackStyle = useMemo(
    () => ({
      transform: `translateX(${dragX}px)`,
      transition: dragging ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
    }),
    [dragX, dragging]
  );

  return (
    <div className="app-shell">
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
