// @vitest-environment jsdom
//
// Tests for the health-wakeup state machine itself (useHealthWakeup.ts) —
// the "no fake percentage" fix. A `/api/health` response only ever tells us
// "hasn't answered yet" or "just answered successfully," so this hook must
// never manufacture a number in between; these tests drive it through every
// real transition (automatic retry loop, offline, max-wait failure, manual
// retry, unmount) using a mocked pingHealth and fake timers, asserting only
// on values the hook can genuinely know: phase, attempt count, and elapsed
// time.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_WAIT_AFTER_SECONDS, MAX_WAIT_SECONDS, SLOW_AFTER_SECONDS, useHealthWakeup } from "../useHealthWakeup";

vi.mock("../api", () => ({ pingHealth: vi.fn() }));
import { pingHealth } from "../api";
const pingHealthMock = pingHealth as unknown as ReturnType<typeof vi.fn>;

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
}

function Harness() {
  const { phase, attempt, elapsedSec, retryBusy, retry } = useHealthWakeup();
  return (
    <div>
      <div data-testid="phase">{phase}</div>
      <div data-testid="attempt">{attempt}</div>
      <div data-testid="elapsed">{Math.floor(elapsedSec)}</div>
      <div data-testid="retryBusy">{String(retryBusy)}</div>
      <button type="button" onClick={retry}>
        retry
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  pingHealthMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useHealthWakeup — initial state", () => {
  it("starts connecting, attempt 1, before anything has resolved", () => {
    pingHealthMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<Harness />);
    expect(screen.getByTestId("phase").textContent).toBe("connecting");
    expect(screen.getByTestId("attempt").textContent).toBe("1");
  });
});

describe("useHealthWakeup — automatic retry loop", () => {
  it("moves to waking after a failed check, then to connected once a later one succeeds", async () => {
    pingHealthMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<Harness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("phase").textContent).toBe("waking");
    expect(screen.getByTestId("attempt").textContent).toBe("2");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000); // past the retry delay
    });
    expect(screen.getByTestId("phase").textContent).toBe("connected");
  });

  it("keeps a real attempt counter across several automatic failures", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<Harness />);

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    // One failure already resolved at mount (attempt->2), plus 3 more cycles.
    expect(Number(screen.getByTestId("attempt").textContent)).toBeGreaterThanOrEqual(4);
    expect(pingHealthMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("only ever has one health request in flight at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    pingHealthMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          setTimeout(() => {
            inFlight -= 1;
            resolve(false);
          }, 400);
        })
    );
    render(<Harness />);

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(maxInFlight).toBe(1);
  });

  it("shows a genuine elapsed-time figure once past the first failure", async () => {
    pingHealthMock.mockResolvedValueOnce(false); // first attempt fails right away
    pingHealthMock.mockImplementationOnce(() => new Promise(() => {})); // second attempt hangs
    render(<Harness />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14000);
    });
    expect(screen.getByTestId("phase").textContent).toBe("waking");
    expect(screen.getByTestId("attempt").textContent).toBe("2");
    expect(screen.getByTestId("elapsed").textContent).toBe("14");
  });

  it("moves to the slow phase once elapsed time passes the threshold, regardless of attempt timing", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<Harness />);

    for (let i = 0; i < Math.ceil((SLOW_AFTER_SECONDS + 5) / 3); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(screen.getByTestId("phase").textContent).toBe("slow");
  });

  it("moves to the long-wait phase before the automatic loop gives up", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<Harness />);

    for (let i = 0; i < Math.ceil((LONG_WAIT_AFTER_SECONDS + 5) / 3); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(screen.getByTestId("phase").textContent).toBe("long");
  });
});

describe("useHealthWakeup — offline", () => {
  it("starts in the offline phase and never pings when already offline", () => {
    setOnline(false);
    render(<Harness />);
    expect(screen.getByTestId("phase").textContent).toBe("offline");
    expect(pingHealthMock).not.toHaveBeenCalled();
  });
});

describe("useHealthWakeup — max-wait failure", () => {
  it("stops the automatic loop and reports failed after the max wait, without pinging further", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<Harness />);

    for (let i = 0; i < Math.ceil((MAX_WAIT_SECONDS + 5) / 3); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(screen.getByTestId("phase").textContent).toBe("failed");
    const callsAtFailure = pingHealthMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(pingHealthMock.mock.calls.length).toBe(callsAtFailure);
  });
});

describe("useHealthWakeup — retry", () => {
  it("resets attempt and elapsed time immediately, then resumes a genuinely new request", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<Harness />);
    for (let i = 0; i < Math.ceil((MAX_WAIT_SECONDS + 5) / 3); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(screen.getByTestId("phase").textContent).toBe("failed");
    const callsBeforeRetry = pingHealthMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    // The reset itself is synchronous with the click — attempt and elapsed
    // time are back to their starting values immediately, before the
    // retry's own request has even resolved.
    expect(screen.getByTestId("attempt").textContent).toBe("1");
    expect(Number(screen.getByTestId("elapsed").textContent)).toBeLessThanOrEqual(1);
    expect(screen.getByTestId("retryBusy").textContent).toBe("true");
    expect(screen.getByTestId("phase").textContent).not.toBe("failed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // A real new request genuinely went out — since it fails too (same
    // mock), the automatic loop naturally continues from here (attempt 2),
    // proving retry didn't just reset state and stop.
    expect(pingHealthMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    expect(screen.getByTestId("retryBusy").textContent).toBe("false");
    expect(screen.getByTestId("attempt").textContent).toBe("2");
  });

  it("goes straight to connected when the retry check itself succeeds", async () => {
    pingHealthMock.mockResolvedValue(false);
    render(<Harness />);
    for (let i = 0; i < Math.ceil((MAX_WAIT_SECONDS + 5) / 3); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    expect(screen.getByTestId("phase").textContent).toBe("failed");

    pingHealthMock.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("phase").textContent).toBe("connected");
  });
});

describe("useHealthWakeup — unmount safety", () => {
  it("aborts the in-flight request on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    pingHealthMock.mockImplementation((_timeout: number, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves on its own
    });
    const { unmount } = render(<Harness />);
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("never updates state after unmount, even if a stale request resolves late", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let resolvePing: ((ok: boolean) => void) | undefined;
    pingHealthMock.mockImplementation(() => new Promise<boolean>((resolve) => (resolvePing = resolve)));
    const { unmount } = render(<Harness />);
    unmount();

    await act(async () => {
      resolvePing?.(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
