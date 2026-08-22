/* ══════════════════════════════════════════════════════════════════════════
   Visual-viewport manager — measures how tall the visible viewport actually
   is and publishes it as `--app-viewport-height` for the app shell to size
   itself from.

   ── Why measuring at all ────────────────────────────────────────────────
   `.app-shell` used to be sized purely with `100dvh`, a unit the browser
   resolves on its own schedule. In an installed iOS PWA that resolution is
   deferred after the keyboard closes, so the shell kept a keyboard-era
   height until some later layout pass — in practice the user's first swipe.
   A JS measurement published as a custom property can't go stale that way.

   ── Why a *baseline*, and not just a measurement ────────────────────────
   The first attempt measured correctly but trusted the wrong moment. It
   decided "is a keyboard covering the viewport?" from

       window.innerHeight - visualViewport.height > threshold

   which is right in Safari's browser mode, where the keyboard shrinks the
   visual viewport only. In an installed standalone PWA iOS shrinks *both*
   together:

       before keyboard:  innerHeight 900, visualViewport.height 900
       during/after:     innerHeight 760, visualViewport.height 760

   The computed inset is then ~0. With the login field already blurred there
   is no focused editable either, so every signal said "unobstructed" and the
   shortened 760 was published as the app height — including by the settle
   step's final immediate sync and by the deferred focus-out re-measures. The
   shell was then 140px short, the bottom nav sat that far too high, and the
   first swipe made iOS emit fresh viewport information that finally
   corrected it.

   The fix is to stop treating any single measurement as authoritative.
   We retain the last height measured while the viewport was *known* to be
   unobstructed (the baseline), arm a recovery guard before the login field
   is blurred (before, because focus state is itself one of the signals), and
   while that guard is up we refuse to publish anything materially shorter
   than the baseline no matter what the inset arithmetic says. Every path
   that can write the variable goes through one decision function, so there
   is no back door: not the deferred focus-out timers, not the settle
   step's finalisation, not the timeout path.

   A guard that never released would be its own bug, so it releases on real
   evidence (height back at the baseline, offsetTop back at zero, held still
   for a quiet period), on a genuine geometry change (orientation/width), or
   — as a last resort so a legitimately-shorter viewport can't be held
   hostage forever — after GUARD_MAX_HOLD_MS with a long stable measurement,
   which then becomes the new baseline.

   ── On offsetTop ────────────────────────────────────────────────────────
   Nothing translates by it: the root never scrolls here (`.app-main` is the
   only scroller, `.app-shell` is exactly viewport-height with `overflow:
   hidden`), so at rest it is 0, and compensating during rubber-band would
   mean fighting the compositor. It is used as *evidence* — a non-zero
   offset means iOS is still moving the viewport, so a measurement taken
   then is not trustworthy — and published as `--app-viewport-offset-top`.
   ══════════════════════════════════════════════════════════════════════ */

/** Set on `<html>`; consumed by `.app-shell` (see styles/app.css). */
export const VIEWPORT_HEIGHT_VAR = "--app-viewport-height";
/** Published for diagnostics — nothing positions off it today. */
export const VIEWPORT_OFFSET_TOP_VAR = "--app-viewport-offset-top";

/** `innerHeight - visualViewport.height` above this many px means a keyboard
 * (or similar inset UI) is covering part of the viewport. Only ever *adds*
 * confidence that something is obstructing: an inset of ~0 proves nothing,
 * which is precisely what the standalone-PWA bug taught us. */
export const KEYBOARD_INSET_THRESHOLD_PX = 80;

/** Rounding slack when comparing a measurement against the baseline. Small:
 * the real failure is off by >100px, and a large tolerance would let a
 * genuinely shortened viewport slip through as "recovered". */
export const BASELINE_TOLERANCE_PX = 4;

/** Ignore fractional/tiny steady-state height noise from iOS. A 1–2px
 * visualViewport fluctuation is not a meaningful geometry change, but writing
 * it into the shell height forces a full layout and can look like a shake. */
export const STEADY_STATE_HEIGHT_TOLERANCE_PX = 2;

/** How close to zero `offsetTop` must be to count as "not moving". */
export const OFFSET_TOLERANCE_PX = 2;

