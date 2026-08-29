// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLiveClockDiagnostics, resetLiveClockForTests } from "../liveClock";
import { useLiveElapsedHours } from "../useLiveElapsedHours";
import { useShiftTimer } from "../useShiftTimer";

function LiveValues() {
  const hours = useLiveElapsedHours(true, "11:00:00");
  const timer = useShiftTimer(true, "11:00:00");
  return <><span data-testid="hours">{hours.toFixed(4)}</span><span data-testid="timer">{timer}</span></>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T12:00:00"));
  resetLiveClockForTests();
});

afterEach(() => {
  cleanup();
  resetLiveClockForTests();
  vi.useRealTimers();
});

describe("authoritative live clock", () => {
  it("uses one interval for multiple live-value subscribers and stops it after unmount", async () => {
    const view = render(<LiveValues />);
    expect(getLiveClockDiagnostics()).toMatchObject({ subscribers: 2, running: true, tickCount: 0 });
    expect(screen.getByTestId("timer").textContent).toBe("01:00:00");

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(getLiveClockDiagnostics()).toMatchObject({ subscribers: 2, running: true, tickCount: 2 });
    expect(screen.getByTestId("timer").textContent).toBe("01:00:02");

    view.unmount();
    expect(getLiveClockDiagnostics()).toMatchObject({ subscribers: 0, running: false });
  });

  it("pauses the shared interval while the app is backgrounded and catches up on return", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    render(<LiveValues />);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getLiveClockDiagnostics().running).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getLiveClockDiagnostics().tickCount).toBe(0);

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(getLiveClockDiagnostics()).toMatchObject({ running: true, tickCount: 1 });
    expect(screen.getByTestId("timer").textContent).toBe("01:00:05");
  });
});
