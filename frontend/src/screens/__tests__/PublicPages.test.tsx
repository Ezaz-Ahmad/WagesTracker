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
    expect(screen.getByText(/Last updated: 28 August 2026/)).toBeTruthy();
    expect(screen.getByText(/Optional personal spending records:/)).toBeTruthy();
    expect(screen.getByText(/Personal spending is not included in those employer-facing wage PDFs/)).toBeTruthy();
    expect(screen.getByText("Resend").parentElement?.textContent).toContain("transactional message content");
    expect(screen.getByText(/Settings → Data & account → Delete account/)).toBeTruthy();
    expect(screen.getByText(/Vercel/)).toBeTruthy();
    expect(screen.getByText(/Render/)).toBeTruthy();
    expect(screen.getByText(/Turso/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/encrypted backups/i);
    expect(screen.getByRole("link", { name: "Support page" }).getAttribute("href")).toBe("/support");
    expect(await axe(container, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });

  it("publishes support and safe-reporting guidance", async () => {
    const { container } = render(<SupportPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Wage Tracker Support" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ezazahmadshanto@gmail.com" }).getAttribute("href"))
      .toBe("mailto:ezazahmadshanto@gmail.com");
    expect(screen.getByRole("link", { name: "Report a non-sensitive bug" }).getAttribute("href"))
      .toBe("https://github.com/Ezaz-Ahmad/WagesTracker/issues/new");
    expect(screen.getByText(/GitHub issues are public/)).toBeTruthy();
    expect(screen.getByText(/Never include personal information/)).toBeTruthy();
    expect(screen.getByText(/Forgot password\?/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/privacy");
    expect(await axe(container, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });
});
