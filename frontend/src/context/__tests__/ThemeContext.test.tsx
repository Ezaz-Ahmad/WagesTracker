// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  readThemePreference,
  resolveTheme,
  useTheme,
  writeThemePreference,
} from "../ThemeContext";

let systemDark = false;
const changeListeners = new Set<() => void>();

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      get matches() { return systemDark; },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_name: string, listener: () => void) => changeListeners.add(listener),
      removeEventListener: (_name: string, listener: () => void) => changeListeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function Harness() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <>
      <output>{preference}:{resolvedTheme}</output>
      <button onClick={() => setPreference("light")}>Light</button>
      <button onClick={() => setPreference("system")}>System</button>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  systemDark = false;
  changeListeners.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
  document.documentElement.classList.remove("theme-transitioning");
  document.head.innerHTML = '<meta name="theme-color" content="#f6f4f3">';
  installMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("theme preference", () => {
  it("defaults safely to system and rejects invalid persisted values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("persists a valid explicit preference", () => {
    writeThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference()).toBe("dark");
  });

  it("applies a saved theme to the whole document and updates the browser chrome", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeProvider><Harness /></ThemeProvider>);

    await screen.findByText("dark:dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#000000");

    await userEvent.click(screen.getByRole("button", { name: "Light" }));
    await screen.findByText("light:light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("tracks device appearance changes while System is selected", async () => {
    systemDark = false;
    render(<ThemeProvider><Harness /></ThemeProvider>);
    await screen.findByText("system:light");

    systemDark = true;
    changeListeners.forEach((listener) => listener());
    await waitFor(() => expect(screen.getByText("system:dark")).toBeTruthy());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
