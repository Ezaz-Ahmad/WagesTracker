// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChartReveal } from "../useChartReveal";

let intersectionCallback: IntersectionObserverCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0.12];

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }

  observe = observe;
  disconnect = disconnect;
  unobserve = vi.fn();
  takeRecords = () => [];
}

function installEnvironment(reducedMotion = false) {
  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    value: TestIntersectionObserver,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: reducedMotion,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function Harness({ show = true }: { show?: boolean }) {
  const reveal = useChartReveal<HTMLDivElement>();
  return show ? <div ref={reveal.ref} className={reveal.revealClassName}>Chart</div> : null;
}

beforeEach(() => {
  intersectionCallback = null;
  observe.mockClear();
  disconnect.mockClear();
  installEnvironment(false);
});

afterEach(cleanup);

describe("useChartReveal", () => {
  it("holds an off-screen chart at its start state until it intersects", () => {
    const { getByText } = render(<Harness />);
    const chart = getByText("Chart");
    expect(chart.className).toBe("chart-reveal");
    expect(observe).toHaveBeenCalledWith(chart);

    act(() => {
      intersectionCallback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(chart.className).toBe("chart-reveal");

    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(chart.className).toBe("chart-reveal is-chart-visible");
    expect(disconnect).toHaveBeenCalled();
  });

  it("reveals immediately when the user requests reduced motion", () => {
    installEnvironment(true);
    const { getByText } = render(<Harness />);
    expect(getByText("Chart").className).toBe("chart-reveal is-chart-visible");
    expect(observe).not.toHaveBeenCalled();
  });

  it("shows the final chart immediately when IntersectionObserver is unavailable", () => {
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined });
    const { getByText } = render(<Harness />);
    expect(getByText("Chart").className).toBe("chart-reveal is-chart-visible");
    expect(observe).not.toHaveBeenCalled();
  });

  it("disconnects its observer when the chart unmounts", () => {
    const view = render(<Harness />);
    expect(observe).toHaveBeenCalledOnce();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("starts observing when a chart replaces an initial loading state", () => {
    const view = render(<Harness show={false} />);
    expect(observe).not.toHaveBeenCalled();

    view.rerender(<Harness />);
    const chart = view.getByText("Chart");
    expect(observe).toHaveBeenCalledWith(chart);

    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(chart.className).toBe("chart-reveal is-chart-visible");
  });
});
