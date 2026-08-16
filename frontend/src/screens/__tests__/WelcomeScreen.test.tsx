// @vitest-environment jsdom
//
// The mobile-only welcome/intro screen shown before every login (see
// App.tsx's Root). Covers: it renders the same marketing copy as
// AuthScreen's desktop hero, the "Get started" button is the real,
// always-present way to dismiss it (see WelcomeScreen.tsx's own doc comment
// on why the swipe gesture alone can't be), and it never itself does
// anything besides calling the `onContinue` prop it was given — the actual
// "shown again after logout" behavior lives in App.tsx's Root and is
// covered end-to-end in welcomeScreen.test.tsx.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeScreen } from "../WelcomeScreen";

afterEach(cleanup);

describe("WelcomeScreen", () => {
  it("shows the same marketing headline and feature list as AuthScreen's desktop hero", () => {
    render(<WelcomeScreen onContinue={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Track your hours\.\s*Know your worth\./);
    expect(screen.getByText("Clock in & out")).toBeTruthy();
    expect(screen.getByText("Set weekly goals")).toBeTruthy();
    expect(screen.getByText("Export PDF reports")).toBeTruthy();
  });

  it("calls onContinue when the Get started button is tapped", async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<WelcomeScreen onContinue={onContinue} />);

    await user.click(screen.getByRole("button", { name: "Get started" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("is reachable and operable from the keyboard alone, not only by swipe or pointer", async () => {
    // The swipe gesture (useSwipeUp) is a progressive enhancement with no
    // keyboard equivalent — this button is what actually has to satisfy
    // keyboard/switch-control/screen-reader access to the same action.
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<WelcomeScreen onContinue={onContinue} />);

    const button = screen.getByRole("button", { name: "Get started" });
    button.focus();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("keeps the swipe hint out of the accessibility tree, since the button already announces the same action", () => {
    render(<WelcomeScreen onContinue={() => {}} />);
    expect(screen.getByText("Swipe up to continue").closest('[aria-hidden="true"]')).toBeTruthy();
  });
});
