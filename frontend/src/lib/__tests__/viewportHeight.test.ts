// @vitest-environment jsdom
//
// Tests for the visual-viewport manager (lib/viewportHeight.ts).
//
// The case that matters most, and the one the first fix missed, is the
// installed standalone PWA: iOS shrinks `window.innerHeight` and
// `visualViewport.height` *together*, so the computed keyboard inset is ~0.
// With the login field blurred there is no focused editable either, so every
// signal claims "unobstructed" and the shortened height gets published as the
// app height. `standalonePwa()` below models exactly that; `safariBrowser()`
// models the classic case where only the visual viewport shrinks. Both must
// end up with the full height published.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASELINE_TOLERANCE_PX,
  STEADY_STATE_HEIGHT_TOLERANCE_PX,
  GUARD_MAX_HOLD_MS,
  GUARD_STABLE_ACCEPT_MS,
  ORIENTATION_SETTLE_MS,
  SETTLE_MAX_WAIT_MS,
  SETTLE_QUIET_MS,
  VIEWPORT_HEIGHT_VAR,
  VIEWPORT_OFFSET_TOP_VAR,
  armKeyboardRecovery,
  evaluatePublish,
  getPublishedHeightPx,
  getRecoveryMode,
  getUnobstructedBaseline,
  getViewportDiagnostics,
  isKeyboardRecoveryActive,
  isSoftKeyboardCapable,
  isStandalonePWA,
  readViewportMetrics,
  resetViewportState,
  settleViewportBeforeAuth,
  startViewportSync,
  syncViewportHeight,
  waitForViewportSettle,
} from "../viewportHeight";

/* ── device simulation ────────────────────────────────────────────────── */

class MockVisualViewport extends EventTarget {
  height: number;
  offsetTop = 0;
  /** 1 unless the page is zoomed — iOS auto-zooms any focused field whose
   * text is under 16px, which is why tokens.css pins mobile inputs to 16px. */
  scale = 1;
  constructor(height: number) {
    super();
    this.height = height;
  }
  moveTo(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event("resize"));
  }
}

let vv: MockVisualViewport;

function setInner(height: number, width = 393): void {
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: height,
    configurable: true,
  });
}

function setMaxTouchPoints(value: number): void {
  Object.defineProperty(window.navigator, "maxTouchPoints", { value, configurable: true });
}

function setDisplayMode(standalone: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("display-mode: standalone") ? standalone : query.includes("pointer: coarse") ? standalone : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

/** iPhone installed from the Home Screen: touch device, standalone. */
function standalonePwa(height = 900, width = 393): void {
  setMaxTouchPoints(5);
  setDisplayMode(true);
  setInner(height, width);
  vv.height = height;
  vv.offsetTop = 0;
}

/** Same phone, but running inside Safari's browser UI. */
function safariBrowser(height = 900, width = 393): void {
  setMaxTouchPoints(5);
  setDisplayMode(false);
  setInner(height, width);
  vv.height = height;
  vv.offsetTop = 0;
}

/** Laptop: no touch, no standalone. */
function desktopBrowser(height = 900, width = 1440): void {
  setMaxTouchPoints(0);
  setDisplayMode(false);
  setInner(height, width);
  vv.height = height;
  vv.offsetTop = 0;
}

/**
 * The standalone-PWA keyboard behaviour: BOTH values shrink together, so the
 * inset arithmetic reads zero. This is the shape the first fix couldn't see.
 */
function shrinkBothTo(height: number): void {
  setInner(height);
  vv.moveTo(height);
  window.dispatchEvent(new Event("resize"));
}

/** The Safari-browser keyboard behaviour: only the visual viewport shrinks. */
function shrinkVisualOnlyTo(height: number): void {
  vv.moveTo(height);
}

function focusField(type = "password"): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  document.body.appendChild(input);
  input.focus();
  window.dispatchEvent(new Event("focusin"));
  return input;
}

function blurField(input: HTMLInputElement): void {
  input.blur();
  window.dispatchEvent(new Event("focusout"));
}

function published(): number | null {
  return getPublishedHeightPx();
}

function track<T>(promise: Promise<T>): { done: boolean; value: T | null } {
  const state: { done: boolean; value: T | null } = { done: false, value: null };
  void promise.then((value) => {
    state.done = true;
    state.value = value;
  });
  return state;
}

/** Microtasks plus one animation frame — enough for a rAF-batched write. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  document.body.innerHTML = "";
  vv = new MockVisualViewport(900);
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true, writable: true });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  resetViewportState();
  standalonePwa();
});

afterEach(() => {
  resetViewportState();
  Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── measurement ──────────────────────────────────────────────────────── */

