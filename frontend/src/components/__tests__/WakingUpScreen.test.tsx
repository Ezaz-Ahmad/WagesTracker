// @vitest-environment jsdom
//
// Component-level tests for the redesigned WakingUpScreen: the "no fake
// percentage" correction, the accessible status region, and the visible
// text/UI for each real state (connecting, slow, connected, offline,
// failed). The state-machine transitions themselves (attempt counting,
// elapsed time, retry, unmount safety) are covered directly against the
// hook in lib/__tests__/useHealthWakeup.test.tsx; this file only checks
// what actually renders and is exposed to assistive tech.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_WAIT_AFTER_SECONDS, SLOW_AFTER_SECONDS } from "../../lib/useHealthWakeup";
import { WakingUpScreen } from "../WakingUpScreen";

vi.mock("../../lib/api", () => ({ pingHealth: vi.fn() }));
import { pingHealth } from "../../lib/api";
const pingHealthMock = pingHealth as unknown as ReturnType<typeof vi.fn>;

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
}

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  mockReducedMotion(false);
  pingHealthMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WakingUpScreen — connecting", () => {
  it("shows the connecting caption, attempt 1, and an accessible status region — with no fake percentage anywhere", () => {
    pingHealthMock.mockImplementation(() => new Promise(() => {}));
    render(<WakingUpScreen />);

    expect(screen.getByRole("heading", { name: "Connecting securely" })).toBeTruthy();
    expect(screen.getByText("Checking your Wage Tracker service…")).toBeTruthy();
    expect(screen.getByText("Attempt 1 · 0:00 elapsed")).toBeTruthy();

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-label")).toBe("Preparing Wage Tracker");

    // No manufactured percentage anywhere, and no indeterminate element
    // exposing a fake numeric value.
    expect(screen.queryByText(/%/)).toBeNull();
    expect(document.querySelectorAll("[aria-valuenow]").length).toBe(0);
  });

  it("keeps the connection ring purely decorative", () => {
    pingHealthMock.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<WakingUpScreen />);
    const ring = container.querySelector(".connection-ring");
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("WakingUpScreen — slow server", () => {
  it("shows the 'taking a little longer' explanation once the threshold passes", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<WakingUpScreen />);

    for (let i = 0; i < Math.ceil((SLOW_AFTER_SECONDS + 5) / 3); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    expect(screen.getByText("Still starting")).toBeTruthy();
    const hint = screen.getByText(/slower than usual/i);
    expect(hint.getAttribute("aria-hidden")).toBeNull();
  });

  it("acknowledges a long wait and offers a restart while automatic checks continue", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<WakingUpScreen />);

    for (let i = 0; i < Math.ceil((LONG_WAIT_AFTER_SECONDS + 5) / 3); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    expect(screen.getByRole("heading", { name: "Taking longer than usual" })).toBeTruthy();
    expect(screen.getByText(/keep trying/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeTruthy();
  });
});

describe("WakingUpScreen — connected", () => {
  it("shows no percentage at all while still waiting", () => {
    pingHealthMock.mockImplementation(() => new Promise(() => {}));
    render(<WakingUpScreen />);
    expect(screen.queryByText("100%")).toBeNull();
  });

  it("shows a ready state and checkmark only after a genuine successful response", async () => {
    pingHealthMock.mockResolvedValue(true);
    const { container } = render(<WakingUpScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Loading your latest shifts and account information…")).toBeTruthy();
    expect(screen.getByText("Service ready")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(container.querySelector(".connection-ring-check")).toBeTruthy();
  });
});

describe("WakingUpScreen — offline", () => {
  it("shows a distinct offline message (not a server-waking one) with a focused Retry button", () => {
    setOnline(false);
    render(<WakingUpScreen />);

    expect(screen.getByRole("heading", { name: "You’re offline" })).toBeTruthy();
    const caption = screen.getByText("Reconnect to the internet, then try again.");
    expect(caption.textContent).not.toMatch(/server/i);
    expect(pingHealthMock).not.toHaveBeenCalled();

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(document.activeElement).toBe(retryBtn);
  });
});

describe("WakingUpScreen — max-wait failure", () => {
  it("shows the unable-to-connect message with a Retry button after the max wait", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<WakingUpScreen />);

    for (let i = 0; i < 42; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    expect(screen.getByRole("heading", { name: "We couldn’t start your workspace" })).toBeTruthy();
    expect(screen.getByText(/service didn’t respond/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeTruthy();
  });
});

describe("WakingUpScreen — reduced motion", () => {
  it("marks the connection ring static when the OS prefers reduced motion", () => {
    mockReducedMotion(true);
    pingHealthMock.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<WakingUpScreen />);
    expect(container.querySelector(".connection-ring.is-static")).toBeTruthy();
    // Text updates still work under reduced motion — the caption is present
    // and readable, just without the spin.
    expect(screen.getByText("Checking your Wage Tracker service…")).toBeTruthy();
  });
});
