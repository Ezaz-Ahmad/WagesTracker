// @vitest-environment jsdom
//
// The attribution footer on the authentication card.
//
// It used to sit between the login/signup toggle and the form — above the
// fields, above the error banner. These tests pin the two things that were
// actually wrong with that (its position relative to the form, and its
// visual weight relative to the primary action) plus the version's source,
// which must be the build's own number rather than a second one maintained
// by hand in the component.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const FAKE_VERSION = "9.9.9";
vi.mock("../../lib/appVersion", () => ({
  APP_VERSION: FAKE_VERSION,
  VERSION_LABEL: `v${FAKE_VERSION} (abc1234) · Jan 1, 2030`,
  VERSION_SHORT: `v${FAKE_VERSION} (abc1234)`,
}));

const { AuthFooter } = await import("../AuthFooter");

afterEach(cleanup);

describe("AuthFooter", () => {
  it("keeps the name and both links", () => {
    render(<AuthFooter />);
    expect(screen.getByText("Built by Ezaz Ahmad")).toBeTruthy();
    expect(screen.getByRole("link", { name: /GitHub profile/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /portfolio/i })).toBeTruthy();
  });

  it("shows the build's own version, not a number typed into the component", () => {
    // The mock stands in for lib/appVersion, which vite populates from
    // package.json at build time. If someone hardcodes a version here, this
    // fails rather than silently shipping a stale number on the login screen.
    render(<AuthFooter />);
    expect(screen.getByText(`Version ${FAKE_VERSION}`)).toBeTruthy();
  });

  it("names external links fully and says they leave the app", () => {
    // The visible text is a single word ("GitHub"), which tells a screen
    // reader user nothing about whose profile it is or that it opens a tab.
    render(<AuthFooter />);
    for (const link of [
      screen.getByRole("link", { name: /GitHub profile/ }),
      screen.getByRole("link", { name: /portfolio/i }),
    ]) {
      expect(link.getAttribute("aria-label")).toMatch(/opens in a new tab/);
      expect(link.getAttribute("target")).toBe("_blank");
      // noreferrer as well as noopener — without it the destination receives
      // this app's URL in the Referer header.
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it("is a footer landmark, in normal flow", () => {
    const { container } = render(<AuthFooter />);
    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
    // Never positioned: absolute placement would overlap the form on a short
    // screen, and with a mobile keyboard open there is very little left.
    expect(footer!.style.position).toBe("");
  });
});

describe("placement on the auth screen", () => {
  // Rendering the real screen, because "at the bottom of the card" is a
  // relationship between elements — a test of the footer alone cannot see it.
  it("comes after the form and the primary action, not before them", async () => {
    vi.doMock("../../context/AppContext", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../context/AppContext")>();
      return {
        ...actual,
        useApp: () => ({ login: vi.fn(), signup: vi.fn(), authError: null, authBusy: false, clearAuthError: vi.fn() }),
      };
    });
    const { AuthScreen } = await import("../../screens/AuthScreen");
    const { container } = render(<AuthScreen />);

    const footer = container.querySelector(".auth-footer")!;
    const form = container.querySelector("form")!;
    const submit = within(form).getByRole("button", { name: "Log in" });

    // DOCUMENT_POSITION_FOLLOWING: the footer comes later in the document.
    expect(form.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not sit between the mode toggle and the form any more", async () => {
    const { AuthScreen } = await import("../../screens/AuthScreen");
    const { container } = render(<AuthScreen />);
    const toggle = container.querySelector(".landing-mode-toggle")!;
    const form = container.querySelector("form")!;
    const footer = container.querySelector(".auth-footer")!;

    const between =
      toggle.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING &&
      footer.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(between).toBeFalsy();
  });

  it("appears once, shared by both login and signup", async () => {
    const { AuthScreen } = await import("../../screens/AuthScreen");
    const { container } = render(<AuthScreen />);
    expect(container.querySelectorAll(".auth-footer")).toHaveLength(1);
  });
});
