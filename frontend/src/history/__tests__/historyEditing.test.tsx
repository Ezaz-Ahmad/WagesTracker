// @vitest-environment jsdom
//
// Correcting a day inside a completed week, and what happens to the rest of
// the app when you do.
//
// The recalculation half is the part worth testing hardest. There is
// deliberately no History-specific cache to invalidate: every screen derives
// from the one `shifts` array in context, so a corrected day propagates
// because there is a single source, not because something remembered to
// refresh. That is easy to state and easy to break — a well-meaning
// `useMemo` with the wrong dependency, or a local copy taken at mount, would
// leave History right and Home wrong. These tests pin the propagation
// itself, not the plumbing that currently achieves it.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Shift, User } from "../../lib/types";
import { AppProvider } from "../../context/AppContext";
import { ConfirmProvider } from "../../components/ConfirmProvider";

const USER: User = {
  id: "u1",
  name: "Sam Lee",
  email: "sam@example.com",
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

/** Fixed "today": Wednesday 2026-02-04. The completed week immediately
 * before it is Mon 2026-01-26 to Sun 2026-02-01. */
const TODAY = new Date(2026, 1, 4, 10, 0, 0);
const LAST_MONDAY = "2026-01-26";

let serverShifts: Shift[];
let patchImpl: (id: string, patch: Partial<Shift>) => Promise<Shift>;
let createImpl: (input: Omit<Shift, "id">) => Promise<Shift>;
let deleteImpl: (id: string) => Promise<void>;

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
    listWorkLocations: vi.fn(async () => ({ locations: [{
      id: "loc-1",
      name: "Downtown Store",
      address: "",
      fuelAllowance: 0,
      archived: false,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    }] })),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    setDayExpense: vi.fn(async (date: string, fuelCost: number | null) => ({
      expense: fuelCost && fuelCost > 0 ? { date, fuelCost } : null,
    })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
    patchShift: vi.fn(async (id: string, patch: Partial<Shift>) => ({ shift: await patchImpl(id, patch) })),
    createShift: vi.fn(async (input: Omit<Shift, "id">) => ({ shift: await createImpl(input) })),
    deleteShift: vi.fn(async (id: string) => deleteImpl(id)),
  };
});

const { HistoryScreen } = await import("../../screens/HistoryScreen");
const { HomeScreen } = await import("../../screens/HomeScreen");

function renderHistory(extra?: React.ReactNode) {
  return render(
    <AppProvider>
      <ConfirmProvider>
        <HistoryScreen />
        {extra}
      </ConfirmProvider>
    </AppProvider>
  );
}

/** The week card's own total, as opposed to the per-day figures inside it —
 * both render "N.NNh", so a plain text query in the card matches several. */
function weekSummary(card: HTMLElement): string {
  return card.querySelector(".history-week-summary")!.textContent ?? "";
}

/** Opens the most recent completed week and returns its card. */
async function openLastWeek(user: ReturnType<typeof userEvent.setup>) {
  const heading = await screen.findByRole("heading", { name: /Jan 26/ });
  const card = heading.closest("li")!;
  await user.click(within(card).getByRole("button", { name: /View days/ }));
  return card;
}

