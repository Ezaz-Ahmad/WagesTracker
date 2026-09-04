import { useRef } from "react";
import type { Screen } from "./types";

const SCREEN_ORDER: Screen[] = ["home", "entry", "spending", "report", "history", "settings"];

/**
 * Capture navigation direction only when the selected screen changes. The
 * class deliberately remains identical on every unrelated render afterwards,
 * otherwise changing the CSS animation name restarts a full-screen entrance
 * animation for a timer/API/context update.
 */
export function useStableScreenTransition(screen: Screen, screenOrder: readonly Screen[] = SCREEN_ORDER): string {
  const transition = useRef<{ screen: Screen; className: string }>({
    screen,
    className: "screen-transition",
  });

  if (transition.current.screen !== screen) {
    const previousIndex = screenOrder.indexOf(transition.current.screen);
    const nextIndex = screenOrder.indexOf(screen);
    transition.current = {
      screen,
      className: `screen-transition ${nextIndex > previousIndex ? "dir-fwd" : "dir-back"}`,
    };
  }

  return transition.current.className;
}
