import type { Screen } from "../lib/types";
import { EntryIcon, HistoryIcon, HomeIcon, ReportIcon, SettingsIcon } from "./icons";

const TABS: { screen: Screen; label: string; Icon: typeof HomeIcon }[] = [
  { screen: "home", label: "Home", Icon: HomeIcon },
  { screen: "entry", label: "Entry", Icon: EntryIcon },
  { screen: "report", label: "Report", Icon: ReportIcon },
  { screen: "history", label: "History", Icon: HistoryIcon },
  { screen: "settings", label: "Settings", Icon: SettingsIcon },
];

export function BottomNav({ screen, onNavigate }: { screen: Screen; onNavigate: (s: Screen) => void }) {
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.screen === screen));
  const navStyle = {
    "--nav-index": activeIndex,
    "--nav-count": TABS.length,
  } as React.CSSProperties;

  return (
    <nav className="app-bottomnav" style={navStyle}>
      <span className="app-bottomnav-indicator" aria-hidden="true" />
      <div className="app-sidebar-brand">Wage Tracker</div>
      {TABS.map(({ screen: s, label, Icon }) => (
        <button
          key={s}
          type="button"
          className={`app-bottomnav-btn${screen === s ? " is-active" : ""}`}
          onClick={() => onNavigate(s)}
        >
          <Icon />
          <span className="app-bottomnav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
