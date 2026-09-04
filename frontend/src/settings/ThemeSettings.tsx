import { MoonIcon, MonitorIcon, SunIcon } from "../components/icons";
import { useTheme, type ThemePreference } from "../context/ThemeContext";

const OPTIONS: readonly {
  value: ThemePreference;
  label: string;
  hint: string;
  Icon: typeof SunIcon;
}[] = [
  { value: "light", label: "Light", hint: "Bright and clear", Icon: SunIcon },
  { value: "dark", label: "Dark", hint: "Comfortable at night", Icon: MoonIcon },
  { value: "system", label: "System", hint: "Match this device", Icon: MonitorIcon },
];

export function ThemeSettings() {
  const { preference, resolvedTheme, setPreference } = useTheme();

  return (
    <section className="card profile-appearance-settings" aria-labelledby="appearance-title">
      <div className="profile-appearance-heading">
        <span className="profile-appearance-heading-icon" aria-hidden="true">
          {resolvedTheme === "dark" ? <MoonIcon size={20} /> : <SunIcon size={20} />}
        </span>
        <div>
          <span className="weekly-cycle-eyebrow">Appearance</span>
          <h3 id="appearance-title">Theme</h3>
          <p>Choose a look, or let WagesTracker follow your device automatically.</p>
        </div>
      </div>

      <fieldset className="fieldset-plain theme-choice-group">
        <legend className="visually-hidden">Choose app theme</legend>
        {OPTIONS.map(({ value, label, hint, Icon }) => {
          const selected = preference === value;
          return (
            <label className={`theme-choice${selected ? " is-selected" : ""}`} key={value}>
              <input
                type="radio"
                name="app-theme"
                value={value}
                aria-label={`${label}. ${hint}`}
                checked={selected}
                onChange={() => setPreference(value)}
              />
              <span className="theme-choice-icon" aria-hidden="true"><Icon size={19} /></span>
              <span className="theme-choice-copy">
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <span className="theme-choice-check" aria-hidden="true" />
            </label>
          );
        })}
      </fieldset>

      <p className="theme-current-state" aria-live="polite">
        Currently using <strong>{resolvedTheme === "dark" ? "Dark" : "Light"} mode</strong>
        {preference === "system" ? " from your device setting." : "."}
      </p>
    </section>
  );
}
