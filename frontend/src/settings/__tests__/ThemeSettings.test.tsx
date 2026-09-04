// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, ThemeProvider } from "../../context/ThemeContext";
import { ThemeSettings } from "../ThemeSettings";

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

describe("ThemeSettings", () => {
  it("offers Light, Dark and System as one accessible saved choice", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeSettings /></ThemeProvider>);

    const light = screen.getByRole("radio", { name: /Light\. Bright and clear/i });
    const dark = screen.getByRole("radio", { name: /Dark\. Comfortable at night/i });
    const system = screen.getByRole("radio", { name: /System\. Match this device/i });
    expect((system as HTMLInputElement).checked).toBe(true);

    await user.click(dark);
    expect((dark as HTMLInputElement).checked).toBe(true);
    expect((light as HTMLInputElement).checked).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByText("Dark mode")).toBeTruthy();
  });
});