/** How long the viewport must stop changing before it counts as settled. */
export const SETTLE_QUIET_MS = 160;
/** Hard ceiling on a settle wait, so authentication can never hang waiting
 * on an iOS event that never arrives. Timing out does NOT publish whatever
 * happened to be measured at that moment — the baseline stands. */
export const SETTLE_MAX_WAIT_MS = 900;
/** Polling cadence during a settle wait: iOS does not always emit an event
 * for the last step of the keyboard animation, so events alone can't tell us
 * that things have gone quiet. */
export const SETTLE_POLL_MS = 40;

/** Longest a *normal* recovery guard will hold the baseline against a
 * shorter measurement. Past this, a measurement that has been stable for
 * GUARD_STABLE_ACCEPT_MS is accepted as a real change and becomes the new
 * baseline — otherwise a viewport that legitimately got shorter (and never
 * returns) would be held wrong indefinitely.
 *
 * This escape hatch does NOT apply to a `strict-auth` guard. That exclusion
 * is the fix for the second on-device failure: `focusout` arms a guard the
 * moment the Login button is tapped, and this backend cold-starts, so the
 * request routinely takes longer than six seconds (that's what
 * WakingUpScreen exists for). The guard would age past this limit while the
 * request was still in flight, and the first evaluation after it landed
 * would take the escape hatch and adopt the keyboard-era height as the new
 * baseline — the exact value being guarded against. */
export const GUARD_MAX_HOLD_MS = 6000;
/** How long a shorter-than-baseline measurement must hold still before the
 * long-hold escape hatch above will accept it. */
export const GUARD_STABLE_ACCEPT_MS = 500;

/** A rotation isn't instantaneous; treat this window after an
 * orientationchange as "geometry in flux". */
export const ORIENTATION_SETTLE_MS = 700;

/** Re-measure this long after events whose effect lands *after* they fire
 * (rotation, restore from background, keyboard-closing blur) — iOS reports
 * pre-change numbers during the event turn itself. */
const DEFERRED_RESYNC_MS = [120, 340, 700];

/* ── types ────────────────────────────────────────────────────────────── */

export interface ViewportMetrics {
  /** Visible height in CSS px — `visualViewport.height`, else `innerHeight`. */
  height: number;
  /** Visual viewport's vertical offset inside the layout viewport. */
  offsetTop: number;
  /** Layout viewport height (`window.innerHeight`). */
  innerHeight: number;
  /** `documentElement.clientHeight` — diagnostic only, never a source. */
  clientHeight: number;
  /** How much of the layout viewport is covered. ~0 tells us nothing. */
  keyboardInset: number;
  /** Layout viewport width — the baseline is keyed to this. */
  width: number;
  /** `visualViewport.scale` — 1 unless the user (or iOS input auto-zoom) has
   * zoomed. Evidence, not geometry: nothing positions off it. It is used for
   * exactly one decision — a zoomed viewport reports a smaller visible
   * height, which is a measurement about the zoom, not about the app, so it
   * must not be published. */
  scale: number;
}

/**
 * `normal` — the everyday keyboard-close guard (any blur, any mode). It can
 * eventually concede that a shorter viewport is the real one.
 *
 * `strict-auth` — the installed-PWA login/signup transition. It never
 * concedes: on this path a shorter same-width viewport is always iOS
 * reporting a stale keyboard-era height, and adopting it is the bug. It
 * releases only on genuine evidence (height back at the baseline with the
 * offset back at zero) or a real width/orientation change. Scoped to
 * standalone mode so Safari's legitimately-variable toolbar height is
 * unaffected.
 */
export type RecoveryMode = "normal" | "strict-auth";

export type PublishReason =
  | "forced"
  | "unobstructed"
  | "recovered"
  | "recovery-long-hold-accepted"
  | "geometry-changed"
  | "no-measurement"
  | "keyboard-inset"
  | "editable-focused"
  | "orientation-in-flux"
  | "recovery-holding-baseline"
  | "recovery-offset-nonzero"
  | "viewport-zoomed"
  | "steady-state-jitter";

export interface PublishDecision {
  publish: boolean;
  height: number;
  reason: PublishReason;
}

export type SettleReason =
  | "no-viewport-api"
  | "nothing-to-wait-for"
  | "recovered"
  | "stable"
  | "timed-out"
  | "geometry-changed";

