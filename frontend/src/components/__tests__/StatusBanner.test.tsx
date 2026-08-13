// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBanner } from "../StatusBanner";

afterEach(() => vi.useRealTimers());

describe("transient status notifications", () => {
  it("auto-dismisses a closable notification after the standard interval", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<StatusBanner tone="info" onDismiss={dismiss}>Session updated</StatusBanner>);

    act(() => vi.advanceTimersByTime(7999));
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("pauses dismissal while the user is reading or interacting with it", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<StatusBanner tone="danger" onDismiss={dismiss}>Your session expired</StatusBanner>);
    const notification = screen.getByRole("alert");

    act(() => vi.advanceTimersByTime(4000));
    fireEvent.mouseEnter(notification);
    act(() => vi.advanceTimersByTime(10000));
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(notification);
    act(() => vi.advanceTimersByTime(8000));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("keeps validation banners persistent when no dismiss action is supplied", () => {
    vi.useFakeTimers();
    render(<StatusBanner tone="danger">Correct the highlighted field</StatusBanner>);
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByText("Correct the highlighted field")).toBeTruthy();
  });
});
