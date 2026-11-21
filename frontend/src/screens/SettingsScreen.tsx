import { WorkspaceGoalsSettings } from "../settings/WorkspaceGoalsSettings";
import { JobsSettings } from "../components/JobWorkspace";
import { useState } from "react";
import { useApp } from "../context/AppContext";
import { SettingsLayout } from "../settings/SettingsLayout";
import type { SettingsCategory } from "../settings/SettingsNav";
import { ProfileSettings } from "../settings/ProfileSettings";
import { WorkPaySettings } from "../settings/WorkPaySettings";
import { GoalSettings } from "../settings/GoalSettings";
import { SecuritySettings } from "../settings/SecuritySettings";
import { DataAccountSettings } from "../settings/DataAccountSettings";
import { AboutSettings } from "../settings/AboutSettings";
import { BriefcaseIcon, DatabaseIcon, InfoIcon, LockIcon, TargetIcon, UserIcon } from "../components/icons";

const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: "profile", label: "Profile & preferences", hint: "Profile, appearance, smart reminders", icon: UserIcon },
  { id: "jobs", label: "Your jobs", hint: "Employers, locations, pay and goals", icon: BriefcaseIcon },
  { id: "workpay", label: "Work & pay", hint: "Location, address, hourly rate", icon: BriefcaseIcon },
  { id: "goals", label: "Weekly goals", hint: "Hours and earnings targets", icon: TargetIcon },
  { id: "security", label: "Security", hint: "Email, password and signed-in devices", icon: LockIcon },
  { id: "data", label: "Data & account", hint: "Data retention and account deletion", icon: DatabaseIcon },
  { id: "about", label: "About", hint: "Privacy Policy and support", icon: InfoIcon },
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
export function SettingsScreen({ initialCategory = null }: { initialCategory?: string | null }) {
  const { user,selectedJobId,selectedJob } = useApp();
  const [activeCategory, setActiveCategory] = useState<string | null>(initialCategory);
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
        <ProfileSettings key={selectedJobId}/>
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "jobs"}><JobsSettings onOpenWorkPay={()=>setActiveCategory("workpay")}/></div>
      <div className="settings-panel" hidden={effectiveCategory !== "workpay"}>
        {user.workspacesEnabled && !selectedJob ? <section className="card"><h3>Choose a job to manage its pay</h3><p className="field-hint">Your jobs keeps each employer's locations and hourly rates together.</p><button className="btn btn-secondary" onClick={() => setActiveCategory("jobs")}>Go to Your jobs</button></section> : <WorkPaySettings key={selectedJobId}/>}
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "goals"}>
        {selectedJobId==="all"?<WorkspaceGoalsSettings/>:<GoalSettings key={selectedJobId}/>}
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "security"}>
        <SecuritySettings />
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "data"}>
        <DataAccountSettings />
      </div>
      <div className="settings-panel" hidden={effectiveCategory !== "about"}>
        <AboutSettings />
      </div>
    </SettingsLayout>
  );
}