describe("readViewportMetrics", () => {
  it("uses visualViewport.height when available", () => {
    vv.height = 640;
    expect(readViewportMetrics().height).toBe(640);
  });

  it("falls back to window.innerHeight when visualViewport is unavailable", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
    expect(readViewportMetrics().height).toBe(900);
  });

  it("reports a zero keyboard inset when both values shrink together", () => {
    // The heart of the standalone bug: this number cannot be used to prove
    // that no keyboard is present.
    shrinkBothTo(760);
    const metrics = readViewportMetrics();
    expect(metrics.height).toBe(760);
    expect(metrics.innerHeight).toBe(760);
    expect(metrics.keyboardInset).toBe(0);
  });

  it("reports a real inset when only the visual viewport shrinks", () => {
    safariBrowser();
    shrinkVisualOnlyTo(500);
    expect(readViewportMetrics().keyboardInset).toBe(400);
  });
});

describe("environment probes", () => {
  it("detects standalone display mode", () => {
    standalonePwa();
    expect(isStandalonePWA()).toBe(true);
    desktopBrowser();
    expect(isStandalonePWA()).toBe(false);
  });

  it("treats a laptop as having no software keyboard", () => {
    desktopBrowser();
    expect(isSoftKeyboardCapable()).toBe(false);
  });

  it("treats a touch device as having a software keyboard", () => {
    standalonePwa();
    expect(isSoftKeyboardCapable()).toBe(true);
  });
});

/* ── the exact reported failure ───────────────────────────────────────── */

describe("installed iPhone PWA — the exact reported login sequence", () => {
  it("keeps the full height published throughout, and never paints the shortened one", async () => {
    // 1-4. Standalone, 900/900, published and retained as the baseline.
    const stop = startViewportSync();
    expect(published()).toBe(900);
    expect(getUnobstructedBaseline()).toBe(900);

    // 5. Focus the login input.
    const input = focusField("password");
    await flush();

    // 6. iOS shrinks BOTH innerHeight and visualViewport.height to 760.
    shrinkBothTo(760);
    await flush();
    expect(readViewportMetrics().keyboardInset).toBe(0); // no inset to detect
    expect(published()).toBe(900); // ...and yet the shell height is untouched

    // 7-8. Submit: the guard is armed before the blur, then the field blurs.
    const settle = track(
      settleViewportBeforeAuth().then((result) => {
        blurField(input);
        return result;
      })
    );
    // settleViewportBeforeAuth blurs internally; mirror the browser's event.
    window.dispatchEvent(new Event("focusout"));
    expect(isKeyboardRecoveryActive()).toBe(true);

    // 9. Every event and delayed timer iOS might fire while still reporting
    //    the shortened viewport.
    vv.moveTo(760);
    vv.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    await flush();

    // 10-11. Past the quiet period, and past the maximum recovery timeout.
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + SETTLE_MAX_WAIT_MS + 200);

    // 12. Authentication is allowed to continue...
    expect(settle.done).toBe(true);
    expect(settle.value?.reason).toBe("timed-out");

    // 13-14. ...and nothing published 760. Not the focusout timers, not the
    // settle step's final immediate sync.
    expect(published()).toBe(900);
    expect(getUnobstructedBaseline()).toBe(900);

    // 15-16. iOS finally restores the real viewport.
    setInner(900);
    vv.moveTo(900);
    await flush();

    // 17. The guard releases and the height is unchanged — which is the
    // acceptance criterion: identical before and after.
    expect(published()).toBe(900);
    expect(isKeyboardRecoveryActive()).toBe(false);

    stop();
  });

  it("still protects the transition when login is submitted with the on-screen button", async () => {
    // Tapping the Login button moves focus off the field first, so by the
    // time auth runs there is no focused editable AND no inset — the login
    // path must rely on the baseline comparison alone.
    const stop = startViewportSync();
    const input = focusField("password");
    shrinkBothTo(760);
    await flush();

    blurField(input); // focus moves to the button
    expect(published()).toBe(900);

    const settle = track(settleViewportBeforeAuth());
    await flush();
    expect(settle.done).toBe(false); // it did decide to wait
    expect(isKeyboardRecoveryActive()).toBe(true);

    await vi.advanceTimersByTimeAsync(SETTLE_MAX_WAIT_MS + 100);
    expect(published()).toBe(900);
    stop();
  });

  it("survives ten consecutive login/keyboard cycles without drifting", async () => {
    const stop = startViewportSync();
    for (let i = 0; i < 10; i += 1) {
      const input = focusField("password");
      shrinkBothTo(760);
      await flush();

      const settle = track(settleViewportBeforeAuth());
      window.dispatchEvent(new Event("focusout"));
      blurField(input);
      await vi.advanceTimersByTimeAsync(SETTLE_MAX_WAIT_MS + 100);
      expect(settle.done).toBe(true);
      expect(published()).toBe(900);

      // iOS restores the viewport after the transition.
      setInner(900);
      vv.moveTo(900);
      await vi.advanceTimersByTimeAsync(800);
      expect(published()).toBe(900);
      expect(isKeyboardRecoveryActive()).toBe(false);
      input.remove();
    }
    stop();
  });
});

