import type { Screen } from "../lib/types";
import { EntryIcon, HistoryIcon, HomeIcon, ReportIcon, SettingsIcon, SpendingIcon } from "./icons";
import { Logo } from "./Logo";

export const TABS: { screen: Screen; label: string; Icon: typeof HomeIcon }[] = [
  { screen: "home", label: "Home", Icon: HomeIcon },
  { screen: "entry", label: "Entry", Icon: EntryIcon },
  { screen: "spending", label: "Spending", Icon: SpendingIcon },
  { screen: "report", label: "Report", Icon: ReportIcon },
  { screen: "history", label: "History", Icon: HistoryIcon },
  { screen: "settings", label: "Settings", Icon: SettingsIcon },
];

export function tabsInOrder(order: readonly Screen[]) {
  return order.map((screen) => TABS.find((tab) => tab.screen === screen)).filter((tab): tab is (typeof TABS)[number] => Boolean(tab));
}

export function BottomNav({
  screen,
  onNavigate,
  tabs = TABS,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
  tabs?: typeof TABS;
}) {
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.screen === screen));
  const navStyle = {
    "--nav-index": activeIndex,
    "--nav-count": tabs.length,
  } as React.CSSProperties;

  return (
    <nav className="app-bottomnav" style={navStyle} aria-label="Main">
      <span className="app-bottomnav-indicator" aria-hidden="true" />
      <div className="app-sidebar-brand">
        <Logo size={22} />
        Wage Tracker
      </div>
      {tabs.map(({ screen: s, label, Icon }) => (
        <button
          key={s}
          type="button"
          className={`app-bottomnav-btn${screen === s ? " is-active" : ""}`}
          onClick={() => onNavigate(s)}
          aria-current={screen === s ? "page" : undefined}
        >
          <Icon />
          <span className="app-bottomnav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
