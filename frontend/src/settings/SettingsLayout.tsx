import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ChevronDownIcon } from "../components/icons";
import { SettingsNav, type SettingsCategory } from "./SettingsNav";
import { useMatchMedia } from "../lib/useMatchMedia";

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

// Must match settings.css's own desktop breakpoint exactly (`@media
// (min-width: 1080px)`), since this is used to decide whether the mobile
// list<->detail focus-management dance below should run at all — if this
// ever drifts out of sync with the CSS, focus could be moved on desktop
// (where nothing actually hides) or skipped on mobile.
const DESKTOP_QUERY = "(min-width: 1080px)";

/**
 * The Settings hub scaffold: a category list + a detail pane. On mobile,
 * CSS shows exactly one of the two (list until a category is picked, then
 * the detail view with a Back button); on desktop both are always visible
 * side by side (see settings.css). Category panels themselves are always
 * mounted by the caller (SettingsScreen) regardless of which is showing, so
 * switching categories never loses in-progress edits.
 *
 * Also owns two pieces of stability/accessibility behavior that belong at
 * this level rather than in any one category panel: resetting scroll
 * position on every category switch (so a scrollbar-driven or
 * content-height-driven layout shift never leaves the view in a jarring
 * mid-scroll state), and moving focus in and out of the detail view on
 * mobile, where opening/closing a category actually hides one of the two
 * panels.
 */
export function SettingsLayout({ categories, activeCategory, effectiveCategory, onSelect, onBack, children }: SettingsLayoutProps) {
  const mode = activeCategory ? "detail" : "list";
  const activeLabel = categories.find((c) => c.id === effectiveCategory)?.label ?? "Settings";

  const containerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navButtonRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const lastCategoryRef = useRef<string | null>(activeCategory);
  const prevModeRef = useRef(mode);
  const isDesktop = useMatchMedia(DESKTOP_QUERY);

  // Deliberately reset the shared scroll container (.app-main) to the top
  // before the newly-selected category paints, instead of letting the
  // browser clamp an now-too-large scroll offset on its own after the fact
  // (which is what produced a visible jump when switching from a tall
  // category — e.g. Security, with its password form + session list — to a
  // much shorter one while scrolled down). useLayoutEffect runs after the
  // DOM is updated but before the browser paints, so no intermediate scroll
  // position is ever shown to the user.
  useLayoutEffect(() => {
    const scrollParent = containerRef.current?.closest(".app-main") as HTMLElement | null;
    if (scrollParent) scrollParent.scrollTop = 0;
  }, [effectiveCategory]);

  // Mobile-only focus management. Opening a category hides the nav list
  // entirely (settings.css: `.settings-layout--detail .settings-nav-panel {
  // display: none }`), which would otherwise leave focus sitting on a
  // button that's no longer visible or reachable — so focus moves to the
  // detail heading instead. Going back does the reverse: the detail view
  // (and whatever inside it currently has focus) disappears, so focus
  // returns to the specific nav button that opened it. On desktop both
  // panels stay visible the whole time and clicking a nav button already
  // focuses it natively, so nothing here should run there — doing so
  // unconditionally would itself be "desktop category switching steals
  // focus", which the design explicitly rules out.
  useEffect(() => {
    if (!isDesktop) {
      if (mode === "detail" && prevModeRef.current === "list") {
        headingRef.current?.focus({ preventScroll: true });
      } else if (mode === "list" && prevModeRef.current === "detail") {
        const returningTo = lastCategoryRef.current;
        const btn = returningTo ? navButtonRefs.current.get(returningTo) ?? null : null;
        btn?.focus({ preventScroll: true });
      }
    }
    prevModeRef.current = mode;
    if (activeCategory) lastCategoryRef.current = activeCategory;
  }, [mode, isDesktop, activeCategory]);

  return (
    <div className={`settings-layout settings-layout--${mode}`} ref={containerRef}>
      {/* Lifted out of the nav panel. On a phone, CSS hides whichever of the
          two panels isn't showing — and `display: none` removes a node from
          the accessibility tree, not just from view. With the page's only
          <h1> inside the nav panel, opening a category left the screen with
          no <h1> at all and its headings starting at <h2>, so a screen-reader
          user navigating by heading landed in the middle of a hierarchy with
          no top. Out here it is always in the tree; in the mobile detail view
          it's clipped visually (see .settings-layout--detail in settings.css)
          rather than removed, and the category's own <h2> is what shows. */}
      <div className="settings-page-head">
        <h1 className="settings-page-title section-title">Settings</h1>
        <div className="section-hint">Your profile, work details, goals, security, and account.</div>
      </div>
      <div className="settings-nav-panel">
        <SettingsNav
          categories={categories}
          activeCategory={effectiveCategory}
          onSelect={onSelect}
          onButtonRef={(id, el) => {
            if (el) navButtonRefs.current.set(id, el);
            else navButtonRefs.current.delete(id);
          }}
        />
      </div>
      <div className="settings-detail-panel">
        <button type="button" className="settings-back-btn" onClick={onBack}>
          <ChevronDownIcon size={16} className="settings-back-icon" />
          Back to Settings
        </button>
        {/* tabIndex={-1}: never in the Tab order, only a programmatic focus
            target for the mobile open-category flow above. */}
        <h2 className="settings-detail-title" ref={headingRef} tabIndex={-1}>
          {activeLabel}
        </h2>
        {children}
      </div>
    </div>
  );
}