export interface SettleResult {
  reason: SettleReason;
  /** The height that ended up published (i.e. what the shell will use). */
  publishedHeight: number | null;
  baseline: number | null;
  elapsedMs: number;
}

interface Baseline {
  height: number;
  /** Baselines don't survive a rotation — a portrait height is meaningless
   * in landscape. Keyed by layout width, which changes on rotation. */
  width: number;
}

interface RecoveryState {
  armedAt: number;
  source: string;
  mode: RecoveryMode;
  lastSignature: string;
  lastChangeAt: number;
}

/* ── module state ─────────────────────────────────────────────────────── */

let baseline: Baseline | null = null;
let recovery: RecoveryState | null = null;
let orientationInFluxUntil = 0;
let pendingFrame: number | null = null;
let pendingSource = "scheduled";
let lastDecision: PublishDecision | null = null;
let lastSettle: SettleResult | null = null;

/** Full reset — used by tests, and by nothing else. */
export function resetViewportState(): void {
  baseline = null;
  recovery = null;
  orientationInFluxUntil = 0;
  lastDecision = null;
  lastSettle = null;
  cancelPendingFrame();
  clearEventLog();
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.style.removeProperty(VIEWPORT_HEIGHT_VAR);
    document.documentElement.style.removeProperty(VIEWPORT_OFFSET_TOP_VAR);
  }
}

/* ── diagnostics event log (tiny, always on, never holds user data) ───── */

export interface ViewportEvent {
  at: number;
  kind: string;
  detail: string;
}

const EVENT_LOG_LIMIT = 60;
let eventLog: ViewportEvent[] = [];
const eventListeners = new Set<() => void>();

function logEvent(kind: string, detail: string): void {
  eventLog.push({ at: Date.now(), kind, detail });
  if (eventLog.length > EVENT_LOG_LIMIT) eventLog = eventLog.slice(-EVENT_LOG_LIMIT);
  for (const listener of eventListeners) listener();
}

function clearEventLog(): void {
  eventLog = [];
  for (const listener of eventListeners) listener();
}

export function getViewportEventLog(): readonly ViewportEvent[] {
  return eventLog;
}

/** Subscribe to state changes (the debug overlay's only data source). */
export function subscribeViewportDiagnostics(listener: () => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/* ── environment probes ───────────────────────────────────────────────── */

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** The single measurement point. */
export function readViewportMetrics(): ViewportMetrics {
  if (!hasWindow()) {
    return { height: 0, offsetTop: 0, innerHeight: 0, clientHeight: 0, keyboardInset: 0, width: 0, scale: 1 };
  }
  const innerHeight = typeof window.innerHeight === "number" ? window.innerHeight : 0;
  const width = typeof window.innerWidth === "number" ? window.innerWidth : 0;
  const clientHeight = document.documentElement?.clientHeight ?? 0;
  const vv = window.visualViewport;
  const vvHeight = vv && typeof vv.height === "number" ? vv.height : 0;
  const height = vvHeight > 0 ? vvHeight : innerHeight;
  const offsetTop = vv && typeof vv.offsetTop === "number" ? vv.offsetTop : 0;
  const scale = vv && typeof vv.scale === "number" && vv.scale > 0 ? vv.scale : 1;
  return {
    height,
    offsetTop,
    innerHeight,
    clientHeight,
    keyboardInset: Math.max(0, innerHeight - height),
    width,
    scale,
  };
}

/** True when focus is somewhere that would raise an on-screen keyboard. */
export function isEditableElementFocused(): boolean {
  if (!hasWindow()) return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return false;
  // A read-only field can take focus but raises no keyboard on iOS.
  return (el as HTMLInputElement).readOnly !== true;
}

/** Element type only — never its value, name, or contents. */
export function describeFocusedElement(): string {
  if (!hasWindow()) return "none";
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return "none";
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const type = (el as HTMLInputElement).type || "text";
    return `input[type=${type}]`;
  }
  if (el.isContentEditable) return "contenteditable";
  return tag;
}

/** Does this device plausibly have a *software* keyboard at all? Keeps
 * desktop logins on the zero-delay path. */
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

