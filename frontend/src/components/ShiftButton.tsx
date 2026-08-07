import { useEffect, useRef, useState } from "react";
import { useShiftTimer } from "../lib/useShiftTimer";
import { CheckIcon } from "./icons";

// A flat inline fill read as plain next to the rest of the redesigned UI —
// these match the same 3-stop gradient recipe `.btn-primary` uses (light
// highlight -> base -> deep shadow stop) so the CTA reads as a glossy sphere
// rather than a solid-color disc, in whichever semantic color the state
// calls for (red to stop a running shift, green to start one).
const ACTIVE_COLOR = "linear-gradient(155deg, var(--color-accent-300), var(--color-accent-600) 55%, var(--color-accent-700))";
const INACTIVE_COLOR = "linear-gradient(155deg, oklch(74% 0.15 150), oklch(52% 0.13 150) 55%, oklch(36% 0.11 150))";

export function ShiftButton({
  active,
  onStart,
  onEnd,
  busy,
}: {
  active: boolean;
  onStart: () => void;
  onEnd: () => void;
  busy: boolean;
}) {
  // Flashes a checkmark over the button right after a sign-in/out actually
  // goes through — i.e. `active` really flipped once the server confirmed
  // it, not just while `busy` is true — so there's a clear "yes, that
  // registered" moment instead of the label just silently swapping.
  const [justConfirmed, setJustConfirmed] = useState(false);
  const prevActive = useRef(active);
  useEffect(() => {
    if (prevActive.current !== active) {
      prevActive.current = active;
      setJustConfirmed(true);
      const t = setTimeout(() => setJustConfirmed(false), 900);
      return () => clearTimeout(t);
    }
  }, [active]);

  return (
    <button
      type="button"
      className={`btn cta-circle${active ? " is-active" : ""}${justConfirmed ? " is-confirmed" : ""}`}
      disabled={busy}
      onClick={active ? onEnd : onStart}
      data-confirm={active ? "End this shift? This stops the clock." : "Start your shift now?"}
      style={{ background: active ? ACTIVE_COLOR : INACTIVE_COLOR }}
    >
      <span className="cta-circle-check" aria-hidden="true">
        <CheckIcon size={28} />
      </span>
      <span className="cta-circle-label">{active ? "Sign out" : "Sign in"}</span>
    </button>
  );
}

export function ElapsedTimer({ active, signIn }: { active: boolean; signIn: string | null }) {
  const label = useShiftTimer(active, signIn);
  if (!active) return null;
  return <div className="elapsed-timer">{label}</div>;
}