/* ── slow / cold-start authentication ─────────────────────────────────── */

describe("cold-start login — the guard must outlive a slow API request", () => {
  it("keeps the full height through a login that takes far longer than GUARD_MAX_HOLD_MS", async () => {
    // 1-2. Standalone at full height; baseline retained.
    const stop = startViewportSync();
    expect(published()).toBe(900);
    expect(getUnobstructedBaseline()).toBe(900);

    // 3-4. Focus the password field; iOS shrinks BOTH values together.
    const input = focusField("password");
    shrinkBothTo(760);
    await flush();
    expect(published()).toBe(900);

    // 5. Login is submitted. The viewport transition starts NOW, alongside
    //    the request — not after it — exactly as AppContext orders it.
    const viewportReady = track(settleViewportBeforeAuth());
    blurField(input); // focusout also arms a guard, as the browser would
    expect(getRecoveryMode()).toBe("strict-auth");

    // 6-7. The backend is cold. Ten seconds pass with the request unresolved,
    //      well past GUARD_MAX_HOLD_MS, while iOS still reports 760.
    await vi.advanceTimersByTimeAsync(10_000);

    // 8-9. The request finally lands and authentication completes.
    expect(viewportReady.done).toBe(true);

    // 10-11. The shell is still sized from the real viewport...
    expect(published()).toBe(900);
    expect(getUnobstructedBaseline()).toBe(900);
    // 12. ...and the escape hatch was never taken.
    expect(evaluatePublish().reason).toBe("recovery-holding-baseline");

    // 13-14. A scroll event while still measuring 760 changes nothing.
    vv.dispatchEvent(new Event("scroll"));
    await flush();
    expect(published()).toBe(900);

    // 15-16. iOS restores the viewport; the guard releases normally.
    setInner(900);
    vv.moveTo(900);
    await flush();
    expect(published()).toBe(900);
    expect(isKeyboardRecoveryActive()).toBe(false);
    stop();
  });

  it("handles a fast login (under six seconds) identically", async () => {
    const stop = startViewportSync();
    const input = focusField("password");
    shrinkBothTo(760);
    await flush();

    const viewportReady = track(settleViewportBeforeAuth());
    blurField(input);
    await vi.advanceTimersByTimeAsync(1200); // request answered quickly
    expect(viewportReady.done).toBe(true);
    expect(published()).toBe(900);

    setInner(900);
    vv.moveTo(900);
    await flush();
    expect(published()).toBe(900);
    expect(isKeyboardRecoveryActive()).toBe(false);
    stop();
  });

  it("leaves the height correct after a failed login", async () => {
    const stop = startViewportSync();
    const input = focusField("password");
    shrinkBothTo(760);
    await flush();

    // The transition starts before the request, so a rejection doesn't skip
    // it — the guard must still resolve and still hold the baseline.
    const viewportReady = track(settleViewportBeforeAuth());
    blurField(input);
    await vi.advanceTimersByTimeAsync(8000); // request eventually 401s
    expect(viewportReady.done).toBe(true);
    expect(published()).toBe(900);

    // The user retries: focus comes back, keyboard reopens, still 900.
    const retry = focusField("password");
    await flush();
    expect(published()).toBe(900);
    retry.remove();
    stop();
  });

  it("gives a slow signup the same protection as a slow login", async () => {
    const stop = startViewportSync();
    const input = focusField("password");
    shrinkBothTo(760);
    await flush();

    const viewportReady = track(settleViewportBeforeAuth());
    blurField(input);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(viewportReady.done).toBe(true);
    expect(published()).toBe(900);
    expect(getRecoveryMode()).toBe("strict-auth");
    stop();
  });

  it("accepts a late recovery long after the authenticated shell has mounted", async () => {
    const stop = startViewportSync();
    const input = focusField("password");
    shrinkBothTo(760);
    await flush();
    const viewportReady = track(settleViewportBeforeAuth());
    blurField(input);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(viewportReady.done).toBe(true);
    expect(published()).toBe(900);

    // Thirty seconds after the shell mounted, iOS finally emits the restore.
    await vi.advanceTimersByTimeAsync(30_000);
    setInner(900);
    vv.moveTo(900);
    await flush();
    expect(published()).toBe(900);
    expect(isKeyboardRecoveryActive()).toBe(false);
    stop();
  });

  it("survives repeated login / logout cycles with slow responses", async () => {
    const stop = startViewportSync();
    for (let i = 0; i < 5; i += 1) {
      const input = focusField("password");
      shrinkBothTo(760);
      await flush();

      const viewportReady = track(settleViewportBeforeAuth());
      blurField(input);
      await vi.advanceTimersByTimeAsync(9000);
      expect(viewportReady.done).toBe(true);
      expect(published()).toBe(900);

      setInner(900);
      vv.moveTo(900);
      await vi.advanceTimersByTimeAsync(900);
      expect(published()).toBe(900);
      expect(isKeyboardRecoveryActive()).toBe(false);
      input.remove();
    }
    stop();
  });

  it("keeps the ordinary escape hatch for a slow auth in Safari browser mode", async () => {
    // Safari's toolbar can legitimately change the height, so that path is
    // not strict — the guard must still be able to concede eventually.
    safariBrowser();
    const stop = startViewportSync();
    const input = focusField("password");
    shrinkVisualOnlyTo(500);
    await flush();

    const viewportReady = track(settleViewportBeforeAuth());
    blurField(input);
    expect(getRecoveryMode()).toBe("normal");
    await vi.advanceTimersByTimeAsync(2000);
    expect(viewportReady.done).toBe(true);
    input.remove();
    stop();
  });
});

