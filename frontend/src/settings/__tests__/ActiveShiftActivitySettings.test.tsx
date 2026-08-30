// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import {
  configureActiveShiftActivity,
  resetActiveShiftActivityForTests,
} from "../../platform/activeShiftActivity";
import { ActiveShiftActivitySettings } from "../ActiveShiftActivitySettings";

type AppCtx = ReturnType<typeof useApp>;
let savePreference: (next: boolean) => void = () => {};

function useFakeApp(): AppCtx {
  const [enabled, setEnabled] = useState(false);
  return {
    activeShiftActivityEnabled: enabled,
    setActiveShiftActivityEnabled: async (next: boolean) => {
      savePreference(next);
      setEnabled(next);
    },
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

beforeEach(() => {
  savePreference = vi.fn();
});

afterEach(() => {
  cleanup();
  resetActiveShiftActivityForTests();
});

describe("ActiveShiftActivitySettings", () => {
  it("does not show a non-functional setting in a web/PWA session", () => {
    render(<ActiveShiftActivitySettings />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("is off by default and enables only after the user turns it on", async () => {
    configureActiveShiftActivity({
      startOrUpdate: async () => ({ status: "active", pendingClockOut: false, completionNotifications: "authorized" }),
      dismiss: async () => {},
      end: async () => {},
      retryPendingClockOut: async () => ({ queued: false }),
      subscribeEnded: async () => () => {},
    });
    const user = userEvent.setup();
    render(<ActiveShiftActivitySettings />);

    const toggle = screen.getByRole("switch", { name: "Active shift notification" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Off")).toBeTruthy();

    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(savePreference).toHaveBeenCalledWith(true);
    expect(screen.getByText("On")).toBeTruthy();
  });
});
