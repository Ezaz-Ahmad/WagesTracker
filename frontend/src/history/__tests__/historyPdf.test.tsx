// @vitest-environment jsdom
//
// Downloading a PDF for a specific completed week from History.
//
// The two things that can go wrong here are both invisible from the button:
// generating the *wrong* week's data, and generating from state captured
// before an edit. Both produce a perfectly normal-looking download. So these
// tests assert on the data handed to the generator, not on the click.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Shift, User } from "../../lib/types";
import type { WeekReportData } from "../../lib/reportData";
import { AppProvider } from "../../context/AppContext";
import { ConfirmProvider } from "../../components/ConfirmProvider";

const USER: User = {
  id: "u1",
  name: "Ezaz Ahmad",
  email: "ezaz@example.com",
  address: "",
  workLocationName: "Downtown Store",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 10,
  goalHours: 40,
  goalEarnings: 400,
  createdAt: "2025-01-01T00:00:00.000Z",
};

/** Wednesday 2026-02-04. Completed weeks before it: Jan 26–Feb 1,
 * Jan 19–25, Jan 12–18, ... */
const TODAY = new Date(2026, 1, 4, 10, 0, 0);

let serverShifts: Shift[];
/** Every WeekReportData the generator was handed, in order. */
let generated: WeekReportData[];
let generateImpl: (data: WeekReportData) => Promise<void>;

vi.mock("../../pdf/generateReportPdf", () => ({
  generateReportPdf: vi.fn(async (data: WeekReportData) => {
    generated.push(data);
    await generateImpl(data);
  }),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getToken: vi.fn(() => "token"),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    isRemembered: vi.fn(() => true),
    recordActivity: vi.fn(),
    getLastActivity: vi.fn(() => Date.now()),
    clearLastActivity: vi.fn(),
    getRememberedEmail: vi.fn(() => null),
    setRememberedEmail: vi.fn(),
    clearRememberedEmail: vi.fn(),
    fetchMe: vi.fn(async () => ({ user: USER })),
    logout: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    listShifts: vi.fn(async () => ({ shifts: serverShifts })),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
    patchShift: vi.fn(async (id: string, patch: Partial<Shift>) => {
      const found = serverShifts.find((s) => s.id === id)!;
      const updated = { ...found, ...patch };
      serverShifts = serverShifts.map((s) => (s.id === id ? updated : s));
      return { shift: updated };
    }),
    createShift: vi.fn(),
    deleteShift: vi.fn(),
  };
});

const { HistoryScreen } = await import("../../screens/HistoryScreen");

function renderHistory() {
  return render(
    <AppProvider>
      <ConfirmProvider>
        <HistoryScreen />
      </ConfirmProvider>
    </AppProvider>
  );
}

function cardFor(rangeText: RegExp): HTMLElement {
  return screen.getByRole("heading", { name: rangeText }).closest("li")!;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: TODAY.getTime() });
  generated = [];
  generateImpl = async () => {};
  serverShifts = [
    // Jan 26 – Feb 1 week: 4 hours.
    { id: "a", date: "2026-01-26", location: "Downtown Store", signIn: "09:00", signOut: "13:00" },
    // Jan 19 – 25 week: 7 hours.
    { id: "b", date: "2026-01-20", location: "Uptown Branch", signIn: "09:00", signOut: "16:00" },
    // Jan 12 – 18 week: 2 hours.
    { id: "c", date: "2026-01-14", location: "Downtown Store", signIn: "10:00", signOut: "12:00" },
  ];
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the per-week download action", () => {
  it("gives every completed week its own download", async () => {
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });
    const downloads = screen.getAllByRole("button", { name: /^Download PDF for / });
    // One per week card, and each names its own week so twenty of them are
    // distinguishable to a screen reader.
    expect(downloads.length).toBeGreaterThanOrEqual(3);
    expect(new Set(downloads.map((b) => b.getAttribute("aria-label"))).size).toBe(downloads.length);
  });

  it("generates the week that was clicked, not the most recent one", async () => {
    // The failure this guards against looks completely normal from outside:
    // a PDF downloads, it just contains the wrong week.
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });

    await user.click(within(cardFor(/Jan 12/)).getByRole("button", { name: /^Download PDF for / }));
    await waitFor(() => expect(generated).toHaveLength(1));

    expect(generated[0].weekStartISO).toBe("2026-01-12");
    expect(generated[0].weekEndISO).toBe("2026-01-18");
    expect(generated[0].totalHours).toBe(2);
  });

  it("uses each week's own date range across several downloads", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });

    await user.click(within(cardFor(/Jan 26/)).getByRole("button", { name: /^Download PDF for / }));
    await waitFor(() => expect(generated).toHaveLength(1));
    await user.click(within(cardFor(/Jan 19/)).getByRole("button", { name: /^Download PDF for / }));
    await waitFor(() => expect(generated).toHaveLength(2));

    expect(generated.map((d) => d.weekStartISO)).toEqual(["2026-01-26", "2026-01-19"]);
    expect(generated.map((d) => d.totalHours)).toEqual([4, 7]);
  });

  it("stamps the generated date as today even for an old week", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });
    await user.click(within(cardFor(/Jan 12/)).getByRole("button", { name: /^Download PDF for / }));
    await waitFor(() => expect(generated).toHaveLength(1));
    expect(generated[0].generatedOnLabel).toBe("Feb 4, 2026");
  });

  it("carries the authenticated display name, whichever week is downloaded", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });
    await user.click(within(cardFor(/Jan 19/)).getByRole("button", { name: /^Download PDF for / }));
    await waitFor(() => expect(generated).toHaveLength(1));
    expect(generated[0].employeeName).toBe("Ezaz Ahmad");
  });
});