/* ── the guard's own rules ────────────────────────────────────────────── */

describe("keyboard-recovery guard", () => {
  it("refuses a shortened measurement even though nothing is focused and the inset is zero", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("test");
    shrinkBothTo(760);
    await flush();
    const decision = evaluatePublish();
    expect(decision.publish).toBe(false);
    expect(decision.reason).toBe("recovery-holding-baseline");
    expect(published()).toBe(900);
    stop();
  });

  it("accepts a measurement back at the baseline and releases", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("test");
    shrinkBothTo(760);
    await flush();
    setInner(900);
    vv.moveTo(900);
    await flush();
    expect(published()).toBe(900);
    expect(isKeyboardRecoveryActive()).toBe(false);
    stop();
  });

  it("tolerates sub-pixel rounding around the baseline", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("test");
    const nearlyFull = 900 - (BASELINE_TOLERANCE_PX - 1);
    setInner(nearlyFull);
    vv.moveTo(nearlyFull);
    await flush();
    expect(published()).toBe(nearlyFull);
    expect(isKeyboardRecoveryActive()).toBe(false);
    stop();
  });

  it("will not hold a genuinely-shorter viewport hostage forever — NORMAL recovery only", async () => {
    // Scoped deliberately: this escape hatch exists for e.g. Safari's toolbar
    // legitimately changing the height. The strict-auth test below asserts it
    // must NOT apply during an installed-PWA login.
    const stop = startViewportSync();
    armKeyboardRecovery("test", "normal");
    shrinkBothTo(760);
    await vi.advanceTimersByTimeAsync(GUARD_MAX_HOLD_MS + GUARD_STABLE_ACCEPT_MS + 200);
    syncViewportHeight({ immediate: true });
    expect(published()).toBe(760);
    expect(getUnobstructedBaseline()).toBe(760);
    stop();
  });

  it("never takes the long-hold escape hatch during a strict auth recovery", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("auth", "strict-auth");
    shrinkBothTo(760);
    await vi.advanceTimersByTimeAsync(GUARD_MAX_HOLD_MS * 3);
    syncViewportHeight({ immediate: true });
    expect(evaluatePublish().reason).toBe("recovery-holding-baseline");
    expect(published()).toBe(900);
    expect(getUnobstructedBaseline()).toBe(900);
    stop();
  });

  it("resets the guard's clock on re-arm rather than only relabelling it", async () => {
    // Isolated from strict mode on purpose: BOTH mechanisms have to work.
    // Strict mode alone would mask a missing reset here, and the reset alone
    // would mask a missing strict exclusion in the tests above.
    const stop = startViewportSync();
    // The Login button is tapped: focusout arms a guard...
    armKeyboardRecovery("focusout", "normal");
    shrinkBothTo(760);
    // ...and the cold-starting backend runs past the guard's ceiling, so the
    // escape hatch is now primed.
    await vi.advanceTimersByTimeAsync(GUARD_MAX_HOLD_MS + GUARD_STABLE_ACCEPT_MS + 500);
    expect(evaluatePublish().reason).toBe("recovery-long-hold-accepted");

    // The auth path re-arms. Resetting armedAt/lastChangeAt puts the guard
    // back to full strength; merely updating `source` would leave the next
    // evaluation free to adopt the stale 760.
    armKeyboardRecovery("auth", "normal");
    expect(evaluatePublish().reason).toBe("recovery-holding-baseline");
    syncViewportHeight({ immediate: true });
    expect(published()).toBe(900);
    expect(getUnobstructedBaseline()).toBe(900);
    stop();
  });

  it("escalates a re-armed guard to strict for the auth path", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("focusout", "normal");
    shrinkBothTo(760);
    await vi.advanceTimersByTimeAsync(GUARD_MAX_HOLD_MS + 1000);
    armKeyboardRecovery("auth", "strict-auth");
    expect(getRecoveryMode()).toBe("strict-auth");
    // ...and from here even another full ceiling can't shake it loose.
    await vi.advanceTimersByTimeAsync(GUARD_MAX_HOLD_MS * 2);
    expect(evaluatePublish().reason).toBe("recovery-holding-baseline");
    expect(published()).toBe(900);
    stop();
  });

  it("lets a strict guard escalate from a normal one, and never the reverse", () => {
    armKeyboardRecovery("focusout", "normal");
    expect(getRecoveryMode()).toBe("normal");
    armKeyboardRecovery("auth", "strict-auth");
    expect(getRecoveryMode()).toBe("strict-auth");
    armKeyboardRecovery("focusout", "normal");
    expect(getRecoveryMode()).toBe("strict-auth");
  });

  it("does not release while the visual viewport is still displaced", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("test");
    setInner(900);
    vv.moveTo(900, 40); // full height but still sliding
    await flush();
    expect(evaluatePublish().reason).toBe("recovery-offset-nonzero");
    expect(isKeyboardRecoveryActive()).toBe(true);
    vv.moveTo(900, 0);
    await flush();
    expect(isKeyboardRecoveryActive()).toBe(false);
    stop();
  });

  it("arms itself on any blur, so Entry and Settings fields get the same protection", async () => {
    const stop = startViewportSync();
    const input = focusField("number"); // Entry's fuel-cost style field
    shrinkBothTo(760);
    await flush();
    expect(published()).toBe(900);

    blurField(input);
    expect(isKeyboardRecoveryActive()).toBe(true);
    // Every deferred re-measure fires while iOS still reports 760.
    await vi.advanceTimersByTimeAsync(1000);
    expect(published()).toBe(900);

    setInner(900);
    vv.moveTo(900);
    await flush();
    expect(published()).toBe(900);
    stop();
  });

  it("holds through a Settings text field open/close cycle", async () => {
    const stop = startViewportSync();
    const input = focusField("text");
    shrinkVisualOnlyTo(520); // Settings in Safari mode: classic inset
    await flush();
    expect(published()).toBe(900);
    blurField(input);
    vv.moveTo(900);
    await vi.advanceTimersByTimeAsync(1000);
    expect(published()).toBe(900);
    stop();
  });
});

