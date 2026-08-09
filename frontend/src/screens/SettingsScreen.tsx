import { useState } from "react";
import { useApp } from "../context/AppContext";
import { SettingsLayout } from "../settings/SettingsLayout";
import type { SettingsCategory } from "../settings/SettingsNav";
import { ProfileSettings } from "../settings/ProfileSettings";
import { WorkPaySettings } from "../settings/WorkPaySettings";
import { GoalSettings } from "../settings/GoalSettings";
import { SecuritySettings } from "../settings/SecuritySettings";
import { DataAccountSettings } from "../settings/DataAccountSettings";
import { BriefcaseIcon, DatabaseIcon, LockIcon, TargetIcon, UserIcon } from "../components/icons";

const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: "profile", label: "Profile & preferences", hint: "Name, address, week start", icon: UserIcon },
  { id: "workpay", label: "Work & pay", hint: "Location, address, hourly rate", icon: BriefcaseIcon },
  { id: "goals", label: "Weekly goals", hint: "Hours and earnings targets", icon: TargetIcon },
  { id: "security", label: "Security", hint: "Password and active sessions", icon: LockIcon },
  { id: "data", label: "Data & account", hint: "Retention, version, delete account", icon: DatabaseIcon },
];

/**
 * The Settings hub: a thin composition of SettingsLayout (nav + detail
 * scaffold) and one panel per category. Every panel is always mounted —
 * only `hidden` toggles which one is visible — so switching categories
 * never discards a draft edit in another one (see SettingsLayout's comment).
 * Each panel owns its own local form state, dirty-tracking, and save
 * behavior (see settings/*.tsx); this file only owns *which* category is
 * showing.
 */
export function SettingsScreen() {
  const { user } = useApp();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const effectiveCategory = activeCategory ?? SETTINGS_CATEGORIES[0].id;

  if (!user) return null;

  return (
    <SettingsLayout
      categories={SETTINGS_CATEGORIES}
      activeCategory={activeCategory}
      effectiveCategory={effectiveCategory}
      onSelect={setActiveCategory}
      onBack={() => setActiveCategory(null)}
    >
      <div className="settings-panel" hidden={effectiveCategory !== "profile"}>
        <ProfileSettings />
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "workpay"}>
        <WorkPaySettings />
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "goals"}>
        <GoalSettings />
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "security"}>
        <SecuritySettings />
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "data"}>
        <DataAccountSettings />
      </div>
    </SettingsLayout>
  );
}
