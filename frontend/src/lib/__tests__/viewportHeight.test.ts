// @vitest-environment jsdom
//
// Tests for the visual-viewport manager (lib/viewportHeight.ts) — the fix
// for the installed-iPhone-PWA bug where the app shell mounted at the
// keyboard-era height after login and only corrected itself on the user's
// first swipe.
//
// Everything here runs against a mocked `window.visualViewport`, because
// that is the API the real bug lives in and jsdom doesn't implement it. The
// cases that matter most are the ones the *previous* workaround got wrong:
// a keyboard close emits several resize events, and the first one is an
// intermediate frame — so "the first resize event" must never count as
// settled, and a quiet period must.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEYBOARD_INSET_THRESHOLD_PX,
  SETTLE_MAX_WAIT_MS,
  SETTLE_QUIET_MS,
  VIEWPORT_HEIGHT_VAR,
  VIEWPORT_OFFSET_TOP_VAR,
  isSoftKeyboardCapable,
  readViewportMetrics,
  settleViewportBeforeAuth,
  startViewportSync,
  syncViewportHeight,
  waitForViewportSettle,
} from "../viewportHeight";

/** Minimal stand-in for the real thing: an EventTarget with height/offsetTop
 * we can move around, exactly like iOS moves it while the keyboard animates. */
class MockVisualViewport extends EventTarget {
  height: number;
  offsetTop = 0;
  constructor(height: number) {
    super();
    this.height = height;
  }
  /** Move the viewport and fire the event iOS would fire. */
  moveTo(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event("resize"));
  }
}

let vv: MockVisualViewport | null = null;

function setInnerHeight(value: number): void {
  Object.defineProperty(window, "innerHeight", { value, configurable: true, writable: true });
}

function installVisualViewport(height: number): MockVisualViewport {
  const mock = new MockVisualViewport(height);
  Object.defineProperty(window, "visualViewport", { value: mock, configurable: true, writable: true });
  vv = mock;
  return mock;
}

function removeVisualViewport(): void {
  Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
  vv = null;
}

function setMaxTouchPoints(value: number): void {
  Object.defineProperty(window.navigator, "maxTouchPoints", { value, configurable: true });
}

function publishedHeight(): string {
  return document.documentElement.style.getPropertyValue(VIEWPORT_HEIGHT_VAR);
}

/** Resolve-tracker for promises we want to assert are *not* yet resolved. */
function track(promise: Promise<void>): { done: boolean } {
  const state = { done: false };
  void promise.then(() => {
    state.done = true;
  });
  return state;
}

/** Flushes pending microtasks plus one animation frame — enough for a
 * rAF-batched style write to land, short enough not to disturb any settle
 * window (which is measured in hundreds of ms). */
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
  document.documentElement.style.removeProperty(VIEWPORT_HEIGHT_VAR);
  document.documentElement.style.removeProperty(VIEWPORT_OFFSET_TOP_VAR);
  document.body.innerHTML = "";
  setInnerHeight(900);
  setMaxTouchPoints(0);
  installVisualViewport(900);
});