/** Installed / standalone launch, by either the standard or the iOS API. */
export function isStandalonePWA(): boolean {
  if (!hasWindow()) return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  if (iosStandalone === true) return true;
  if (typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(display-mode: standalone)").matches;
    } catch {
      return false;
    }
  }
  return false;
}

/** Measurably true — never used as proof of the *absence* of a keyboard. */
export function isKeyboardMeasurablyOpen(): boolean {
  return readViewportMetrics().keyboardInset > KEYBOARD_INSET_THRESHOLD_PX;
}

/* ── the recovery guard ───────────────────────────────────────────────── */

export function isKeyboardRecoveryActive(): boolean {
  return recovery !== null;
}

export function getUnobstructedBaseline(): number | null {
  return baseline?.height ?? null;
}

/**
 * Arm the keyboard-closing guard. Must be called *before* `blur()`, because
 * focus is one of the signals used to decide whether a measurement is
 * trustworthy — arming afterwards would leave the exact window this exists
 * to protect (blurred field, zero computed inset, shortened viewport)
 * unguarded.
 */
export function armKeyboardRecovery(source: string = "keyboard-close", mode: RecoveryMode = "normal"): void {
  if (!hasWindow()) return;
  const metrics = readViewportMetrics();
  const now = Date.now();

  if (recovery) {
    // Re-arming RESETS the clock — it does not merely relabel the existing
    // guard. `focusout` arms one the instant the Login button is tapped, and
    // this backend cold-starts, so by the time the auth path re-arms, the
    // original guard can already be older than GUARD_MAX_HOLD_MS. Inheriting
    // that age handed the long-hold escape hatch the stale keyboard-era
    // height on the very next evaluation.
    recovery.armedAt = now;
    recovery.lastChangeAt = now;
    recovery.lastSignature = signatureOf(metrics);
    recovery.source = source;
    // Modes only ever escalate: once a transition is strict it stays strict
    // until the guard is released, so a stray `focusout` can't downgrade it.
    if (mode === "strict-auth") recovery.mode = "strict-auth";
    logEvent("guard", `re-armed (${source}, ${recovery.mode}) — clock reset`);
    return;
  }

  recovery = {
    armedAt: now,
    source,
    mode,
    lastSignature: signatureOf(metrics),
    lastChangeAt: now,
  };
  logEvent(
    "guard",
    `armed (${source}, ${mode}) baseline=${baseline ? Math.round(baseline.height) : "none"}`
  );
}

/** Which mode the live guard is in, if any. */
export function getRecoveryMode(): RecoveryMode | null {
  return recovery?.mode ?? null;
}

function releaseKeyboardRecovery(reason: string): void {
  if (!recovery) return;
  recovery = null;
  logEvent("guard", `released (${reason})`);
}

function signatureOf(metrics: ViewportMetrics): string {
  return `${Math.round(metrics.height)}:${Math.round(metrics.offsetTop)}:${Math.round(metrics.width)}`;
}

/* ── the one decision function ────────────────────────────────────────── */

/**
 * Decide whether a measurement may become the published app height. Every
 * write path calls this — initial mount, window resize, visualViewport
 * resize/scroll, focusin, focusout, the deferred focus-out timers, the
 * settle step's finalisation, pageshow, visibility restore, orientation.
 * There is intentionally no way to publish that bypasses it except an
 * explicit `force`, which only the confirmed-geometry-change path uses.
 */
