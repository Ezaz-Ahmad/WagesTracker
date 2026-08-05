import { useEffect, useState } from "react";

/**
 * Live elapsed hours since `signInHHMM`, ticking every second while `active`.
 * Returns 0 when there's no open shift. Add this to the week's already-saved
 * totals to show earnings/hours climbing in real time during a shift, instead
 * of jumping only once the shift is signed out and persisted.
 */
export function useLiveElapsedHours(active: boolean, signInHHMM: string | null): number {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active || !signInHHMM) return 0;
  const [h, m, s = 0] = signInHHMM.split(":").map(Number);
  const start = new Date();
  start.setHours(h, m, s, 0);
  return Math.max(0, (Date.now() - start.getTime()) / 3_600_000);
}
