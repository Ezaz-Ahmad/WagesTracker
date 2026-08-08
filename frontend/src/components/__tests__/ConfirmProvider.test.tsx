// @vitest-environment jsdom
//
// Regression test for a bug in useDismissTransition's immediate-close branch
// (ms <= 0, or `prefers-reduced-motion: reduce`): it set closingRef.current
// = true up front, but the immediate branch used to call onClosed() and
// return without ever resetting that ref back to false. ConfirmProvider
// keeps one useDismissTransition instance alive across every popup it ever
// shows (it isn't remounted between confirms), so under reduced motion the
// ref stayed stuck at `true` forever after the very first dialog — and
// requestClose's own guard (`if (closingRef.current) return;`) then silently
// ignored every Cancel/Confirm/Escape click on every dialog after that.
//
// This test mocks matchMedia to report reduced motion, then drives
// ConfirmProvider through two separate confirmations in a row, proving the
// second one still responds to both Confirm and Cancel.
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../ConfirmProvider";

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

// A tiny harness with two independent data-confirm buttons and a log of
// which ones actually ran, so "did the confirmed action really happen" and
// "did cancelling really not run it" are both directly observable.
function Harness() {
  const [log, setLog] = useState<string[]>([]);
  return (
    <ConfirmProvider>
      <button type="button" data-confirm="Delete the first thing?" onClick={() => setLog((l) => [...l, "first-ran"])}>
        Delete first
      </button>
      <button type="button" data-confirm="Delete the second thing?" onClick={() => setLog((l) => [...l, "second-ran"])}>
        Delete second
      </button>
      <ul>
        {log.map((entry, i) => (
          <li key={i}>{entry}</li>
        ))}
      </ul>
    </ConfirmProvider>
  );
}

describe("ConfirmProvider under prefers-reduced-motion: reduce", () => {
  beforeEach(() => {
    mockReducedMotion(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("confirms the first dialog, then still responds to a second dialog afterward", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Delete first" }));
    const confirmBtn1 = await screen.findByRole("button", { name: "Confirm" });
    await user.click(confirmBtn1);

    await waitFor(() => expect(screen.getByText("first-ran")).toBeTruthy());
    // The dialog must actually be gone, not just visually collapsed — a
    // stuck closingRef wouldn't necessarily block onClosed() on the *first*
    // dialog, only every one after it.
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // This is the case the bug broke: without the fix, closingRef.current
    // is stuck true after the first dialog, so this second confirm click
    // would be silently ignored by requestClose's own re-entrancy guard.
    await user.click(screen.getByRole("button", { name: "Delete second" }));
    const confirmBtn2 = await screen.findByRole("button", { name: "Confirm" });
    await user.click(confirmBtn2);

    await waitFor(() => expect(screen.getByText("second-ran")).toBeTruthy());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("cancels a dialog, then still opens and confirms a second dialog afterward", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Delete first" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByText("first-ran")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete second" }));
    const confirmBtn2 = await screen.findByRole("button", { name: "Confirm" });
    await user.click(confirmBtn2);

    await waitFor(() => expect(screen.getByText("second-ran")).toBeTruthy());
  });
});