export function evaluatePublish(
  metrics: ViewportMetrics = readViewportMetrics(),
  options: { force?: boolean } = {}
): PublishDecision {
  const now = Date.now();

  // A width change means a different viewport entirely (rotation, or a
  // desktop window resize). The old baseline describes something that no
  // longer exists, so it is discarded rather than defended.
  if (baseline && metrics.width > 0 && baseline.width !== metrics.width) {
    baseline = null;
    releaseKeyboardRecovery("geometry-changed");
    logEvent("baseline", `dropped (width ${metrics.width})`);
  }

  if (options.force) {
    return { publish: true, height: metrics.height, reason: "forced" };
  }
  if (!(metrics.height > 0)) {
    return { publish: false, height: metrics.height, reason: "no-measurement" };
  }

  // Mid-rotation numbers are not to be trusted in either direction.
  if (now < orientationInFluxUntil) {
    return { publish: false, height: metrics.height, reason: "orientation-in-flux" };
  }

  // While the page is zoomed (pinch, or iOS auto-zooming a sub-16px field),
  // `visualViewport.height` describes the zoom, not the app. Publishing it
  // would shrink the shell to whatever fraction is currently on screen. This
  // is the only decision `scale` takes part in — nothing is positioned from
  // it, and pinch-zoom itself stays available (see index.html's viewport
  // meta, deliberately left without user-scalable=no).
  if (Math.abs(metrics.scale - 1) > 0.01) {
    return { publish: false, height: metrics.height, reason: "viewport-zoomed" };
  }

  // Positive evidence of an obstruction: hold whatever is published so the
  // bottom nav doesn't hop up on top of the keyboard.
  if (metrics.keyboardInset > KEYBOARD_INSET_THRESHOLD_PX) {
    return { publish: false, height: metrics.height, reason: "keyboard-inset" };
  }
  if (isEditableElementFocused()) {
    return { publish: false, height: metrics.height, reason: "editable-focused" };
  }

  if (recovery) {
    const signature = signatureOf(metrics);
    if (signature !== recovery.lastSignature) {
      recovery.lastSignature = signature;
      recovery.lastChangeAt = now;
    }

    const base = baseline?.height ?? null;

    // THE bug: with both innerHeight and visualViewport.height shortened
    // together the inset is ~0 and nothing is focused, so every other signal
    // says "safe to publish". The baseline is the only thing that knows
    // better.
    if (base !== null && metrics.height < base - BASELINE_TOLERANCE_PX) {
      const heldFor = now - recovery.armedAt;
      const stableFor = now - recovery.lastChangeAt;
      // The escape hatch exists for a viewport that legitimately got shorter
      // and isn't coming back — Safari's toolbar expanding, say. It must NOT
      // apply to a strict standalone-PWA auth transition, where a shorter
      // same-width viewport is only ever iOS still reporting the keyboard-era
      // height. There, a slow login simply waits; it never concedes.
      if (
        recovery.mode !== "strict-auth" &&
        heldFor >= GUARD_MAX_HOLD_MS &&
        stableFor >= GUARD_STABLE_ACCEPT_MS
      ) {
        return { publish: true, height: metrics.height, reason: "recovery-long-hold-accepted" };
      }
      return { publish: false, height: metrics.height, reason: "recovery-holding-baseline" };
    }

    // Still moving — a displaced visual viewport is not a settled one.
    if (Math.abs(metrics.offsetTop) > OFFSET_TOLERANCE_PX) {
      return { publish: false, height: metrics.height, reason: "recovery-offset-nonzero" };
    }

    return { publish: true, height: metrics.height, reason: "recovered" };
  }

  if (
    baseline &&
    metrics.width === baseline.width &&
    metrics.height !== baseline.height &&
    Math.abs(metrics.height - baseline.height) <= STEADY_STATE_HEIGHT_TOLERANCE_PX
  ) {
    return { publish: false, height: metrics.height, reason: "steady-state-jitter" };
  }

  return { publish: true, height: metrics.height, reason: "unobstructed" };
}

/* ── writing ──────────────────────────────────────────────────────────── */