/* ── publish paths ────────────────────────────────────────────────────── */

describe("every publish path goes through the same decision", () => {
  it("publishes on initial mount", () => {
    const stop = startViewportSync();
    expect(published()).toBe(900);
    expect(document.documentElement.style.getPropertyValue(VIEWPORT_OFFSET_TOP_VAR)).toBe("0px");
    stop();
  });

  it("publishes a legitimate non-keyboard resize", async () => {
    const stop = startViewportSync();
    setInner(700);
    vv.moveTo(700);
    window.dispatchEvent(new Event("resize"));
    await flush();
    expect(published()).toBe(700);
    stop();
  });

  it("ignores 1–2px steady-state viewport noise but records its source and decision", async () => {
    const stop = startViewportSync();
    const noisyHeight = 900 - STEADY_STATE_HEIGHT_TOLERANCE_PX;
    setInner(noisyHeight);
    vv.moveTo(noisyHeight);
    await flush();
    expect(published()).toBe(900);
    expect(evaluatePublish().reason).toBe("steady-state-jitter");
    const lastPublish = [...getViewportDiagnostics().events].reverse().find((event) => event.kind === "publish");
    expect(lastPublish?.detail).toContain("old=900");
    expect(lastPublish?.detail).toContain(`new=${noisyHeight}`);
    expect(lastPublish?.detail).toContain("source=");
    expect(lastPublish?.detail).toContain("reason=steady-state-jitter");
    stop();
  });

  it("holds while an editable element is focused", async () => {
    const stop = startViewportSync();
    focusField();
    shrinkBothTo(600);
    await flush();
    expect(evaluatePublish().reason).toBe("editable-focused");
    expect(published()).toBe(900);
    stop();
  });

  it("holds while a measurable keyboard inset is present", async () => {
    const stop = startViewportSync();
    safariBrowser();
    shrinkVisualOnlyTo(500);
    await flush();
    expect(evaluatePublish().reason).toBe("keyboard-inset");
    expect(published()).toBe(900);
    stop();
  });

  it("does not let the deferred focusout timers bypass the guard", async () => {
    const stop = startViewportSync();
    const input = focusField();
    shrinkBothTo(760);
    await flush();
    blurField(input);
    // Walk right through every deferred re-measure.
    for (let t = 0; t < 1200; t += 100) {
      await vi.advanceTimersByTimeAsync(100);
      expect(published()).toBe(900);
    }
    stop();
  });

  it("updates after pageshow once the viewport is trustworthy", async () => {
    const stop = startViewportSync();
    setInner(812);
    vv.height = 812;
    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(800);
    expect(published()).toBe(812);
    stop();
  });

  it("updates when the app is restored from the background", async () => {
    const stop = startViewportSync();
    setInner(844);
    vv.height = 844;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(800);
    expect(published()).toBe(844);
    stop();
  });

  it("ignores a visibilitychange that hides the app", async () => {
    const stop = startViewportSync();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    setInner(500);
    vv.height = 500;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(800);
    expect(published()).toBe(900);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    stop();
  });
});

