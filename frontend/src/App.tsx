import { useState } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { BottomNav } from "./components/BottomNav";
import { AuthScreen } from "./screens/AuthScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { EntryScreen } from "./screens/EntryScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type { Screen } from "./lib/types";

function AuthedApp() {
  const { today } = useApp();
  const [screen, setScreen] = useState<Screen>("home");

  const todayLabel = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="app-shell">
      <div className="app-frame">
        <div className="nav app-nav">
          <span className="nav-brand">Wage Tracker</span>
          <span className="app-nav-date">{todayLabel}</span>
        </div>

        <div className="app-main">
          {screen === "home" && <HomeScreen />}
          {screen === "entry" && <EntryScreen />}
          {screen === "report" && <ReportScreen />}
          {screen === "history" && <HistoryScreen />}
          {screen === "settings" && <SettingsScreen />}
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