function cancelPendingFrame(): void {
  if (pendingFrame === null) return;
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/** Inline-style read, so there's no module cache to go stale and no layout
 * flush — and no redundant write when the value hasn't moved. */
function setVar(root: HTMLElement, name: string, value: string): boolean {
  if (root.style.getPropertyValue(name) === value) return false;
  root.style.setProperty(name, value);
  return true;
}

export function getPublishedHeightPx(): number | null {
  if (!hasWindow() || !document.documentElement) return null;
  const raw = document.documentElement.style.getPropertyValue(VIEWPORT_HEIGHT_VAR);
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyDecision(force: boolean, source: string): PublishDecision {
  const metrics = readViewportMetrics();
  const decision = evaluatePublish(metrics, { force });
  lastDecision = decision;

  const root = document.documentElement;
  const previousHeight = getPublishedHeightPx();
  let wroteHeight = false;
  if (root) {
    if (decision.publish) {
      wroteHeight = setVar(root, VIEWPORT_HEIGHT_VAR, px(decision.height));
      baseline = { height: decision.height, width: metrics.width };
      if (decision.reason === "recovered" || decision.reason === "recovery-long-hold-accepted") {
        releaseKeyboardRecovery(decision.reason);
      }
    }
    setVar(root, VIEWPORT_OFFSET_TOP_VAR, px(metrics.offsetTop));
  }

  logEvent(
    "publish",
    `${wroteHeight ? "write" : decision.publish ? "unchanged" : "hold"}` +
      ` old=${previousHeight ?? "none"} new=${Math.round(decision.height * 100) / 100}` +
      ` source=${source} reason=${decision.reason}` +
      ` vv=${Math.round(metrics.height * 100) / 100} inner=${Math.round(metrics.innerHeight * 100) / 100}`
  );
  return decision;
}

/**
 * Publish the current measurement, subject to `evaluatePublish`. Batched
 * into one animation frame by default so a burst of events costs a single
 * style write and zero React renders; `immediate` skips the frame for cases
 * that must be correct before the next paint. `force` is for a confirmed
 * geometry change only.
 */
export function syncViewportHeight(options: { immediate?: boolean; force?: boolean; source?: string } = {}): void {
  if (!hasWindow()) return;
  const force = options.force === true;
  const source = options.source ?? "manual";
  if (options.immediate || typeof requestAnimationFrame !== "function") {
    cancelPendingFrame();
    applyDecision(force, source);
    return;
  }
  pendingSource = source;
  if (pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    applyDecision(force, pendingSource);
  });
}

/* ── listener lifecycle ───────────────────────────────────────────────── */

/**
 * Attach every listener that can indicate the visible height changed, and
 * keep the variable in step with all of them — each one going through the
 * same decision function, including the deferred timers. Returns a cleanup
 * that removes the listeners, clears the timers and drops the pending frame,
 * after which nothing here writes to the DOM again.
 */
export function startViewportSync(): () => void {
  if (!hasWindow()) return () => {};

  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const handle = (kind: string) => (): void => {
    if (disposed) return;
    logEvent("event", kind);
    syncViewportHeight({ source: kind });
  };

  /** For events whose effect lands after the event turn. */
  const handleDeferred = (kind: string, force = false) => (): void => {
    if (disposed) return;
    logEvent("event", kind);
    syncViewportHeight({ force, source: kind });
    for (const delay of DEFERRED_RESYNC_MS) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (disposed) return;
        // Deliberately NOT forced: the deferred re-measures were one of the
        // paths that published the stale shortened height, so they get the
        // same scrutiny as everything else.
        syncViewportHeight({ immediate: true, source: `${kind}.deferred-${delay}` });
      }, delay);
      timers.add(timer);
    }
  };

  const handleOrientation = (): void => {
    if (disposed) return;
    orientationInFluxUntil = Date.now() + ORIENTATION_SETTLE_MS;
    baseline = null;
    releaseKeyboardRecovery("orientation");
    logEvent("event", "orientationchange");
    for (const delay of [...DEFERRED_RESYNC_MS, ORIENTATION_SETTLE_MS + 60]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!disposed) syncViewportHeight({ immediate: true, source: `orientationchange.deferred-${delay}` });
      }, delay);
      timers.add(timer);
    }
  };

  const handleFocusOut = (): void => {
    if (disposed) return;
    // A blur is a keyboard starting to close — the same situation the login
    // transition arms explicitly. Arming here covers every other field in
    // the app (Entry's numeric inputs, Settings' forms) with no per-screen
    // wiring.
    armKeyboardRecovery("focusout");
    handleDeferred("focusout")();
  };

  const handleVisibility = (): void => {
    if (disposed) return;
    if (document.visibilityState === "visible") handleDeferred("visible")();
  };

  const onVvResize = handle("visualViewport.resize");
  const onVvScroll = handle("visualViewport.scroll");
  const onResize = handle("window.resize");
  const onFocusIn = handle("focusin");
  const onPageShow = handleDeferred("pageshow");

  const vv = window.visualViewport;
  vv?.addEventListener("resize", onVvResize);
  vv?.addEventListener("scroll", onVvScroll);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", handleOrientation);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("focusin", onFocusIn);
  window.addEventListener("focusout", handleFocusOut);
  document.addEventListener("visibilitychange", handleVisibility);

  logEvent("lifecycle", `sync started standalone=${isStandalonePWA()}`);
  syncViewportHeight({ immediate: true, source: "sync-start" });

  return () => {
    disposed = true;
    vv?.removeEventListener("resize", onVvResize);
    vv?.removeEventListener("scroll", onVvScroll);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", handleOrientation);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("focusin", onFocusIn);
    window.removeEventListener("focusout", handleFocusOut);
    document.removeEventListener("visibilitychange", handleVisibility);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    cancelPendingFrame();
    logEvent("lifecycle", "sync stopped");
  };
}