/* ── orientation ──────────────────────────────────────────────────────── */

describe("orientation", () => {
  it("drops the portrait baseline on a real rotation and adopts the landscape height", async () => {
    const stop = startViewportSync();
    expect(getUnobstructedBaseline()).toBe(900);

    // Rotate: width and height swap.
    window.dispatchEvent(new Event("orientationchange"));
    setInner(393, 852);
    vv.moveTo(393);
    await vi.advanceTimersByTimeAsync(ORIENTATION_SETTLE_MS + 300);

    expect(published()).toBe(393);
    expect(getUnobstructedBaseline()).toBe(393);
    stop();
  });

  it("ignores measurements taken mid-rotation", async () => {
    const stop = startViewportSync();
    window.dispatchEvent(new Event("orientationchange"));
    setInner(120, 852); // nonsense intermediate frame
    vv.moveTo(120);
    await flush();
    expect(evaluatePublish().reason).toBe("orientation-in-flux");
    stop();
  });

  it("releases a recovery guard left over from before the rotation", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("test");
    window.dispatchEvent(new Event("orientationchange"));
    expect(isKeyboardRecoveryActive()).toBe(false);
    stop();
  });

  it("does not reuse a portrait baseline after rotating back and forth", async () => {
    const stop = startViewportSync();
    window.dispatchEvent(new Event("orientationchange"));
    setInner(393, 852);
    vv.moveTo(393);
    await vi.advanceTimersByTimeAsync(ORIENTATION_SETTLE_MS + 300);
    expect(getUnobstructedBaseline()).toBe(393);

    window.dispatchEvent(new Event("orientationchange"));
    setInner(900, 393);
    vv.moveTo(900);
    await vi.advanceTimersByTimeAsync(ORIENTATION_SETTLE_MS + 300);
    expect(getUnobstructedBaseline()).toBe(900);
    expect(published()).toBe(900);
    stop();
  });
});

/* ── settle ───────────────────────────────────────────────────────────── */

