/* ══════════════════════════════════════════════════════════════════════════
   Visual-viewport manager — one place that measures how tall the visible
   viewport actually is and publishes it as a CSS custom property
   (`--app-viewport-height`) for the app shell to size itself from.

   Why this exists at all: `.app-shell` used to be sized purely with
   `100dvh`. `dvh` is resolved by the browser, not by us, and on an
   installed iOS PWA WebKit defers that resolution — after the on-screen
   keyboard closes (most visibly right after a login submitted from the
   keyboard) the shell keeps the *keyboard-era* height until some later
   layout pass forces a recompute, which in practice is the user's first
   scroll/swipe. That's the bug: a short shell leaves a strip of the
   underlying background exposed below the floating bottom nav, and the nav
   snaps down to its correct place on first touch.

   Timing the mount around WebKit's recalculation (blur → wait one resize →
   400ms fallback → fade the shell in) was the previous attempt. It can't
   work in general, for two reasons:
     1. iOS emits a *stream* of `visualViewport.resize` events while the
        keyboard animates away — the first one fires within a frame or two,
        with the keyboard barely moved, so "wait for one resize" resolves
        against an intermediate viewport.
     2. Even with perfect timing, the height still comes from a unit the
        browser owns. An opacity fade forces re-*composite*, not re-*layout*
        — recompositing a box that was laid out at the wrong height just
        repaints the same wrong height, which is why the fade never fixed it.

   So: measure it ourselves. `visualViewport.height` is a number we read at
   the moment we choose, and a CSS variable set from JS can never be stale
   in the way a browser-resolved unit can. `100dvh` stays as the CSS
   fallback for the very first paint and for anything that never runs JS.

   On `offsetTop`: the visual viewport is also *offset* within the layout
   viewport while iOS scrolls a focused field into view, and it moves during
   the keyboard animation. We deliberately do not translate the shell by it
   — the root document never scrolls here (`.app-main` is the only scroller,
   `.app-shell` is exactly viewport-height with `overflow: hidden`), so in
   the settled state it is 0, and compensating for it during rubber-band
   would mean fighting the compositor again. It *is* however read as part of
   the settle signature below: a viewport whose offset is still changing is
   still moving, even if its height momentarily isn't. It's also published
   as `--app-viewport-offset-top` so a future layout can use it without
   re-deriving any of this.
   ══════════════════════════════════════════════════════════════════════ */

/** Set on `<html>`; consumed by `.app-shell` (see styles/app.css). */
export const VIEWPORT_HEIGHT_VAR = "--app-viewport-height";
/** Published for completeness/diagnostics — nothing positions off it today. */
export const VIEWPORT_OFFSET_TOP_VAR = "--app-viewport-offset-top";

/** `innerHeight - visualViewport.height` above this many px is taken as "an
 * on-screen keyboard (or similar inset UI) is currently covering part of the
 * viewport". Small values are just toolbar/rubber-band noise. */
export const KEYBOARD_INSET_THRESHOLD_PX = 80;

/** How long the viewport must stop changing before it counts as settled. */
export const SETTLE_QUIET_MS = 160;
/** Hard ceiling on a settle wait, so authentication can never hang waiting
 * on an iOS event that (for whatever reason) never arrives. */
export const SETTLE_MAX_WAIT_MS = 900;
/** Polling cadence during a settle wait — iOS does not always emit an event
 * for the final step of the keyboard animation, so events alone aren't
 * enough to notice that things have gone quiet. */
export const SETTLE_POLL_MS = 40;

/** Re-measure this long after events that change geometry *after* they fire
 * (rotation, restore from background, keyboard-closing blur) — iOS reports
 * pre-change numbers during the event turn itself. */
const DEFERRED_RESYNC_MS = [120, 340];

export interface ViewportMetrics {
  /** Visible height in CSS px — `visualViewport.height`, else `innerHeight`. */
  height: number;
  /** Visual viewport's vertical offset inside the layout viewport. */
  offsetTop: number;
  /** How much of the layout viewport is currently covered (keyboard, etc.). */
  keyboardInset: number;
}

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * The single measurement point. `visualViewport.height` is the real visible
 * height on iOS (it, and only it, shrinks for the keyboard); `innerHeight`
 * is the fallback for browsers without the API — and for jsdom, where the
 * API is absent unless a test installs it.
 */
export function readViewportMetrics(): ViewportMetrics {
  if (!hasWindow()) return { height: 0, offsetTop: 0, keyboardInset: 0 };
  const innerHeight = typeof window.innerHeight === "number" ? window.innerHeight : 0;
  const vv = window.visualViewport;
  const vvHeight = vv && typeof vv.height === "number" ? vv.height : 0;
  const height = vvHeight > 0 ? vvHeight : innerHeight;
  const offsetTop = vv && typeof vv.offsetTop === "number" ? vv.offsetTop : 0;
  return { height, offsetTop, keyboardInset: Math.max(0, innerHeight - height) };
}

