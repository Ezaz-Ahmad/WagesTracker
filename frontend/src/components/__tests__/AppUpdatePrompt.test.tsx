// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdatePrompt } from "../AppUpdatePrompt";
import { APP_STORE_URL, configureAppUpdates } from "../../platform/appUpdates";
import { configureAppLifecycleAdapter } from "../../platform/appLifecycle";

let resume: () => void;
let lookup = vi.fn();
const update = { installedVersion: "1.22.0", latestVersion: "1.23.0" };
beforeEach(() => {
  localStorage.clear();
  lookup = vi.fn().mockResolvedValue(update);
  configureAppUpdates({ lookup });
  configureAppLifecycleAdapter({ addResumeListener: async (listener) => { resume = listener; return { remove: vi.fn() }; } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("App Store update prompt", () => {
  it("offers the correct listing, traps focus, and has no accessibility violations", async () => {
    const user = userEvent.setup();
    render(<StrictMode><AppUpdatePrompt enabled /></StrictMode>);
    const dialog = await screen.findByRole("dialog", { name: "An update is ready" });
    const link = screen.getByRole("link", { name: "Update now" });
    expect(link.getAttribute("href")).toBe(APP_STORE_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    await waitFor(() => expect(document.activeElement).toBe(link));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Not now" }));
    await user.tab();
    expect(document.activeElement).toBe(link);
    expect((await axe(dialog)).violations).toEqual([]);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("dismisses without blocking the app and suppresses a reminder on resume", async () => {
    const user = userEvent.setup();
    render(<><button>Settings</button><AppUpdatePrompt enabled /></>);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Not now" }));
    resume();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("defers to another dialog and offers the update when that dialog closes", async () => {
    const { rerender } = render(<><div role="dialog" aria-modal="true">Finish your shift</div><AppUpdatePrompt enabled /></>);
    await waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "An update is ready" })).toBeNull();
    rerender(<AppUpdatePrompt enabled />);
    expect(await screen.findByRole("dialog", { name: "An update is ready" })).toBeTruthy();
  });

  it("waits for authentication and hides on public-page navigation", async () => {
    const { rerender } = render(<AppUpdatePrompt enabled={false} />);
    expect(lookup).not.toHaveBeenCalled();
    rerender(<AppUpdatePrompt enabled />);
    await screen.findByRole("dialog");
    rerender(<AppUpdatePrompt enabled={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not show a popup for a current release or a failed offline check", async () => {
    lookup.mockResolvedValue(null);
    render(<AppUpdatePrompt enabled />);
    await waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    configureAppUpdates({ lookup: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<AppUpdatePrompt enabled />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dismisses with Escape and restores the previously focused control", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<><button>Settings</button><AppUpdatePrompt enabled={false} /></>);
    screen.getByRole("button", { name: "Settings" }).focus();
    rerender(<><button>Settings</button><AppUpdatePrompt enabled /></>);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  });

  it("shows the real version labels again after 48 hours while the app remains open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T00:00:00Z"));
    render(<AppUpdatePrompt enabled />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Installed 1.22.0")).toBeTruthy();
    expect(screen.getByText("Latest 1.23.0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    lookup.mockResolvedValue({ ...update, latestVersion: "1.23.1" });
    await act(async () => { await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000 - 1); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("dialog", { name: "An update is ready" })).toBeTruthy();
    expect(screen.getByText("Installed 1.22.0")).toBeTruthy();
    expect(screen.getByText("Latest 1.23.1")).toBeTruthy();
  });

  it("does not remind at 48 hours when the installed app is already up to date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T00:00:00Z"));
    render(<AppUpdatePrompt enabled />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    lookup.mockResolvedValue({ installedVersion: "1.23.0", latestVersion: "1.23.0" });
    await act(async () => { await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
