import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab/Shift+Tab focus cycling inside a dialog/modal container while
 * `active` is true, moves focus into it the moment it activates, and
 * restores focus to whatever had it beforehand on deactivation/unmount —
 * shared by every modal in the app (ConfirmProvider's popup, the account
 * deletion dialog) instead of each hand-rolling its own version.
 *
 * `onEscape` (optional) is called when Escape is pressed while the trap is
 * active — omit it for a dialog that shouldn't be dismissible that way.
 * Read through a ref internally so passing a new inline function every
 * render doesn't tear down and reattach the trap.
 *
 * `initialFocusRef` (optional) picks which element gets focus on activation
 * instead of the first focusable descendant — e.g. a confirm popup that
 * wants its primary action focused rather than Cancel.
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  const containerRef = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  const initialFocusRefRef = useRef(initialFocusRef);

  useEffect(() => {
    onEscapeRef.current = onEscape;
    initialFocusRefRef.current = initialFocusRef;
  }, [onEscape, initialFocusRef]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    function focusables(): HTMLElement[] {
      if (!container) return [];
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }

    // Move focus inside on activation — the caller's preferred element if it
    // gave one, else the first focusable control, else the container itself
    // (given tabIndex={-1} by the caller).
    const toFocus = initialFocusRefRef.current?.current ?? focusables()[0] ?? container;
    toFocus?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever had it before this dialog opened — guarded
      // against that element having been removed from the document in the
      // meantime (e.g. account deletion signing the user out).
      const prev = previouslyFocused.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [active]);

  return containerRef;
}