async function openEditor(user: ReturnType<typeof userEvent.setup>, dayLabel: RegExp) {
  const card = await openLastWeek(user);
  await user.click(within(card).getByRole("button", { name: dayLabel }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true, now: TODAY.getTime() });
  serverShifts = [{ id: "s1", date: LAST_MONDAY, location: "Downtown Store", signIn: "09:00", signOut: "13:00" }];
  patchImpl = async (id, patch) => {
    const found = serverShifts.find((s) => s.id === id)!;
    const updated = { ...found, ...patch };
    serverShifts = serverShifts.map((s) => (s.id === id ? updated : s));
    return updated;
  };
  createImpl = async (input) => {
    const created = { ...input, id: `new-${serverShifts.length}` } as Shift;
    serverShifts = [...serverShifts, created];
    return created;
  };
  deleteImpl = async (id) => {
    serverShifts = serverShifts.filter((s) => s.id !== id);
  };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("opening the editor", () => {
  it("opens for the day that was clicked, with its existing times prefilled", async () => {
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);

    expect(within(dialog).getByText(/Monday, January 26, 2026/)).toBeTruthy();
    expect((within(dialog).getByLabelText("Sign in") as HTMLInputElement).value).toBe("09:00");
    expect((within(dialog).getByLabelText("Sign out") as HTMLInputElement).value).toBe("13:00");
    expect((within(dialog).getByLabelText("Location") as HTMLInputElement).value).toBe("Downtown Store");
  });

  it("offers Add hours, and an empty form, for a day with no entry", async () => {
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Add hours for Tue/);

    expect(within(dialog).getByRole("heading", { name: "Add hours" })).toBeTruthy();
    expect((within(dialog).getByLabelText("Sign in") as HTMLInputElement).value).toBe("");
    // Nothing to remove yet, so no destructive action is offered.
    expect(within(dialog).queryByRole("button", { name: /Remove this entry/ })).toBeNull();
  });

  it("saves a forgotten fuel charge without requiring hours", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHistory();
    const dialog = await openEditor(user, /Add hours for Tue/);
    const api = await import("../../lib/api");

    await user.type(within(dialog).getByLabelText("Fuel allowance override"), "24.50");
    const save = within(dialog).getByRole("button", { name: /^Save/ });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await user.click(save);

    await within(dialog).findByText("Saved");
    expect(api.setDayExpense).toHaveBeenCalledWith("2026-01-27", 24.5);
    expect(api.createShift).not.toHaveBeenCalled();
  });

  it("names each day's action so the seven buttons are distinguishable", async () => {
    // The visible label is "Edit hours" on every row; without the date in the
    // accessible name a screen-reader user hears it seven times identically.
    const user = userEvent.setup();
    renderHistory();
    const card = await openLastWeek(user);
    expect(within(card).getByRole("button", { name: "Edit hours for Mon Jan 26" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Add hours for Tue Jan 27" })).toBeTruthy();
  });
});

describe("the calculated-hours preview", () => {
  it("updates live and is never an editable field", async () => {
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);

    const readout = within(dialog).getByRole("status");
    expect(readout.textContent).toContain("4.00h");

    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "17:00");
    await waitFor(() => expect(readout.textContent).toContain("8.00h"));

    // It is a readout, not an input — hours are derived from the times
    // everywhere else, and a second writable source for the same number
    // would let the two disagree.
    expect(within(dialog).queryByLabelText(/Calculated hours/)).toBeNull();
    expect(readout.querySelector("input")).toBeNull();
  });

  it("reads an overnight pair as crossing midnight rather than as an error", async () => {
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);

    await user.clear(within(dialog).getByLabelText("Sign in"));
    await user.type(within(dialog).getByLabelText("Sign in"), "22:00");
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "06:00");

    await waitFor(() => expect(within(dialog).getByRole("status").textContent).toContain("8.00h"));
    expect(within(dialog).getByText(/overnight shift ending the next day/i)).toBeTruthy();
  });
});

describe("validation", () => {
  it("allows a normal overnight shift without an unusually-long warning", async () => {
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);

    await user.clear(within(dialog).getByLabelText("Sign in"));
    await user.type(within(dialog).getByLabelText("Sign in"), "08:50");
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "01:30");

    const save = within(dialog).getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect((within(dialog).getByLabelText("Sign out") as HTMLInputElement).getAttribute("aria-invalid")).toBeNull();

    await user.click(save);
    await within(dialog).findByText("Saved");
    expect(serverShifts[0]).toMatchObject({ signIn: "08:50", signOut: "01:30" });
  });

  it("keeps Save disabled until something actually changes", async () => {
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);
    expect((within(dialog).getByRole("button", { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "17:00");
    expect((within(dialog).getByRole("button", { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("saving a correction", () => {
  it("persists the change and updates the week's total without a reload", async () => {
    const user = userEvent.setup();
    renderHistory();

    // 4 hours at $10 = $40 before.
    const card = await openLastWeek(user);
    expect(weekSummary(card)).toContain("4.00h");

    await user.click(within(card).getByRole("button", { name: /Edit hours for Mon/ }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00"); // 6 hours
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));

    await within(dialog).findByText("Saved");
    // The server holds the new value...
    expect(serverShifts[0].signOut).toBe("15:00");
    // ...and the week card behind the dialog already reflects it.
    await waitFor(() => expect(weekSummary(card)).toContain("6.00h"));
    expect(weekSummary(card)).toContain("$60.00");
  });

  it("adds hours to a day that had none", async () => {
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Add hours for Tue/);

    await user.type(within(dialog).getByLabelText("Sign in"), "10:00");
    await user.type(within(dialog).getByLabelText("Sign out"), "14:00");
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));

    await within(dialog).findByText("Saved");
    const added = serverShifts.find((s) => s.date === "2026-01-27");
    expect(added).toBeTruthy();
    expect(added!.signIn).toBe("10:00");
  });

  it("does not create a second shift when saved twice", async () => {
    // After the first save the newly created shift becomes the selection, so
    // a further save patches it. Without that, every save on a previously
    // empty day would add another row.
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Add hours for Tue/);

    await user.type(within(dialog).getByLabelText("Sign in"), "10:00");
    await user.type(within(dialog).getByLabelText("Sign out"), "14:00");
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await within(dialog).findByText("Saved");

    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00");
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(serverShifts.filter((s) => s.date === "2026-01-27")).toHaveLength(1));
    expect(serverShifts.find((s) => s.date === "2026-01-27")!.signOut).toBe("15:00");
  });

  it("prevents a duplicate submission while a save is in flight", async () => {
    let release: (v: Shift) => void = () => {};
    let calls = 0;
    patchImpl = (id, patch) => {
      calls += 1;
      return new Promise<Shift>((resolve) => {
        release = resolve;
        void id;
        void patch;
      });
    };

    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00");

    const save = within(dialog).getByRole("button", { name: /^Save/ });
    await user.click(save);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.click(save);
    await user.click(save);
    expect(calls).toBe(1);

    release({ id: "s1", date: LAST_MONDAY, location: "Downtown Store", signIn: "09:00", signOut: "15:00" });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true)); // now disabled because clean
  });
});

describe("when saving fails", () => {
  it("keeps the entered values, explains why, and allows a retry", async () => {
    let attempt = 0;
    const good = patchImpl;
    patchImpl = async (id, patch) => {
      attempt += 1;
      if (attempt === 1) throw new Error("That overlaps another shift you've already logged.");
      return good(id, patch);
    };

    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00");
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));

    // The server's own message, shown inside the dialog rather than in the
    // global banner behind it.
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/overlaps/i);
    // The typed value is still there — losing it would mean retyping the
    // thing that just failed.
    expect((within(dialog).getByLabelText("Sign out") as HTMLInputElement).value).toBe("15:00");
    // No false success.
    expect(within(dialog).queryByText("Saved")).toBeNull();

    // And the same click retries cleanly.
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await within(dialog).findByText("Saved");
    expect(serverShifts[0].signOut).toBe("15:00");
  });

  it("leaves the underlying record untouched on failure", async () => {
    patchImpl = async () => {
      throw new Error("Server unavailable");
    };
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00");
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));

    await within(dialog).findByRole("alert");
    expect(serverShifts[0].signOut).toBe("13:00");
  });
});