describe("waitForViewportSettle", () => {
  it("does not treat the first resize as settled", async () => {
    safariBrowser();
    shrinkVisualOnlyTo(500);
    const settled = track(waitForViewportSettle());

    vv.moveTo(560);
    await flush();
    expect(settled.done).toBe(false);

    for (const height of [620, 700, 780, 850]) {
      await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS / 2);
      vv.moveTo(height);
      expect(settled.done).toBe(false);
    }
  });

  it("resolves once the viewport has held still through the quiet period", async () => {
    safariBrowser();
    const stop = startViewportSync();
    shrinkVisualOnlyTo(500);
    const settled = track(waitForViewportSettle());
    vv.moveTo(900);
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 60);
    expect(settled.done).toBe(true);
    expect(settled.value?.reason).toBe("stable");
    stop();
  });

  it("times out without publishing the stale height", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("test");
    shrinkBothTo(760);
    const settled = track(waitForViewportSettle());
    await vi.advanceTimersByTimeAsync(SETTLE_MAX_WAIT_MS + 60);
    expect(settled.value?.reason).toBe("timed-out");
    expect(settled.value?.publishedHeight).toBe(900);
    expect(published()).toBe(900);
    stop();
  });

  it("keeps listening after a timeout and accepts a late recovery", async () => {
    const stop = startViewportSync();
    armKeyboardRecovery("test");
    shrinkBothTo(760);
    await vi.advanceTimersByTimeAsync(SETTLE_MAX_WAIT_MS + 60);
    expect(isKeyboardRecoveryActive()).toBe(true);

    // Two seconds later, iOS finally reports the restored viewport.
    await vi.advanceTimersByTimeAsync(2000);
    setInner(900);
    vv.moveTo(900);
    await flush();
    expect(published()).toBe(900);
    expect(isKeyboardRecoveryActive()).toBe(false);
    stop();
  });

  it("resolves immediately when there is no visualViewport to watch", async () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
    const settled = track(waitForViewportSettle());
    await flush();
    expect(settled.done).toBe(true);
    expect(settled.value?.reason).toBe("no-viewport-api");
  });
});

describe("settleViewportBeforeAuth", () => {
  it("adds no delay to a desktop login", async () => {
    desktopBrowser();
    const stop = startViewportSync();
    focusField();
    const settled = track(settleViewportBeforeAuth());
    await flush();
    expect(settled.done).toBe(true);
    expect(settled.value?.reason).toBe("nothing-to-wait-for");
    stop();
  });

  it("adds no delay to an auto-login with nothing focused", async () => {
    const stop = startViewportSync();
    const settled = track(settleViewportBeforeAuth());
    await flush();
    expect(settled.done).toBe(true);
    expect(settled.value?.reason).toBe("nothing-to-wait-for");
    stop();
  });

  it("blurs the focused field so the keyboard starts closing", async () => {
    const stop = startViewportSync();
    const input = focusField();
    expect(document.activeElement).toBe(input);
    const settled = track(settleViewportBeforeAuth());
    await vi.advanceTimersByTimeAsync(SETTLE_MAX_WAIT_MS + 60);
    expect(document.activeElement).not.toBe(input);
    expect(settled.done).toBe(true);
    stop();
  });

  it("arms the guard before blurring, not after", async () => {
    const stop = startViewportSync();
    const input = focusField();
    shrinkBothTo(760);
    await flush();

    // Capture the guard state at the first moment the blur can be observed.
    let armedAtBlur: boolean | null = null;
    input.addEventListener("blur", () => {
      armedAtBlur = isKeyboardRecoveryActive();
    });

    const settled = track(settleViewportBeforeAuth());
    await vi.advanceTimersByTimeAsync(SETTLE_MAX_WAIT_MS + 60);
    expect(armedAtBlur).toBe(true);
    expect(settled.done).toBe(true);
    stop();
  });

  it("handles the classic Safari case where only the visual viewport shrinks", async () => {
    safariBrowser();
    const stop = startViewportSync();
    const input = focusField();
    shrinkVisualOnlyTo(500);
    await flush();
    expect(published()).toBe(900);

    const settled = track(settleViewportBeforeAuth());
    blurField(input);
    vv.moveTo(900);
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 80);
    expect(settled.done).toBe(true);
    expect(published()).toBe(900);
    stop();
  });
});

/* ── teardown and hygiene ─────────────────────────────────────────────── */

