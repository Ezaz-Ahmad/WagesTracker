import { useEffect, useState } from "react";

/** True only once `active` has stayed true continuously for at least
 * `delayMs`, and flips back to false the instant `active` does. Lets a slow
 * state escalate to a bigger UI treatment ("this is taking a while, here's
 * why") without flashing that treatment on the common fast path, where
 * `active` is true for a moment and then immediately false again. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return delayed;
}
