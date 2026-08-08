import type { ReactNode } from "react";
import { ChevronDownIcon } from "../components/icons";
import { SettingsNav, type SettingsCategory } from "./SettingsNav";

interface SettingsLayoutProps {
  categories: readonly SettingsCategory[];
  /** `null` means "no category explicitly picked yet" — drives the mobile
   * list-vs-detail view. Always non-null in effect on desktop (CSS shows
   * both panels regardless), where `effectiveCategory` supplies a default. */
  activeCategory: string | null;
  effectiveCategory: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  children: ReactNode;
}

/**
 * The Settings hub scaffold: a category list + a detail pane. On mobile,
 * CSS shows exactly one of the two (list until a category is picked, then
 * the detail view with a Back button); on desktop both are always visible
 * side by side (see settings.css). Category panels themselves are always
 * mounted by the caller (SettingsScreen) regardless of which is showing, so
 * switching categories never loses in-progress edits.
 */
export function SettingsLayout({ categories, activeCategory, effectiveCategory, onSelect, onBack, children }: SettingsLayoutProps) {
  const mode = activeCategory ? "detail" : "list";
  const activeLabel = categories.find((c) => c.id === effectiveCategory)?.label ?? "Settings";

  return (
    <div className={`settings-layout settings-layout--${mode}`}>
      <div className="settings-nav-panel">
        <h1 className="settings-page-title section-title">Settings</h1>
        <div className="section-hint">Your profile, work details, goals, security, and account.</div>
        <SettingsNav categories={categories} activeCategory={effectiveCategory} onSelect={onSelect} />
      </div>
      <div className="settings-detail-panel">
        <button type="button" className="settings-back-btn" onClick={onBack}>
          <ChevronDownIcon size={16} className="settings-back-icon" />
          Back to Settings
        </button>
        <h2 className="settings-detail-title">{activeLabel}</h2>
        {children}
      </div>
    </div>
  );
}