/* ── settle detection ─────────────────────────────────────────────────── */

function finishSettle(reason: SettleReason, startedAt: number): SettleResult {
  // Guarded, never forced: if the viewport is still reporting the shortened
  // height at this point, the baseline stays published and the guard stays
  // up to catch the real recovery whenever it arrives.
  syncViewportHeight({ immediate: true, source: `settle-${reason}` });
  const result: SettleResult = {
    reason,
    publishedHeight: getPublishedHeightPx(),
    baseline: getUnobstructedBaseline(),
    elapsedMs: Date.now() - startedAt,
  };
  lastSettle = result;
  logEvent("settle", `${reason} published=${result.publishedHeight ?? "none"} in ${result.elapsedMs}ms`);
  return result;
}

/**
 * Resolve once the viewport is trustworthy again — not on the first resize
 * event, which on iOS is only an intermediate frame of the keyboard
 * animation.
 *
 * With the recovery guard up, "trustworthy" means the decision function is
 * willing to publish (height back at the baseline, offsetTop back to zero)
 * *and* it has held still for the quiet period. Without the guard it's the
 * plain stability check.
 *
 * The ceiling always resolves, so authentication can never be stranded — and
 * timing out publishes nothing new, which is what keeps the shell on the
 * correct baseline height rather than the stale short one.
 */
export function waitForViewportSettle(
  options: { quietMs?: number; maxWaitMs?: number; pollMs?: number } = {}
): Promise<SettleResult> {
  const quietMs = options.quietMs ?? SETTLE_QUIET_MS;
  const maxWaitMs = options.maxWaitMs ?? SETTLE_MAX_WAIT_MS;
  const pollMs = options.pollMs ?? SETTLE_POLL_MS;
  const startedAt = Date.now();

  if (!hasWindow()) {
    return Promise.resolve({ reason: "no-viewport-api", publishedHeight: null, baseline: null, elapsedMs: 0 });
  }

  const vv = window.visualViewport;
  if (!vv) {
    return Promise.resolve(finishSettle("no-viewport-api", startedAt));
  }

  return new Promise<SettleResult>((resolve) => {
    let done = false;
    let last = signatureOf(readViewportMetrics());
    let lastChangeAt = Date.now();

    const finish = (reason: SettleReason): void => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(deadline);
      vv.removeEventListener("resize", check);
      vv.removeEventListener("scroll", check);
      resolve(finishSettle(reason, startedAt));
    };

    function check(): void {
      if (done) return;
      const metrics = readViewportMetrics();
      const signature = signatureOf(metrics);
      if (signature !== last) {
        last = signature;
        lastChangeAt = Date.now();
        return;
      }
      if (Date.now() - lastChangeAt < quietMs) return;

      const decision = evaluatePublish(metrics);
      if (!decision.publish) return; // still obstructed / still holding
      finish(recovery ? "recovered" : "stable");
    }

    vv.addEventListener("resize", check);
    vv.addEventListener("scroll", check);
    const poll = setInterval(check, pollMs);
    const deadline = setTimeout(() => finish("timed-out"), maxWaitMs);
  });
}

/**
 * The auth transition's viewport step, in the order that matters:
 *
 *     retain the unobstructed baseline
 *   → arm the recovery guard          (before blur — focus is a signal)
 *   → blur the login field
 *   → wait for the viewport to recover
 *   → continue the authentication transition
 *
 * Skipped entirely when there's no software keyboard in play (desktop, or a
 * token auto-login), where it costs nothing.
 */
