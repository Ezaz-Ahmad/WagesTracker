import { useEffect, useState } from "react";
import { formatElapsed } from "./date";

export function useShiftTimer(active: boolean, signInHHMM: string | null): string {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active || !signInHHMM) return "00:00:00";
  const [h, m] = signInHHMM.split(":").map(Number);
  const start = new Date();
  start.setHours(h, m, 0, 0);
  return formatElapsed(Date.now() - start.getTime());
}
