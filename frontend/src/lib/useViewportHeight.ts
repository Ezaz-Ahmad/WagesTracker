import { useEffect } from "react";
import { startViewportSync } from "./viewportHeight";

/**
 * Keeps `--app-viewport-height` in sync for as long as the app is mounted.
 *
 * Deliberately returns nothing: the measurement reaches the layout through a
 * CSS custom property, not through React state, so a viewport change costs
 * one style write instead of a re-render of the whole tree. Mounted once at
 * the very top of the app (see App.tsx) so the value is already correct on
 * the auth screen — before there's any authenticated shell to size.
 */
export function useViewportHeight(): void {
  useEffect(() => startViewportSync(), []);
}