/** True when focus is somewhere that would raise an on-screen keyboard. */
export function isEditableElementFocused(): boolean {
  if (!hasWindow()) return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return false;
  // A read-only field can still take focus but raises no keyboard on iOS.
  // (Disabled fields can't be focused at all, so there's nothing to check.)
  const field = el as HTMLInputElement;
  return field.readOnly !== true;
}

/** Does this device plausibly have a *software* keyboard at all? Used to
 * keep desktop logins on the zero-delay path: a focused password field on a
 * laptop is not a keyboard that has to animate away. */
export function isSoftKeyboardCapable(): boolean {
  if (!hasWindow()) return false;
  const nav = window.navigator;
  if (nav && typeof nav.maxTouchPoints === "number" && nav.maxTouchPoints > 0) return true;
  if (typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  }
  return false;
}

/** Measurably true: part of the viewport is currently covered. */
export function isKeyboardMeasurablyOpen(): boolean {
  return readViewportMetrics().keyboardInset > KEYBOARD_INSET_THRESHOLD_PX;
}

/**
 * Whether the published height should be *held* at its last value rather
 * than following the current measurement.
 *
 * Both signals matter. In Safari's browser mode the keyboard shrinks the
 * visual viewport only, so the measured inset catches it. In an installed
 * PWA iOS has been observed to resize the window itself, which makes that
 * inset ~0 — there the focus check is what catches it. Holding in either
 * case is what keeps the bottom nav from jumping upward the moment a field
 * in Entry or Settings is tapped.
 */
export function shouldHoldPublishedHeight(): boolean {
  return isKeyboardMeasurablyOpen() || isEditableElementFocused();
}

/**
 * Whether an auth transition needs to wait for the viewport to settle.
 * A measured keyboard always counts; a focused field only counts on a
 * touch-capable device (see isSoftKeyboardCapable).
 */
export function shouldWaitForKeyboardClose(): boolean {
  if (isKeyboardMeasurablyOpen()) return true;
  return isEditableElementFocused() && isSoftKeyboardCapable();
}

/* ── CSS variable writing ─────────────────────────────────────────────── */

let pendingFrame: number | null = null;

function cancelPendingFrame(): void {
  if (pendingFrame === null) return;
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/** Inline-style read, so there is no module-level cache to go stale (or to
 * leak between tests) and no layout flush — and no redundant style write
 * when the value hasn't actually moved. */
function setVar(root: HTMLElement, name: string, value: string): void {
  if (root.style.getPropertyValue(name) === value) return;
  root.style.setProperty(name, value);
}

function writeViewportMetrics(force: boolean): void {
  if (!hasWindow()) return;
  const root = document.documentElement;
  if (!root) return;
  const { height, offsetTop } = readViewportMetrics();
  if (height > 0 && (force || !shouldHoldPublishedHeight())) {
    setVar(root, VIEWPORT_HEIGHT_VAR, px(height));
  }
  setVar(root, VIEWPORT_OFFSET_TOP_VAR, px(offsetTop));
}

/**
 * Publish the current measurement. Batched into one animation frame by
 * default so a burst of resize/scroll events costs a single style write and
 * zero React renders; `immediate` skips the frame for the cases that must
 * be correct *before* the next paint (initial mount, and the moment just
 * before the authed shell is allowed to appear).
 *
 * `force` publishes even while a keyboard is open — only used where the
 * geometry genuinely changed underneath us (orientation), so that a held
 * portrait height can't survive into landscape.
 */
export function syncViewportHeight(options: { immediate?: boolean; force?: boolean } = {}): void {
  if (!hasWindow()) return;
  const force = options.force === true;
  if (options.immediate || typeof requestAnimationFrame !== "function") {
    cancelPendingFrame();
    writeViewportMetrics(force);
    return;
  }
  if (pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    writeViewportMetrics(force);
  });
}

/**
 * Attach every listener that can indicate the visible height changed, and
 * keep `--app-viewport-height` in step with all of them. Returns a cleanup
 * that removes the listeners, clears the deferred timers, and drops the
 * pending frame — after which nothing here writes to the DOM again.
 */