afterEach(() => {
  removeVisualViewport();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("readViewportMetrics", () => {
  it("uses visualViewport.height when the API is available", () => {
    vv!.height = 640;
    const metrics = readViewportMetrics();
    expect(metrics.height).toBe(640);
    // 900 (layout) - 640 (visible) = the keyboard's share of the screen.
    expect(metrics.keyboardInset).toBe(260);
  });

  it("falls back to window.innerHeight when visualViewport is unavailable", () => {
    removeVisualViewport();
    const metrics = readViewportMetrics();
    expect(metrics.height).toBe(900);
    expect(metrics.keyboardInset).toBe(0);
  });

  it("reports the visual viewport's offsetTop while it is displaced", () => {
    vv!.height = 640;
    vv!.offsetTop = 120;
    expect(readViewportMetrics().offsetTop).toBe(120);
  });
});

describe("startViewportSync — publishing the CSS variable", () => {
  it("sets the height variable on initial mount", () => {
    const stop = startViewportSync();
    expect(publishedHeight()).toBe("900px");
    stop();
  });

  it("publishes the offsetTop variable too", () => {
    vv!.offsetTop = 24;
    const stop = startViewportSync();
    expect(document.documentElement.style.getPropertyValue(VIEWPORT_OFFSET_TOP_VAR)).toBe("24px");
    stop();
  });

  it("updates after a visual-viewport resize", async () => {
    const stop = startViewportSync();
    setInnerHeight(760);
    vv!.moveTo(760);
    await flush();
    expect(publishedHeight()).toBe("760px");
    stop();
  });

  it("updates after a window resize", async () => {
    const stop = startViewportSync();
    setInnerHeight(700);
    vv!.height = 700;
    window.dispatchEvent(new Event("resize"));
    await flush();
    expect(publishedHeight()).toBe("700px");
    stop();
  });

  it("updates after an orientation change, including the deferred re-measure iOS needs", async () => {
    const stop = startViewportSync();
    // Rotation: iOS still reports the old size during the event turn itself,
    // and only lands on the new one a couple of hundred ms later.
    window.dispatchEvent(new Event("orientationchange"));
    setInnerHeight(430);
    vv!.height = 430;
    await vi.advanceTimersByTimeAsync(400);
    expect(publishedHeight()).toBe("430px");
    stop();
  });

  it("updates after pageshow (restored from the back/forward cache)", async () => {
    const stop = startViewportSync();
    setInnerHeight(812);
    vv!.height = 812;
    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(400);
    expect(publishedHeight()).toBe("812px");
    stop();
  });

  it("updates when the app becomes visible again after being backgrounded", async () => {
    const stop = startViewportSync();
    setInnerHeight(844);
    vv!.height = 844;
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(400);
    expect(publishedHeight()).toBe("844px");
    stop();
  });

  it("ignores a visibilitychange that hides the app", async () => {
    const stop = startViewportSync();
    setInnerHeight(500);
    vv!.height = 500;
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(400);
    expect(publishedHeight()).toBe("900px");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    stop();
  });

  it("holds the published height while a keyboard is covering the viewport", async () => {
    const stop = startViewportSync();
    expect(publishedHeight()).toBe("900px");
    // Keyboard opens: the bottom nav must not jump up to sit on top of it.
    vv!.moveTo(900 - KEYBOARD_INSET_THRESHOLD_PX - 200);
    await flush();
    expect(publishedHeight()).toBe("900px");
    // ...and it comes back down to the same value once the keyboard closes.
    vv!.moveTo(900);
    await flush();
    expect(publishedHeight()).toBe("900px");
    stop();
  });

  it("holds the published height while an editable field has focus, even with no measurable inset", async () => {
    const stop = startViewportSync();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    // Standalone iOS has been seen to shrink the window itself, which makes
    // the inset heuristic read ~0 — the focus check is what catches it.
    setInnerHeight(600);
    vv!.moveTo(600);
    await flush();
    expect(publishedHeight()).toBe("900px");

    input.blur();
    setInnerHeight(900);
    vv!.height = 900;
    await vi.advanceTimersByTimeAsync(400);
    expect(publishedHeight()).toBe("900px");
    stop();
  });
});

describe("startViewportSync — teardown", () => {
  it("removes every listener it added", () => {
    const added: string[] = [];
    const removed: string[] = [];
    // Spies that call through, so this test observes the real registration
    // rather than replacing it (a no-op mock here would leak into the tests
    // that follow).
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
    watch(vv!, "vv");

    const stop = startViewportSync();
    expect(added.length).toBeGreaterThan(0);
    stop();
    expect([...removed].sort()).toEqual([...added].sort());
  });

  it("leaves no timers of its own behind", async () => {
    // Relative to a baseline: jsdom keeps timers of its own, so the absolute
    // count is not ours to assert on.
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
    setInnerHeight(400);
    vv!.moveTo(400);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("orientationchange"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(publishedHeight()).toBe("900px");
  });

  it("does not apply a frame that was already queued when teardown ran", async () => {
    const stop = startViewportSync();
    setInnerHeight(500);
    vv!.moveTo(500); // schedules a rAF write
    stop(); // ...cancelled before it can run
    await vi.advanceTimersByTimeAsync(100);
    expect(publishedHeight()).toBe("900px");
  });
});

describe("waitForViewportSettle", () => {
  it("does not treat the first resize as settled while more are still coming", async () => {
    // The keyboard is open; it will animate away over several frames.
    setInnerHeight(900);
    vv!.height = 500;
    const settled = track(waitForViewportSettle());

    // First intermediate frame — this is exactly what the old code resolved on.
    vv!.moveTo(560);
    await flush();
    expect(settled.done).toBe(false);

    // More intermediate frames, each well inside the quiet window.
    for (const height of [620, 700, 780, 850]) {
      await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS / 2);
      vv!.moveTo(height);
      expect(settled.done).toBe(false);
    }
  });

  it("resolves once the viewport has stayed unchanged for the quiet period", async () => {
    setInnerHeight(900);
    vv!.height = 500;
    const settled = track(waitForViewportSettle());

    vv!.moveTo(700);
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS / 2);
    vv!.moveTo(900); // keyboard fully closed
    expect(settled.done).toBe(false);

    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50);
    expect(settled.done).toBe(true);
    expect(publishedHeight()).toBe("900px");
  });

  it("keeps waiting while the keyboard is still measurably covering the viewport, even if the numbers hold still", async () => {
    setInnerHeight(900);
    vv!.height = 500; // 400px inset — nowhere near closed
    const settled = track(waitForViewportSettle());
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS * 2);
    expect(settled.done).toBe(false);
    await vi.advanceTimersByTimeAsync(SETTLE_MAX_WAIT_MS);
    expect(settled.done).toBe(true); // ...but the ceiling still releases it
  });

  it("treats a moving offsetTop as 'still moving' even when height is constant", async () => {
    setInnerHeight(900);
    vv!.height = 900;
    const settled = track(waitForViewportSettle());
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS / 2);
      vv!.moveTo(900, 40 - i * 10);
      expect(settled.done).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50);
    expect(settled.done).toBe(true);
  });

  it("never waits longer than the maximum, even if the viewport never stops moving", async () => {
    setInnerHeight(900);
    vv!.height = 500;
    const settled = track(waitForViewportSettle());
    // Something is emitting resizes forever — iOS occasionally does exactly
    // this when its toolbar heuristic starts oscillating.
    const churn = setInterval(() => vv!.moveTo(500 + Math.round(Math.random() * 50)), 20);
    await vi.advanceTimersByTimeAsync(SETTLE_MAX_WAIT_MS + 100);
    clearInterval(churn);
    expect(settled.done).toBe(true);
  });

  it("resolves immediately when there is no visualViewport to watch", async () => {
    removeVisualViewport();
    const settled = track(waitForViewportSettle());
    await flush();
    expect(settled.done).toBe(true);
    expect(publishedHeight()).toBe("900px");
  });
});