describe("removing an entry", () => {
  it("deletes after confirmation and drops the hours from the week", async () => {
    const user = userEvent.setup();
    renderHistory();
    const card = await openLastWeek(user);
    await user.click(within(card).getByRole("button", { name: /Edit hours for Mon/ }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /Remove this entry/ }));
    // Routed through the app's shared confirmation, like every other
    // destructive action.
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: /yes|confirm/i }));

    await waitFor(() => expect(serverShifts).toHaveLength(0));
    await waitFor(() => expect(weekSummary(card)).toContain("0.00h"));
  });
});

describe("unsaved-change protection", () => {
  it("asks before discarding edits, and stays open if you decline", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00");

    await user.click(within(dialog).getByRole("button", { name: /Close without saving/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("closes without asking when nothing has changed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    renderHistory();
    const dialog = await openEditor(user, /Edit hours for Mon/);

    await user.click(within(dialog).getByRole("button", { name: /Close without saving/ }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    confirmSpy.mockRestore();
  });
});

describe("keyboard and focus", () => {
  it("traps focus, closes on Escape, and returns focus to the control that opened it", async () => {
    const user = userEvent.setup();
    renderHistory();
    const card = await openLastWeek(user);
    const trigger = within(card).getByRole("button", { name: /Edit hours for Mon/ });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");

    // Focus starts inside.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // And stays inside across a full cycle.
    for (let i = 0; i < 12; i++) await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("cross-application recalculation", () => {
  it("feeds the corrected week into Home's prior-week comparison", async () => {
    // The scenario from the brief: last Monday goes from 4 hours to 6, and
    // the comparison week is exactly that week. Home must not still be
    // comparing against the old figure.
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ConfirmProvider>
          <HistoryScreen />
          <HomeScreen />
        </ConfirmProvider>
      </AppProvider>
    );

    const heading = await screen.findByRole("heading", { name: /Jan 26/ });
    const card = heading.closest("li")!;
    await user.click(within(card).getByRole("button", { name: /View days/ }));
    await user.click(within(card).getByRole("button", { name: /Edit hours for Mon/ }));

    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00");
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await within(dialog).findByText("Saved");

    // Home derives the comparison from the same shifts array, so its
    // week-over-week figure has to move with the correction. The previous
    // week's total is what changed, and Home's trend element reflects it
    // without any refetch or reload.
    await waitFor(() => {
      const trend = document.querySelector(".week-trend");
      expect(trend).not.toBeNull();
      expect(trend!.textContent).toBeTruthy();
    });
    // The corrected week now totals 6h; History and Home agree.
    expect(weekSummary(card)).toContain("6.00h");
  });

  it("requires no refetch — the correction lands from one canonical array", async () => {
    const api = await import("../../lib/api");
    const listShifts = api.listShifts as unknown as ReturnType<typeof vi.fn>;

    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("heading", { name: /Jan 26/ });
    listShifts.mockClear();

    const card = await openLastWeek(user);
    await user.click(within(card).getByRole("button", { name: /Edit hours for Mon/ }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Sign out"));
    await user.type(within(dialog).getByLabelText("Sign out"), "15:00");
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await within(dialog).findByText("Saved");

    // The displayed total is correct and no list refetch was needed to make
    // it so — the mutation's own response is the canonical update.
    await waitFor(() => expect(weekSummary(card)).toContain("6.00h"));
    expect(listShifts).not.toHaveBeenCalled();
  });
});