describe("downloading after an edit", () => {
  it("includes the correction, not the figures from when the page loaded", async () => {
    // The other invisible failure: building the report from state captured
    // at render time rather than at click time.
    const user = userEvent.setup();
    renderHistory();
    // The first shifts fetch has to resolve before any week card exists.
    await screen.findByRole("heading", { name: /Jan 26/ });
    const card = cardFor(/Jan 26/);

    await user.click(within(card).getByRole("button", { name: /View days/ }));
    await user.click(within(card).getByRole("button", { name: /Edit hours for Mon/ }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00"); // 4h -> 6h
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await within(dialog).findByText("Saved");
    await user.click(within(dialog).getByRole("button", { name: /Close without saving/ }));

    await user.click(within(card).getByRole("button", { name: /^Download PDF for / }));
    await waitFor(() => expect(generated).toHaveLength(1));

    expect(generated[0].totalHours).toBe(6);
    expect(generated[0].totalEarnings).toBe(60);
  });
});

describe("download states", () => {
  it("shows an in-progress state and blocks a duplicate request", async () => {
    let release: () => void = () => {};
    let calls = 0;
    generateImpl = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });
    const button = within(cardFor(/Jan 26/)).getByRole("button", { name: /^Download PDF for / });

    await user.click(button);
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await user.click(button);
    await user.click(button);
    expect(calls).toBe(1);

    release();
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
  });

  it("keeps one week's busy state off every other week's button", async () => {
    // A single shared hook for the screen would mark all twenty rows busy.
    generateImpl = () => new Promise<void>(() => {});
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });

    await user.click(within(cardFor(/Jan 26/)).getByRole("button", { name: /^Download PDF for / }));
    const other = within(cardFor(/Jan 19/)).getByRole("button", { name: /^Download PDF for / });
    await waitFor(() =>
      expect(within(cardFor(/Jan 26/)).getByRole("button", { name: /^Download PDF for / }).getAttribute("aria-busy")).toBe("true")
    );
    expect(other.getAttribute("aria-busy")).toBeNull();
    expect((other as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports a failure without exposing internal detail, and retries", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let attempt = 0;
    generateImpl = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Cannot read properties of undefined (reading 'internals')");
    };

    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });
    const card = cardFor(/Jan 26/);
    await user.click(within(card).getByRole("button", { name: /^Download PDF for / }));

    const alert = await within(card).findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn't generate the PDF/);
    // The internal message is not on screen — it tells the user nothing they
    // can act on, and would end up in any screenshot they shared.
    expect(alert.textContent).not.toMatch(/undefined/);
    expect(alert.textContent).not.toMatch(/internals/);
    // ...but it is still available for diagnosis.
    expect(consoleSpy).toHaveBeenCalled();

    // The retry offered in the banner works.
    await user.click(within(alert).getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(within(card).queryByRole("alert")).toBeNull());
    expect(generated).toHaveLength(2);
    consoleSpy.mockRestore();
  });

  it("keeps a failure on the week that failed", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generateImpl = async () => {
      throw new Error("boom");
    };
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });

    await user.click(within(cardFor(/Jan 26/)).getByRole("button", { name: /^Download PDF for / }));
    await within(cardFor(/Jan 26/)).findByRole("alert");
    expect(within(cardFor(/Jan 19/)).queryByRole("alert")).toBeNull();
    consoleSpy.mockRestore();
  });
});