describe("settleViewportBeforeAuth", () => {
  it("adds no delay to a desktop login, where no software keyboard exists", async () => {
    setMaxTouchPoints(0);
    expect(isSoftKeyboardCapable()).toBe(false);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus(); // a focused password field, but on a laptop

    const baseline = vi.getTimerCount();
    const settled = track(settleViewportBeforeAuth());
    await flush();
    expect(settled.done).toBe(true);
    // No settle monitor was started: no poll interval, no deadline timer.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline);
  });

  it("adds no delay to an auto-login, where nothing is focused at all", async () => {
    setMaxTouchPoints(5); // touch device — but no field in play
    const baseline = vi.getTimerCount();
    const settled = track(settleViewportBeforeAuth());
    await flush();
    expect(settled.done).toBe(true);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline);
  });

  it("blurs the focused field so the keyboard actually starts closing", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    await settleViewportBeforeAuth();
    expect(document.activeElement).not.toBe(input);
  });

  it("waits for the settled viewport on a touch device with a field focused", async () => {
    setMaxTouchPoints(5);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    setInnerHeight(900);
    vv!.height = 500;

    const settled = track(settleViewportBeforeAuth());
    await flush();
    expect(settled.done).toBe(false);

    vv!.moveTo(700);
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS / 2);
    expect(settled.done).toBe(false);

    vv!.moveTo(900);
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50);
    expect(settled.done).toBe(true);
    // The whole point: the height the shell is about to mount against is
    // the settled one, published before the promise resolved.
    expect(publishedHeight()).toBe("900px");
  });

  it("waits when a keyboard is measurably open even with nothing focused", async () => {
    setInnerHeight(900);
    vv!.height = 500;
    const settled = track(settleViewportBeforeAuth());
    await flush();
    expect(settled.done).toBe(false);
    vv!.moveTo(900);
    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS + 50);
    expect(settled.done).toBe(true);
  });
});

describe("syncViewportHeight", () => {
  it("batches bursts of events into a single frame", async () => {
    const setProperty = vi.spyOn(document.documentElement.style, "setProperty");
    for (let i = 0; i < 10; i += 1) syncViewportHeight();
    expect(setProperty).not.toHaveBeenCalled();
    await flush();
    // One frame → at most the two variables, not twenty writes.
    expect(setProperty.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("writes synchronously when asked to be immediate", () => {
    syncViewportHeight({ immediate: true });
    expect(publishedHeight()).toBe("900px");
  });

  it("does not rewrite a value that has not changed", async () => {
    syncViewportHeight({ immediate: true });
    const setProperty = vi.spyOn(document.documentElement.style, "setProperty");
    syncViewportHeight({ immediate: true });
    expect(setProperty).not.toHaveBeenCalled();
  });
});
