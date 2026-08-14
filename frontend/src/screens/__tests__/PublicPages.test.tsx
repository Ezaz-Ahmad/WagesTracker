// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";
import { PrivacyPolicyPage } from "../PrivacyPolicyPage";
import { SupportPage } from "../SupportPage";

expect.extend(toHaveNoViolations);
afterEach(cleanup);

describe("public App Store pages", () => {
  it("publishes the privacy policy without requiring authentication", async () => {
    const { container } = render(<PrivacyPolicyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
    expect(screen.getByText(/Last updated: 14 August 2026/)).toBeTruthy();
    expect(screen.getByText(/Settings → Data & account → Delete account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Support page" }).getAttribute("href")).toBe("/support");
    expect(await axe(container, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });

  it("publishes support and safe-reporting guidance", async () => {
    const { container } = render(<SupportPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Wage Tracker Support" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Submit a support request" }).getAttribute("href"))
      .toBe("https://github.com/Ezaz-Ahmad/WagesTracker/issues/new");
    expect(screen.getByText(/Never include your password/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/privacy");
    expect(await axe(container, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });
});