describe("teardown", () => {
  it("removes every listener it added", () => {
    const added: string[] = [];
    const removed: string[] = [];
    const watch = (target: EventTarget, label: string) => {
      const realAdd = target.addEventListener.bind(target);
      const realRemove = target.removeEventListener.bind(target);
      vi.spyOn(target, "addEventListener").mockImplementation(((type: string, ...rest: unknown[]) => {
        added.push(`${label}:${type}`);
        return (realAdd as (...a: unknown[]) => void)(type, ...rest);
      }) as never);
      vi.spyOn(target, "removeEventListener").mockImplementation(((type: string, ...rest: unknown[]) => {
        removed.push(`${label}:${type}`);
        return (realRemove as (...a: unknown[]) => void)(type, ...rest);
      }) as never);
    };
    watch(window, "window");
    watch(document, "document");
    watch(vv, "vv");

    const stop = startViewportSync();
    expect(added.length).toBeGreaterThan(0);
    stop();
    expect([...removed].sort()).toEqual([...added].sort());
  });

  it("leaves no timers of its own behind", () => {
    const baseline = vi.getTimerCount();
    const stop = startViewportSync();
    window.dispatchEvent(new Event("orientationchange"));
    expect(vi.getTimerCount()).toBeGreaterThan(baseline);
    stop();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it("does not write to the DOM after teardown", async () => {
    const stop = startViewportSync();
    stop();
    setInner(400);
    vv.moveTo(400);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("orientationchange"));
    await vi.advanceTimersByTimeAsync(1500);
    expect(published()).toBe(900);
  });

  it("does not apply a frame queued before teardown", async () => {
    const stop = startViewportSync();
    setInner(500);
    vv.moveTo(500);
    stop();
    await vi.advanceTimersByTimeAsync(120);
    expect(published()).toBe(900);
  });
});

describe("syncViewportHeight batching", () => {
  it("coalesces a burst of events into one frame", async () => {
    startViewportSync()();
    const setProperty = vi.spyOn(document.documentElement.style, "setProperty");
    for (let i = 0; i < 10; i += 1) syncViewportHeight();
    expect(setProperty).not.toHaveBeenCalled();
    await flush();
    expect(setProperty.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("does not rewrite an unchanged value", () => {
    syncViewportHeight({ immediate: true });
    const setProperty = vi.spyOn(document.documentElement.style, "setProperty");
    syncViewportHeight({ immediate: true });
    expect(setProperty).not.toHaveBeenCalled();
  });

  it("writes the height variable in px", () => {
    syncViewportHeight({ immediate: true });
    expect(document.documentElement.style.getPropertyValue(VIEWPORT_HEIGHT_VAR)).toBe("900px");
  });
});

/* ── diagnostics ──────────────────────────────────────────────────────── */

describe("diagnostics", () => {
  it("reports the values needed to debug an on-device failure", async () => {
    const stop = startViewportSync();
    focusField("password");
    shrinkBothTo(760);
    await flush();

    const d = getViewportDiagnostics();
    expect(d.innerHeight).toBe(760);
    expect(d.visualViewportHeight).toBe(760);
    expect(d.publishedHeight).toBe(900);
    expect(d.baseline).toBe(900);
    expect(d.candidateHeight).toBe(760);
    expect(d.keyboardInset).toBe(0);
    expect(d.editableFocused).toBe(true);
    expect(d.standalone).toBe(true);
    expect(d.events.length).toBeGreaterThan(0);
    stop();
  });

  it("reports visualViewport.scale so input auto-zoom can be ruled in or out", async () => {
    const stop = startViewportSync();
    expect(getViewportDiagnostics().visualViewportScale).toBe(1);
    expect(readViewportMetrics().scale).toBe(1);

    // iOS auto-zooming a sub-16px field, or a pinch.
    (vv as MockVisualViewport & { scale: number }).scale = 1.32;
    expect(getViewportDiagnostics().visualViewportScale).toBeCloseTo(1.32);
    expect(readViewportMetrics().scale).toBeCloseTo(1.32);
    stop();
  });

  it("refuses to publish a height measured while the page is zoomed", async () => {
    const stop = startViewportSync();
    (vv as MockVisualViewport & { scale: number }).scale = 1.4;
    setInner(900);
    vv.moveTo(640); // what a zoomed viewport reports
    await flush();
    expect(evaluatePublish().reason).toBe("viewport-zoomed");
    expect(published()).toBe(900);

    (vv as MockVisualViewport & { scale: number }).scale = 1;
    vv.moveTo(900);
    await flush();
    expect(published()).toBe(900);
    stop();
  });

  it("identifies the focused element by type only, never by value", async () => {
    const stop = startViewportSync();
    const input = focusField("password");
    input.value = "hunter2";
    input.name = "password";
    input.id = "login-password";

    const d = getViewportDiagnostics();
    expect(d.focusedElement).toBe("input[type=password]");
    const serialised = JSON.stringify(d);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("login-password");
    stop();
  });
});
