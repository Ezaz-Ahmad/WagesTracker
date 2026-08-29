// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncButton } from "../AsyncButton";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AsyncButton", () => {
  it("disables duplicate actions and announces the busy label immediately", () => {
    const onClick = vi.fn();
    const { rerender } = render(<AsyncButton className="btn" busy={false} idleLabel="Save" busyLabel="Saving…" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<AsyncButton className="btn" busy idleLabel="Save" busyLabel="Saving…" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("delays only the spinner so instant operations do not flash it", async () => {
    const { container, rerender } = render(<AsyncButton className="btn" busy idleLabel="Save" busyLabel="Saving…" />);
    expect(container.querySelector(".compact-loader.is-visible")).toBeNull();
    rerender(<AsyncButton className="btn" busy={false} idleLabel="Save" busyLabel="Saving…" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(container.querySelector(".compact-loader.is-visible")).toBeNull();

    rerender(<AsyncButton className="btn" busy idleLabel="Save" busyLabel="Saving…" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(container.querySelector(".compact-loader.is-visible")).toBeTruthy();
  });
});