export async function settleViewportBeforeAuth(options?: {
  quietMs?: number;
  maxWaitMs?: number;
  pollMs?: number;
}): Promise<SettleResult> {
  if (!hasWindow()) {
    return { reason: "no-viewport-api", publishedHeight: null, baseline: null, elapsedMs: 0 };
  }

  // Decided before the blur, while focus still tells us the truth — and not
  // from focus alone. Submitting with the on-screen Login button moves focus
  // to the button, so on iOS the field is already blurred by the time we get
  // here; in standalone mode the inset is ~0 as well, which is how the
  // original fix ended up with no signal at all. A measurement materially
  // below the retained baseline is that missing signal: whatever iOS is
  // doing, the viewport is currently smaller than we know it can be.
  const metricsBeforeBlur = readViewportMetrics();
  const base = getUnobstructedBaseline();
  const shorterThanBaseline = base !== null && metricsBeforeBlur.height < base - BASELINE_TOLERANCE_PX;
  const mustWait =
    isKeyboardMeasurablyOpen() ||
    shorterThanBaseline ||
    (isEditableElementFocused() && isSoftKeyboardCapable());
  logEvent(
    "auth",
    `settle requested mustWait=${mustWait} short=${shorterThanBaseline} focus=${describeFocusedElement()}`
  );

  // Strict only in standalone mode: that's where a shorter same-width
  // viewport is unambiguously a stale keyboard-era reading. In Safari's
  // browser mode the toolbar can genuinely change the height, so that path
  // keeps the ordinary guard (and its escape hatch).
  if (mustWait) armKeyboardRecovery("auth", isStandalonePWA() ? "strict-auth" : "normal");
  (document.activeElement as HTMLElement | null)?.blur?.();

  if (!mustWait) {
    syncViewportHeight({ immediate: true });
    const result: SettleResult = {
      reason: "nothing-to-wait-for",
      publishedHeight: getPublishedHeightPx(),
      baseline: getUnobstructedBaseline(),
      elapsedMs: 0,
    };
    lastSettle = result;
    return result;
  }

  return waitForViewportSettle(options);
}

/* ── diagnostics snapshot (used by the debug overlay) ─────────────────── */

export interface ViewportDiagnostics {
  innerHeight: number;
  clientHeight: number;
  visualViewportHeight: number | null;
  visualViewportOffsetTop: number | null;
  /** `visualViewport.scale` — confirms whether iOS input auto-zoom is in
   * play. Evidence only; the bottom nav is never positioned from it. */
  visualViewportScale: number | null;
  publishedHeight: number | null;
  baseline: number | null;
  candidateHeight: number;
  keyboardInset: number;
  editableFocused: boolean;
  focusedElement: string;
  standalone: boolean;
  softKeyboardCapable: boolean;
  recoveryActive: boolean;
  recoverySource: string | null;
  recoveryMode: RecoveryMode | null;
  recoveryHeldMs: number | null;
  orientationInFlux: boolean;
  lastDecision: PublishDecision | null;
  lastSettle: SettleResult | null;
  events: readonly ViewportEvent[];
}

export function getViewportDiagnostics(): ViewportDiagnostics {
  const metrics = readViewportMetrics();
  const vv = hasWindow() ? window.visualViewport : undefined;
  return {
    innerHeight: metrics.innerHeight,
    clientHeight: metrics.clientHeight,
    visualViewportHeight: vv ? vv.height : null,
    visualViewportOffsetTop: vv ? vv.offsetTop : null,
    visualViewportScale: vv ? (vv.scale ?? null) : null,
    publishedHeight: getPublishedHeightPx(),
    baseline: getUnobstructedBaseline(),
    candidateHeight: metrics.height,
    keyboardInset: metrics.keyboardInset,
    editableFocused: isEditableElementFocused(),
    focusedElement: describeFocusedElement(),
    standalone: isStandalonePWA(),
    softKeyboardCapable: isSoftKeyboardCapable(),
    recoveryActive: recovery !== null,
    recoverySource: recovery?.source ?? null,
    recoveryMode: recovery?.mode ?? null,
    recoveryHeldMs: recovery ? Date.now() - recovery.armedAt : null,
    orientationInFlux: Date.now() < orientationInFluxUntil,
    lastDecision,
    lastSettle,
    events: eventLog,
  };
}
