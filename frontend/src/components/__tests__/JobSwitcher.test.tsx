// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe, toHaveNoViolations } from "jest-axe";
import { JobSwitcher } from "../JobWorkspace";
import type { Job } from "../../lib/types";
expect.extend(toHaveNoViolations);
const { useAppMock, selectJob } = vi.hoisted(() => ({ useAppMock: vi.fn(), selectJob: vi.fn() }));
vi.mock("../../context/AppContext", () => ({ useApp: useAppMock }));
const jobs: Job[] = [
  { id: "one", name: "City Retail", role: "Retail assistant", rate: 30, weekStartsOn: "Monday", goalHours: 20, goalEarnings: 600, smartRemindersEnabled: false, isPrimary: true, archived: false, createdAt: "2026-11-01" },
  { id: "two", name: "Harbour Hotel", role: "Guest services", rate: 40, weekStartsOn: "Wednesday", goalHours: 10, goalEarnings: 400, smartRemindersEnabled: false, isPrimary: false, archived: false, createdAt: "2026-11-01" },
];
const state = () => ({ jobs, selectedJobId: "one", selectedJob: jobs[0], selectJob, allShifts: [], earningsHidden: false });
beforeEach(() => {
  vi.clearAllMocks(); useAppMock.mockReturnValue(state());
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function open(onManageJobs = vi.fn()) {
  render(<main><JobSwitcher onManageJobs={onManageJobs}/></main>);
  const trigger = screen.getByRole("button", { name: /City Retail/ });
  trigger.focus(); fireEvent.click(trigger);
  return trigger;
}

describe("job picker interaction", () => {
  it("finishes its exit before changing jobs, ignores repeated selection and restores focus", () => {
    vi.useFakeTimers(); const trigger = open();
    expect(trigger.textContent).toContain("$30.00/hr default");
    const choice = screen.getByRole("button", { name: /Harbour Hotel/ });
    fireEvent.click(choice); fireEvent.click(choice);
    expect(choice.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("dialog").classList.contains("is-closing")).toBe(true);
    expect(selectJob).not.toHaveBeenCalled();
    act(() => { vi.runAllTimers(); });
    expect(selectJob).toHaveBeenCalledExactlyOnceWith("two");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("hands off to job management after closing", () => {
    vi.useFakeTimers(); const manage = vi.fn(); open(manage);
    fireEvent.click(screen.getByRole("button", { name: "Manage jobs" }));
    expect(manage).not.toHaveBeenCalled();
    act(() => { vi.runAllTimers(); });
    expect(manage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("closes the picker before opening the add-job form", () => {
    vi.useFakeTimers(); open();
    fireEvent.click(screen.getByRole("button", { name: "Add another job" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    act(() => { vi.runAllTimers(); });
    expect(screen.getByRole("dialog", { name: "Add another job" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Choose your view" })).toBeNull();
  });
  it("switches immediately when reduced motion is enabled", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true }))); open();
    fireEvent.click(screen.getByRole("button", { name: /All jobs/ }));
    expect(selectJob).toHaveBeenCalledExactlyOnceWith("all");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps job rates private and exposes accessible dialog controls", async () => {
    useAppMock.mockReturnValue({ ...state(), earningsHidden: true }); open();
    expect(screen.getAllByText(/Pay hidden/)).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/\$(30|40)\.00/);
    expect(await axe(document.body, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });
});
