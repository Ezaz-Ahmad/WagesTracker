// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe, toHaveNoViolations } from "jest-axe";
import type { Job } from "../../lib/types";
import { DeleteJobDialog, AllJobsOverview, JobsSettings } from "../JobWorkspace";

expect.extend(toHaveNoViolations);
const { getImpact, deleteJob, useAppMock } = vi.hoisted(() => ({ getImpact: vi.fn(), deleteJob: vi.fn(), useAppMock: vi.fn() }));
vi.mock("../../context/AppContext", () => ({ useApp: useAppMock }));
vi.mock("../../lib/api", () => ({ getJobDeletionImpact: getImpact }));
const job: Job = { id: "job-one", name: "Harbour Hotel", role: "Reception", rate: 35, weekStartsOn: "Monday", goalHours: 20, goalEarnings: 700, smartRemindersEnabled: false, isPrimary: true, archived: false, createdAt: "2026-11-01" };
const impact = { jobId: job.id, name: job.name, hasRunningShift: false, lastJob: true, counts: { shifts: 12, locations: 3, payRates: 4, fuelAllowances: 5, weeklyExtras: 2, linkedExpenses: 6 } };
beforeEach(() => { vi.clearAllMocks(); getImpact.mockResolvedValue(impact); deleteJob.mockResolvedValue(undefined); useAppMock.mockReturnValue({ deleteJob, jobs: [job], selectJob: vi.fn(), updateJob: vi.fn(), allShifts: [], allDayExpenses: [], allWeekExtras: [], today: new Date("2026-11-21T12:00:00"), user: { goalEarnings: 700 }, shiftsLoaded: true }); });
afterEach(cleanup);

describe("job deletion review", () => {
  it("shows concrete impact and requires the exact name before deleting once", async () => {
    const close = vi.fn(); const { container } = render(<DeleteJobDialog job={job} onClose={close}/>);
    await screen.findByText("Linked spending");
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(screen.getByText(/future PDF reports/)).toBeTruthy();
    expect(screen.getByText(/last job/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete job & data" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Other employer" } });
    expect((screen.getByRole("button", { name: "Delete job & data" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: job.name } });
    fireEvent.click(screen.getByRole("button", { name: "Delete job & data" }));
    await waitFor(() => expect(deleteJob).toHaveBeenCalledWith(job.id, job.name));
    expect(deleteJob).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
    expect(await axe(container, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });
  it("cancels without mutation and blocks deleting a running job", async () => {
    getImpact.mockResolvedValue({ ...impact, hasRunningShift: true });
    const close = vi.fn(); render(<DeleteJobDialog job={job} onClose={close}/>);
    await screen.findByText(/End the running shift/);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect((screen.getByRole("button", { name: "Delete job & data" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep job" }));
    expect(close).toHaveBeenCalled(); expect(deleteJob).not.toHaveBeenCalled();
  });
  it("keeps the review open if deletion fails", async () => {
    deleteJob.mockRejectedValue(new Error("End the running shift before deleting this job."));
    const close = vi.fn(); render(<DeleteJobDialog job={job} onClose={close}/>);
    await screen.findByRole("textbox");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: job.name } });
    fireEvent.click(screen.getByRole("button", { name: "Delete job & data" }));
    expect((await screen.findByRole("alert")).textContent).toContain("End the running shift");
    expect(close).not.toHaveBeenCalled();
  });
  it("offers retry without enabling deletion when impact cannot be loaded", async () => {
    getImpact.mockRejectedValueOnce(new Error("Connection unavailable"));
    render(<DeleteJobDialog job={job} onClose={() => {}}/>);
    await screen.findByText("Connection unavailable"); expect(screen.queryByRole("button", { name: "Delete job & data" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("textbox"); expect(deleteJob).not.toHaveBeenCalled();
  });
  it("replaces archive actions with deletion and keeps spending out of All jobs", () => {
    const view = render(<JobsSettings onOpenWorkPay={() => {}}/>);
    expect(screen.getByRole("button", { name: `Delete ${job.name}` })).toBeTruthy();
    expect(screen.queryByText("Archive job")).toBeNull(); view.unmount();
    render(<AllJobsOverview onNavigate={() => {}}/>);
    expect(screen.queryByText("Personal spending")).toBeNull();
  });
  it("provides an add-job empty state after deleting the last job", () => {
    useAppMock.mockReturnValue({ ...useAppMock(), jobs: [] });
    render(<AllJobsOverview onNavigate={() => {}}/>);
    expect(screen.getByRole("heading", { name: "Your next job starts here." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a job" })).toBeTruthy();
  });
});
