// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePullToRefresh } from "../usePullToRefresh";
import { useSwipeNav } from "../useSwipeNav";

let rafCallbacks: FrameRequestCallback[] = [];
let rafId = 0;

function flushAnimationFrames() {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((callback) => callback(performance.now()));
}

beforeEach(() => {
  rafCallbacks = [];
  rafId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    rafCallbacks.push(callback);
    return ++rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    if (id > 0) rafCallbacks = [];
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("gesture stability", () => {
  it("does not render or move the page during vertical and ambiguous diagonal touches", () => {
    const navigate = vi.fn();
    let renders = 0;

    function Harness() {
      renders += 1;
      const { ref } = useSwipeNav<HTMLDivElement>(1, 3, navigate);
      return <div ref={ref} data-testid="surface"><span>Content</span></div>;
    }

    render(<Harness />);
    const surface = screen.getByTestId("surface");

    fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 50 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 170, clientY: 145 }] });
    fireEvent.touchEnd(surface);

    fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 50 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 125, clientY: 110 }] });
    fireEvent.touchEnd(surface);

    expect(navigate).not.toHaveBeenCalled();
    expect(renders).toBe(1);
    expect(surface.style.transform).toBe("");
  });

  it("commits only a confident horizontal swipe on release and ignores controls and cancellation", () => {
    const navigate = vi.fn();

    function Harness() {
      const { ref } = useSwipeNav<HTMLDivElement>(1, 3, navigate);
      return <div ref={ref} data-testid="surface"><button type="button">Control</button></div>;
    }

    render(<Harness />);
    const surface = screen.getByTestId("surface");
    fireEvent.touchStart(surface, { touches: [{ clientX: 220, clientY: 60 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 120, clientY: 70 }] });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.touchEnd(surface);
    expect(navigate).toHaveBeenCalledWith(2);

    navigate.mockClear();
    fireEvent.touchStart(surface, { touches: [{ clientX: 220, clientY: 60 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 110, clientY: 65 }] });
    fireEvent.touchCancel(surface);
    expect(navigate).not.toHaveBeenCalled();

    const control = screen.getByRole("button", { name: "Control" });
    fireEvent.touchStart(control, { touches: [{ clientX: 220, clientY: 60 }] });
    fireEvent.touchMove(control, { touches: [{ clientX: 100, clientY: 65 }] });
    fireEvent.touchEnd(control);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("moves only the refresh indicator during pull distance and renders only at refresh boundaries", async () => {
    let finishRefresh!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
    let renders = 0;

    function Harness() {
      renders += 1;
      const containerRef = useRef<HTMLDivElement>(null);
      const { indicatorRef, refreshing } = usePullToRefresh(containerRef, true, refresh);
      return (
        <div ref={containerRef} data-testid="container">
          <div ref={indicatorRef} data-testid="indicator" data-refreshing={refreshing} />
        </div>
      );
    }

    render(<Harness />);
    const container = screen.getByTestId("container");
    const indicator = screen.getByTestId("indicator");

    fireEvent.touchStart(container, { touches: [{ clientX: 100, clientY: 20 }] });
    fireEvent.touchMove(container, { touches: [{ clientX: 103, clientY: 100 }] });
    act(flushAnimationFrames);

    expect(renders).toBe(1);
    expect(container.style.transform).toBe("");
    expect(indicator.style.transform).toContain("translate3d(-50%, 68px, 0)");
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.touchEnd(container);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(renders).toBe(2);

    await act(async () => {
      finishRefresh();
      await Promise.resolve();
    });
    act(flushAnimationFrames);
    expect(renders).toBe(3);
    expect(indicator.style.opacity).toBe("0");
  });

  it("does not start pull-to-refresh away from scroll top", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);

    function Harness() {
      const containerRef = useRef<HTMLDivElement>(null);
      const { indicatorRef } = usePullToRefresh(containerRef, true, refresh);
      return <div ref={containerRef} data-testid="container"><div ref={indicatorRef} data-testid="indicator" /></div>;
    }

    render(<Harness />);
    const container = screen.getByTestId("container");
    Object.defineProperty(container, "scrollTop", { configurable: true, value: 24 });
    fireEvent.touchStart(container, { touches: [{ clientX: 100, clientY: 20 }] });
    fireEvent.touchMove(container, { touches: [{ clientX: 102, clientY: 120 }] });
    fireEvent.touchEnd(container);
    act(flushAnimationFrames);

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("indicator").style.transform).toBe("");
  });
});