export function startViewportSync(): () => void {
  if (!hasWindow()) return () => {};

  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const handle = (): void => {
    if (!disposed) syncViewportHeight();
  };

  /** For events whose effect lands *after* the event turn. */
  const handleDeferred = (force = false): void => {
    if (disposed) return;
    syncViewportHeight({ force });
    for (const delay of DEFERRED_RESYNC_MS) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!disposed) syncViewportHeight({ immediate: true, force });
      }, delay);
      timers.add(timer);
    }
  };

  const handleOrientation = (): void => handleDeferred(true);
  const handleRestore = (): void => handleDeferred(false);
  const handleVisibility = (): void => {
    if (document.visibilityState === "visible") handleDeferred(false);
  };

  const vv = window.visualViewport;
  vv?.addEventListener("resize", handle);
  vv?.addEventListener("scroll", handle);
  window.addEventListener("resize", handle);
  window.addEventListener("orientationchange", handleOrientation);
  window.addEventListener("pageshow", handleRestore);
  window.addEventListener("focusin", handle);
  // Blur is when a keyboard starts closing — the deferred re-measures are
  // what catch the height it lands on (the long-standing "gap after blurring
  // the fuel-cost field" case, same root cause as the login one).
  window.addEventListener("focusout", handleRestore);
  document.addEventListener("visibilitychange", handleVisibility);

  syncViewportHeight({ immediate: true });

  return () => {
    disposed = true;
    vv?.removeEventListener("resize", handle);
    vv?.removeEventListener("scroll", handle);
    window.removeEventListener("resize", handle);
    window.removeEventListener("orientationchange", handleOrientation);
    window.removeEventListener("pageshow", handleRestore);
    window.removeEventListener("focusin", handle);
    window.removeEventListener("focusout", handleRestore);
    document.removeEventListener("visibilitychange", handleVisibility);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    cancelPendingFrame();
  };
}

/* ── settle detection ─────────────────────────────────────────────────── */

/**
 * Resolve once the visual viewport has stopped moving — height *and*
 * offsetTop unchanged for `quietMs` — rather than on the first change event.
 * That distinction is the whole point: iOS fires several resizes while the
 * keyboard animates, and the first is an intermediate frame.
 *
 * Guards, in order of importance:
 *  - a still-measurably-open keyboard never counts as settled, however
 *    steady its numbers look for a moment;
 *  - `maxWaitMs` always resolves, so a missing event can't strand the
 *    caller;
 *  - the final measurement is published synchronously before resolving, so
 *    whatever mounts next is laid out against it.
 */
export function waitForViewportSettle(
  options: { quietMs?: number; maxWaitMs?: number; pollMs?: number } = {}
): Promise<void> {
  const quietMs = options.quietMs ?? SETTLE_QUIET_MS;
  const maxWaitMs = options.maxWaitMs ?? SETTLE_MAX_WAIT_MS;
  const pollMs = options.pollMs ?? SETTLE_POLL_MS;

  if (!hasWindow()) return Promise.resolve();

  const vv = window.visualViewport;
  if (!vv) {
    // No API to watch: nothing meaningful to wait for, so don't invent a
    // delay — just make sure the fallback measurement is published.
    syncViewportHeight({ immediate: true });
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const signature = (): string => {
      const { height, offsetTop } = readViewportMetrics();
      return `${Math.round(height)}:${Math.round(offsetTop)}`;
    };

    let done = false;
    let last = signature();
    let lastChangeAt = Date.now();

    const finish = (): void => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(deadline);
      vv.removeEventListener("resize", check);
      vv.removeEventListener("scroll", check);
      syncViewportHeight({ immediate: true });
      resolve();
    };

    function check(): void {
      if (done) return;
      const current = signature();
      if (current !== last) {
        last = current;
        lastChangeAt = Date.now();
        return;
      }
      // Steady numbers with the keyboard still visibly covering the viewport
      // means the animation hasn't started/finished, not that we're done.
      if (isKeyboardMeasurablyOpen()) return;
      if (Date.now() - lastChangeAt >= quietMs) finish();
    }

    vv.addEventListener("resize", check);
    vv.addEventListener("scroll", check);
    const poll = setInterval(check, pollMs);
    const deadline = setTimeout(finish, maxWaitMs);
  });
}

/**
 * The auth transition's viewport step: blur whatever is focused (which is
 * what starts the keyboard closing), wait for the viewport to actually
 * settle, then publish the settled height — so the authenticated shell is
 * only ever mounted against a measurement that is already correct.
 *
 * Skipped entirely when there is no software keyboard in play (desktop, or
 * a token auto-login with nothing focused), where it costs nothing.
 */
export async function settleViewportBeforeAuth(options?: {
  quietMs?: number;
  maxWaitMs?: number;
  pollMs?: number;
}): Promise<void> {
  if (!hasWindow()) return;
  const mustWait = shouldWaitForKeyboardClose();
  (document.activeElement as HTMLElement | null)?.blur?.();
  if (!mustWait) {
    syncViewportHeight({ immediate: true });
    return;
  }
  await waitForViewportSettle(options);
}
