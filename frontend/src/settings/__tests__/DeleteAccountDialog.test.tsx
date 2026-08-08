// @vitest-environment jsdom
//
// Keyboard and focus behavior for the redesigned single-dialog account
// deletion flow: focus moves in and is trapped, Escape closes it (when not
// mid-delete), focus is restored to whatever opened it, and there is never
// a second confirmation surface layered on top.
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountDialog } from "../DeleteAccountDialog";

function Harness({ onDelete }: { onDelete: (password: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open delete dialog
      </button>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} onDelete={onDelete} />}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DeleteAccountDialog", () => {
  it("has an accessible name/description, moves focus inside, and is the only confirmation surface", async () => {
    const user = userEvent.setup();
    render(<Harness onDelete={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: /open delete dialog/i }));

    const dialog = screen.getByRole("alertdialog", { name: /delete your account/i });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(1);

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("restores focus to the button that opened it after Escape closes it", async () => {
    const user = userEvent.setup();
    render(<Harness onDelete={vi.fn().mockResolvedValue(undefined)} />);

    const trigger = screen.getByRole("button", { name: /open delete dialog/i });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab focus cycling within the dialog's own controls", async () => {
    const user = userEvent.setup();
    render(<Harness onDelete={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: /open delete dialog/i }));

    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(passwordInput));

    // Enable the Delete button so it's part of the tab cycle.
    await user.type(passwordInput, "correct-password");
    const deleteBtn = screen.getByRole("button", { name: /permanently delete my account/i });

    passwordInput.focus();
    await user.tab({ shift: true }); // wraps from the first focusable to the last
    expect(document.activeElement).toBe(deleteBtn);
  });

  it("requires a password, calls onDelete with it, and shows a failure inline without opening a second dialog", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("Incorrect password"));
    render(<Harness onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: /open delete dialog/i }));

    const deleteBtn = screen.getByRole("button", { name: /permanently delete my account/i }) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);

    await user.type(screen.getByLabelText("Password"), "wrong-password");
    expect(deleteBtn.disabled).toBe(false);
    await user.click(deleteBtn);

    await waitFor(() => expect(screen.getByText("Incorrect password")).toBeTruthy());
    expect(onDelete).toHaveBeenCalledWith("wrong-password");
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(1);
  });

  it("cancels without deleting and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<Harness onDelete={onDelete} />);

    const trigger = screen.getByRole("button", { name: /open delete dialog/i });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });
});
