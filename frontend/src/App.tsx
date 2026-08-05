import { useCallback, useMemo, useState } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { BottomNav, TABS } from "./components/BottomNav";
import { Logo } from "./components/Logo";
import { AuthScreen } from "./screens/AuthScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { EntryScreen } from "./screens/EntryScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { useSwipeNav } from "./lib/useSwipeNav";
import type { Screen } from "./lib/types";

function AuthedApp() {
  const { today, user, actionError, clearActionError } = useApp();
  const [screen, setScreen] = useState<Screen>("home");

  const todayLabel = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const activeIndex = Math.max(0, TABS.findIndex((t) => t.screen === screen));
  const handleSwipeNavigate = useCallback((index: number) => setScreen(TABS[index].screen), []);
  const { ref: swipeRef, dragX, dragging } = useSwipeNav<HTMLDivElement>(activeIndex, TABS.length, handleSwipeNavigate);
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
          <span className="nav-brand">
            <Logo size={22} />
            Wage Tracker
          </span>
          <span className="app-nav-greeting">Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}</span>
          <span className="app-nav-date">{todayLabel}</span>
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
      <Root />
    </AppProvider>
  );
}
