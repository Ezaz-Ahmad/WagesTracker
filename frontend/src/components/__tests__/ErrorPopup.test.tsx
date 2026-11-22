// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe, toHaveNoViolations } from "jest-axe";
import { ErrorPopup } from "../ErrorPopup";
import { showErrorPopup } from "../../lib/errorFeedback";
import { JobDialog } from "../JobWorkspace";

expect.extend(toHaveNoViolations);
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("ErrorPopup", () => {
  it("explains the failure and returns focus to the relevant field without clearing it", async () => {
    const user = userEvent.setup();
    render(<><input data-error-field="email" defaultValue="sam@gmial.com" /><ErrorPopup /></>);
    showErrorPopup({
      title: "Check the email",
      message: "That domain may be misspelled.",
      hint: "Use the suggestion or keep the address you entered.",
      field: "email",
      suggestion: "sam@gmail.com",
    });
    expect(await screen.findByRole("alertdialog", { name: "Check the email" })).toBeTruthy();
    expect(screen.getByText("sam@gmail.com")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Review and fix" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    const input = screen.getByDisplayValue("sam@gmial.com");
    expect(document.activeElement).toBe(input);
  });

  it("shows accessible job and overnight comparisons", async () => {
    render(<main><ErrorPopup /></main>);
    act(() => showErrorPopup({ title: "These shifts overlap", message: "Your change uses time already recorded in a saved shift.", actionLabel: "Review times", conflict: { kind: "overlap", attempted: { jobName: "Harbour Café", location: "Waterfront", date: "2026-11-22", signIn: "12:20", signOut: "00:20" }, conflicts: [{ jobName: "City Retail", location: "Newcastle", date: "2026-11-22", signIn: "09:00", signOut: "17:00" }], totalConflicts: 1 } }));
    const dialog = screen.getByRole("alertdialog", { name: "These shifts overlap" });
    expect(dialog.textContent).toContain("Harbour Café"); expect(dialog.textContent).toContain("City Retail");
    expect(dialog.textContent).toContain("12:20 pm"); expect(dialog.textContent).toContain("12:20 am");
    expect(dialog.textContent).toContain("Ends Mon, 23 Nov 2026");
    expect(await axe(document.body, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });

  it("does not let a closing dialog erase a newer failure", () => {
    vi.useFakeTimers(); render(<ErrorPopup />);
    act(() => showErrorPopup({ title: "First issue", message: "First details" }));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    act(() => { vi.advanceTimersByTime(100); showErrorPopup({ title: "New issue", message: "New details" }); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole("alertdialog", { name: "New issue" })).toBeTruthy();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  });

  it("coalesces repeated errors without restarting the dialog", () => {
    render(<ErrorPopup />);
    const error = { title: "Check the amount", message: "Amount must be greater than zero." };
    act(() => showErrorPopup(error)); const dialog = screen.getByRole("alertdialog");
    act(() => { showErrorPopup(error); showErrorPopup(error); });
    expect(screen.getByRole("alertdialog")).toBe(dialog);
  });

  it("names a required field and focuses it even without a field marker", async () => {
    render(<><label htmlFor="job-name">Job name</label><input id="job-name" required /><ErrorPopup /></>);
    const input = screen.getByLabelText("Job name");
    fireEvent.invalid(input);
    expect(await screen.findByRole("alertdialog", { name: "Check job name" })).toBeTruthy();
    expect(screen.getByText("Job name is required.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review field" }));
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("dismisses immediately for reduced motion and can open again", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true }))); render(<ErrorPopup />);
    act(() => showErrorPopup({ message: "Please wait a moment." }));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    act(() => showErrorPopup({ title: "Another issue", message: "Review these details." }));
    expect(screen.getByRole("alertdialog", { name: "Another issue" })).toBeTruthy();
  });

  it("keeps the underlying editor open when Escape dismisses an error", async () => {
    const closeEditor = vi.fn();
    render(<><JobDialog title="Edit job" onClose={closeEditor}><input aria-label="Job name" defaultValue="Keep my draft" /></JobDialog><ErrorPopup /></>);
    act(() => showErrorPopup({ title: "Check the amount", message: "Enter a positive amount." }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(closeEditor).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Keep my draft")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Edit job" })).toBeTruthy();
  });

  it("restores scrolling if an underlying editor unmounts before the popup", async () => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "auto";
    const tree = (editor: boolean) => <><div>{editor && <JobDialog title="Edit job" onClose={() => {}}>Editor</JobDialog>}</div><ErrorPopup /></>;
    const { rerender } = render(tree(true));
    act(() => showErrorPopup({ message: "Your sign-in expired." }));
    rerender(tree(false));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = previous;
  });
});
