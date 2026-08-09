import type { ComponentType } from "react";
import { ChevronRightIcon } from "../components/icons";

export interface SettingsCategory {
  id: string;
  label: string;
  hint: string;
  /** Small glyph shown at the start of this category's row — one of the
   * icon components from components/icons.tsx, kept generic here (rather
   * than importing each icon by name) so SettingsNav doesn't need to know
   * the full list of categories or their meanings, only how to lay one out. */
  icon: ComponentType<{ size?: number }>;
}

interface SettingsNavProps {
  categories: readonly SettingsCategory[];
  activeCategory: string;
  onSelect: (id: string) => void;
  /** Lets SettingsLayout keep a ref to each nav button, so it can restore
   * focus to "the button that opened this detail view" when the user backs
   * out of it on mobile — without SettingsNav needing to know anything about
   * focus management itself. */
  onButtonRef?: (id: string, el: HTMLButtonElement | null) => void;
}

/** The Settings category list — a persistent left sidebar on desktop, and
 * (via SettingsLayout's CSS) the full-screen list view on mobile until a
 * category is picked. */
export function SettingsNav({ categories, activeCategory, onSelect, onButtonRef }: SettingsNavProps) {
  return (
    <nav className="settings-nav" aria-label="Settings categories">
      <ul className="settings-nav-list">
        {categories.map((c) => {
          const isActive = c.id === activeCategory;
          const Icon = c.icon;
          return (
            <li key={c.id}>
              <button
                type="button"
                ref={(el) => onButtonRef?.(c.id, el)}
                className={`settings-nav-item${isActive ? " is-active" : ""}`}
                onClick={() => onSelect(c.id)}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="settings-nav-item-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="settings-nav-item-text">
                  <span className="settings-nav-item-label">{c.label}</span>
                  <span className="settings-nav-item-hint">{c.hint}</span>
                </span>
                <span className="settings-nav-item-chevron" aria-hidden="true">
                  <ChevronRightIcon size={16} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
