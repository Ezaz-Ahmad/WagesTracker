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

  // Diagnostics confirmed this shell's *layout* (shell/window/nav
  // measurements) settles correctly within ~150ms of mount — but the user
  // still sees a visible gap until they scroll, meaning the problem is a
  // stale *paint*: iOS keeps showing an old composited frame of the shell
  // even once the underlying layout is already correct, and only a real,
  // native touch-driven scroll makes it redraw. A JS-triggered scroll
  // updates the numbers but doesn't go through the same native gesture
  // pipeline, so it doesn't reliably force that redraw. What does work
  // unconditionally: pulling the shell out of the render tree and putting
  // it straight back. That forces WebKit to rebuild and repaint it from
  // scratch against the current (already-correct) layout, with no
  // dependency on a native gesture. Done synchronously so nothing is ever
  // actually missing on screen for a frame.
  useEffect(() => {
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevMinHeight = body.style.minHeight;
    body.style.overflow = "auto";
    body.style.minHeight = "calc(100% + 4px)";

    const forceRepaint = () => {
      const shell = document.querySelector<HTMLElement>(".app-shell");
      if (!shell) return;
      const prevDisplay = shell.style.display;
      shell.style.display = "none";
      void shell.offsetHeight; // flush the removal synchronously
      shell.style.display = prevDisplay;
    };

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      window.scrollTo(0, 3);
      raf2 = requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        body.style.overflow = prevOverflow;
        body.style.minHeight = prevMinHeight;
        forceRepaint();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      body.style.overflow = prevOverflow;
      body.style.minHeight = prevMinHeight;
    };
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
