import { LandingHeroContent } from "../components/LandingHero";
import { ChevronDownIcon } from "../components/icons";
import { useSwipeUp } from "../lib/useSwipeUp";

interface WelcomeScreenProps {
  onContinue: () => void;
}

/**
 * A full-screen, mobile-only intro shown before every login — see App.tsx's
 * Root, which mounts this whenever `status === "loggedOut"` and resets its
 * own dismissed-state back to "shown" every time a fresh "loggedOut" is
 * entered, so this reappears after every logout too, not just the very
 * first time the app is ever opened.
 *
 * Only actually visible on narrow viewports (hidden via the same
 * `min-width: 960px` breakpoint AuthScreen's own dark hero panel
 * (`.landing-hero`) uses — see styles/landing.css) — on a wide viewport
 * that hero already sits permanently beside the login form, so a
 * full-screen intro in front of it would just be a redundant extra swipe
 * for no reason. Both surfaces render the exact same marketing copy via
 * `LandingHeroContent`, so they can never say different things about the
 * product.
 *
 * Dismissible two ways: a swipe up (`useSwipeUp` — a progressive
 * enhancement only) or the "Get started" button beneath it, which is
 * always present and is what actually satisfies keyboard, switch-control,
 * and screen-reader access to the same action.
 */
export function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
  const { ref, dragY, dragging } = useSwipeUp<HTMLDivElement>(true, onContinue);

  return (
    <div
      ref={ref}
      className="welcome-screen"
      style={{
        transform: dragY ? `translateY(-${dragY}px)` : undefined,
        transition: dragging ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div className="landing-shapes" aria-hidden="true">
        <span className="landing-shape landing-shape-1" />
        <span className="landing-shape landing-shape-2" />
        <span className="landing-shape landing-shape-3" />
      </div>
      <div className="welcome-content">
        <LandingHeroContent />
      </div>
      <div className="welcome-cta">
        <button type="button" className="btn btn-primary btn-block welcome-continue-btn" onClick={onContinue}>
          Get started
        </button>
        {/* Decorative only — the button above is the real, accessible way
            to do the same thing, so this hint (and the swipe gesture it
            describes) is aria-hidden rather than a second announcement of
            the same action. */}
        <div className="welcome-swipe-hint" aria-hidden="true">
          <ChevronDownIcon size={16} className="welcome-swipe-chevron" />
          Swipe up to continue
        </div>
      </div>
    </div>
  );
}
