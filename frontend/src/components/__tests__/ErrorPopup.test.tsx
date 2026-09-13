// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorPopup } from "../ErrorPopup";
import { showErrorPopup } from "../../lib/errorFeedback";

afterEach(cleanup);

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
});
