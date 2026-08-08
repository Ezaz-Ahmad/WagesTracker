export interface SettingsCategory {
  id: string;
  label: string;
  hint: string;
}

interface SettingsNavProps {
  categories: readonly SettingsCategory[];
  activeCategory: string;
  onSelect: (id: string) => void;
}

/** The Settings category list — a persistent left sidebar on desktop, and
 * (via SettingsLayout's CSS) the full-screen list view on mobile until a
 * category is picked. */
export function SettingsNav({ categories, activeCategory, onSelect }: SettingsNavProps) {
  return (
    <nav className="settings-nav" aria-label="Settings categories">
      <ul className="settings-nav-list">
        {categories.map((c) => {
          const isActive = c.id === activeCategory;
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`settings-nav-item${isActive ? " is-active" : ""}`}
                onClick={() => onSelect(c.id)}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="settings-nav-item-label">{c.label}</span>
                <span className="settings-nav-item-hint">{c.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
