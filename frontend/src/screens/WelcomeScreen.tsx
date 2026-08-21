import { LandingHeroContent } from "../components/LandingHero";
import { ChevronDownIcon } from "../components/icons";
import { useSwipeUp } from "../lib/useSwipeUp";

interface WelcomeScreenProps {
  onContinue: () => void;
}

/**
 * A full-screen, mobile-only intro shown before every login — see App.tsx's
 * Root, which mounts this on narrow viewports whenever `status ===
 * "loggedOut"` and resets its own dismissed-state back to "shown" every
 * time a fresh "loggedOut" is entered, so this reappears after every logout
 * too, not just the very first time the app is ever opened.
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
 *
 * The live drag itself is owned entirely by useSwipeUp, imperatively — this
 * component never reads a per-pixel drag position out of it (see that
 * hook's own doc comment on why routing that through React state made the
 * gesture feel laggy). `dragging` is the one thing it does read, and it
 * only ever flips twice per gesture, to dim the swipe hint while a drag is
 * actually in progress.
 */
export function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
  const { ref, dragging } = useSwipeUp<HTMLDivElement>(true, onContinue);

  return (
    <div ref={ref} className={dragging ? "welcome-screen is-dragging" : "welcome-screen"}>
      <div className="landing-shapes" aria-hidden="true">
        <span className="landing-shape landing-shape-1" />
        <span className="landing-shape landing-shape-2" />
        <span className="landing-shape landing-shape-3" />
      </div>
      <div className="welcome-content">
        <LandingHeroContent />
      </div>
      <div className="welcome-cta anim-rise" style={{ ["--i" as string]: 12 }}>
        <button type="button" className="btn btn-primary btn-block welcome-continue-btn" onClick={onContinue}>
          Get started
        </button>
        {/* Decorative only — the button above is the real, accessible way
            to do the same thing, so this hint (and the swipe gesture it
            describes) is aria-hidden rather than a second announcement of
            the same action. A trio of chevrons rather than one, each
            animating on its own delay, so the cue reads unmistakably as
            "swipe up" (a rising, fading trail) rather than an ambiguous
            single bob. */}
        <div className="welcome-swipe-hint" aria-hidden="true">
          <div className="welcome-swipe-chevrons">
            <ChevronDownIcon size={13} className="welcome-swipe-chevron welcome-swipe-chevron-1" />
            <ChevronDownIcon size={13} className="welcome-swipe-chevron welcome-swipe-chevron-2" />
            <ChevronDownIcon size={13} className="welcome-swipe-chevron welcome-swipe-chevron-3" />
          </div>
          <span className="welcome-swipe-label">Swipe up to continue</span>
        </div>
      </div>
    </div>
  );
}
