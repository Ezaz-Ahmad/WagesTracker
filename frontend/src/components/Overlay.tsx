import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The app's real scrolling element. `.app-main` is the only scroll pane in
 * the authenticated shell (see app.css — `<body>` deliberately isn't
 * scrollable there); everything else, including the auth screen and the
 * admin tree, scrolls the document. */
function scrollContainer(): HTMLElement {
  return (document.querySelector(".app-main") as HTMLElement | null) ?? document.body;
}

/**
 * Renders a modal overlay into `document.body`, and locks whatever is
 * actually scrolling behind it.
 *
 * Both halves fix a real bug, and both come from the same place.
 *
 * **The portal.** App screens can carry entrance transforms (and historically
 * `.swipe-track` itself carried the live swipe/pull transform). A transformed
 * element becomes the containing block for its `position: fixed`
 * descendants, so any overlay rendered inside a screen was fixed to *the
 * track*, not to the viewport. Measured on a 390x844 phone with the sessions
 * sheet open, its `inset: 0` backdrop resolved to a 1218px-tall box starting
 * at y = -477 and inset 16px on each side. Three consequences, all visible:
 * the app header was never covered, so Log out and the earnings-privacy
 * toggle stayed clickable behind an `aria-modal="true"` dialog; there were
 * undimmed strips down both edges; and the sheet travelled with the content
 * when the pane behind it scrolled. Portalling to `document.body` puts the
 * overlay outside every transformed ancestor, which is the only way
 * `position: fixed` can mean what it says.
 *
 * **The scroll lock.** Setting `document.body.style.overflow = "hidden"` is
 * the usual recipe and does nothing here, because in the authenticated shell
 * `<body>` isn't the scroller — `.app-main` is. The page behind scrolled
 * freely under every dialog in the app. Locking the element that actually
 * scrolls is the fix; body is still locked too, for the trees where it *is*
 * the scroller.
 *
 * Both previous values are restored exactly rather than reset to `""`, so
 * nesting an overlay inside another (or opening one while some other code
 * has its own lock in place) can't clear a lock it didn't set.
 */
export function Overlay({ children }: { children: ReactNode }) {
  const lockedRef = useRef<{ el: HTMLElement; previous: string } | null>(null);

  useEffect(() => {
    const el = scrollContainer();
    const previousBody = document.body.style.overflow;
    const previous = el.style.overflow;
    lockedRef.current = { el, previous };

    el.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      const locked = lockedRef.current;
      if (locked) locked.el.style.overflow = locked.previous;
      document.body.style.overflow = previousBody;
      lockedRef.current = null;
    };
  }, []);

  return createPortal(children, document.body);
}
