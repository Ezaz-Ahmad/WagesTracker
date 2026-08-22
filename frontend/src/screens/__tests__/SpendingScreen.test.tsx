// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../components/ConfirmProvider";
import type { PersonalExpense, SpendingCategory, SpendingSummary } from "../../lib/types";
import { resetSpendingDataCacheForTests } from "../../lib/spendingDataCache";
import { SpendingScreen } from "../SpendingScreen";

expect.extend(toHaveNoViolations);
afterEach(cleanup);

const mocks = vi.hoisted(() => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  patchCategory: vi.fn(),
  archiveCategory: vi.fn(),
  listExpenses: vi.fn(),
  createExpense: vi.fn(),
  patchExpense: vi.fn(),
  deleteExpense: vi.fn(),
  getSummary: vi.fn(),
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    listSpendingCategories: mocks.listCategories,
    createSpendingCategory: mocks.createCategory,
    patchSpendingCategory: mocks.patchCategory,
    archiveSpendingCategory: mocks.archiveCategory,
    listPersonalExpenses: mocks.listExpenses,
    createPersonalExpense: mocks.createExpense,
    patchPersonalExpense: mocks.patchExpense,
    deletePersonalExpense: mocks.deleteExpense,
    getSpendingSummary: mocks.getSummary,
  };
});

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return {
    ...actual,
    useApp: () => ({
      today: new Date(2026, 7, 20, 12, 0),
      user: {
        id: "user-a", name: "Alex", email: "alex@example.com", address: "", workLocationName: "",
        workAddress: "", multipleLocations: false, otherLocations: "", weekStartsOn: "Monday",
        rate: 20, goalHours: 35, goalEarnings: 700, createdAt: "2026-01-01T00:00:00Z",
      },
    }),
  };
});

const categories: SpendingCategory[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Groceries", icon: "groceries", colour: "#047857", isDefault: true, archived: false, archivedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Old category", icon: "other", colour: "#475569", isDefault: false, archived: true, archivedAt: "2026-08-01", createdAt: "2026-01-01", updatedAt: "2026-08-01" },
];

const expense: PersonalExpense = {
  id: "expense-1", amountCents: 2550, categoryId: categories[0].id, spentAt: "2026-08-19T18:30",
  spentDate: "2026-08-19", timeZone: "Australia/Sydney", merchant: "Fresh Market", note: "Weekly shop",
  paymentMethod: "card", createdAt: "2026-08-19", updatedAt: "2026-08-19",
  category: { id: categories[0].id, name: "Groceries", icon: "groceries", colour: "#047857", archived: false },
};

const summary: SpendingSummary = {
  period: { from: "2026-08-01", to: "2026-08-31", previousFrom: "2026-07-01", previousTo: "2026-07-31", days: 31 },
  earningsCents: 100_000,
  earningsRecorded: true,
  totalSpendingCents: 25_500,
  differenceCents: 74_500,
  spendingPercentage: 25.5,
  averageDailyCents: 3643,
  transactionCount: 3,
  largestCategory: { id: categories[0].id, name: "Groceries", icon: "groceries", colour: "#047857", totalCents: 20_000, transactionCount: 2 },
  previous: { earningsCents: 90_000, totalSpendingCents: 30_000, spendingChangePercent: -15 },
  categories: [{ id: categories[0].id, name: "Groceries", icon: "groceries", colour: "#047857", totalCents: 20_000, transactionCount: 2 }],
  trend: [{ date: "2026-08-19", totalCents: 25_500 }],
  recentExpenses: [expense],
};

function renderScreen() {
  return render(<ConfirmProvider><SpendingScreen /></ConfirmProvider>);
}

beforeEach(() => {
  resetSpendingDataCacheForTests();
  vi.resetAllMocks();
  mocks.listCategories.mockResolvedValue({ categories });
  mocks.listExpenses.mockResolvedValue({ expenses: [expense], page: 1, pageSize: 20, total: 1, hasMore: false });
  mocks.getSummary.mockResolvedValue(summary);
  mocks.createExpense.mockResolvedValue({ expense });
  mocks.patchExpense.mockResolvedValue({ expense });
  mocks.deleteExpense.mockResolvedValue(undefined);
  mocks.createCategory.mockResolvedValue({ category: categories[0] });
  mocks.patchCategory.mockResolvedValue({ category: categories[0] });
  mocks.archiveCategory.mockResolvedValue(undefined);
});

describe("SpendingScreen", () => {
  it("uses a dashboard-shaped skeleton for the first load instead of a blank text loader", async () => {
    let resolveSummary!: (value: SpendingSummary) => void;
    mocks.getSummary.mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));
    const { container } = renderScreen();
    expect(screen.getByLabelText("Loading spending dashboard")).toBeTruthy();
    expect(container.querySelectorAll(".spending-summary-skeleton")).toHaveLength(4);
    expect(screen.queryByText("Loading spending dashboard…")).toBeNull();
    resolveSummary(summary);
    expect((await screen.findAllByText("$1000.00")).length).toBeGreaterThan(0);
  });

  it("renders a cached dashboard synchronously after navigation remount without refetching", async () => {
    const first = renderScreen();
    expect((await screen.findAllByText("$1000.00")).length).toBeGreaterThan(0);
    expect(mocks.getSummary).toHaveBeenCalledTimes(1);
    first.unmount();

    renderScreen();
    expect(screen.getAllByText("$1000.00").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Loading spending dashboard")).toBeNull();
    expect(mocks.getSummary).toHaveBeenCalledTimes(1);
  });

  it("shows canonical earnings, spending, difference, percentage, insights, charts, and recent expenses", async () => {
    renderScreen();
    expect((await screen.findAllByText("$1000.00")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$255.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$745.00").length).toBeGreaterThan(0);
    expect(screen.getByText("25.5%")).toBeTruthy();
    expect(screen.getByText(/Groceries is your largest spending category this month/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where your money went" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Spending over time" })).toBeTruthy();
    expect(screen.getByText("Fresh Market")).toBeTruthy();
  });

  it("opens on the whole current month, preserves a session choice, and supports a custom range", async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalledWith("2026-08-01", "2026-08-31"));
    expect((screen.getByLabelText("This month") as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByLabelText("This week"));
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalledWith("2026-08-17", "2026-08-23"));
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect((screen.getByLabelText("This week") as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByLabelText("Today"));
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalledWith("2026-08-20", "2026-08-20"));
    await user.click(screen.getByLabelText("Custom range"));
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    await user.clear(from); await user.type(from, "2026-08-03");
    await user.clear(to); await user.type(to, "2026-08-09");
    await waitFor(() => expect(mocks.getSummary).toHaveBeenCalledWith("2026-08-03", "2026-08-09"));
  });

  it("starts each internal spending view at the top of the app scroller", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div className="app-main">
        <ConfirmProvider><SpendingScreen /></ConfirmProvider>
      </div>
    );
    await screen.findByText("Fresh Market");
    const scroller = container.querySelector(".app-main") as HTMLElement;
    scroller.scrollTop = 480;

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(scroller.scrollTop).toBe(0);
  });

  it("validates quick-entry amounts and excludes archived categories from new expenses", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add expense" });
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector(".spending-dialog-body")).toBeTruthy();
    expect(dialog.querySelector(".spending-dialog-actions")).toBeTruthy();
    expect(within(dialog).getByLabelText("Groceries")).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Old category/)).toBeNull();
    await user.type(screen.getByLabelText("Amount"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText("Amount must be greater than zero.")).toBeTruthy();
    expect(mocks.createExpense).not.toHaveBeenCalled();
  });

  it("preserves entered values and the idempotency key across a network retry", async () => {
    const user = userEvent.setup();
    mocks.createExpense.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ expense });
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await user.type(screen.getByLabelText("Amount"), "12.50");
    await user.type(screen.getByLabelText(/Merchant or short title/), "Bakery");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add expense" }));
    expect(await screen.findByText(/Couldn't save the expense/)).toBeTruthy();
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("12.50");
    expect((screen.getByLabelText(/Merchant or short title/) as HTMLInputElement).value).toBe("Bakery");
    await user.click(within(dialog).getByRole("button", { name: "Add expense" }));
    await waitFor(() => expect(mocks.createExpense).toHaveBeenCalledTimes(2));
    expect(mocks.createExpense.mock.calls[0][0].clientRequestId).toBe(mocks.createExpense.mock.calls[1][0].clientRequestId);
  });

  it("prevents duplicate submissions while a save is in flight", async () => {
    const user = userEvent.setup();
    let resolve!: (value: { expense: PersonalExpense }) => void;
    mocks.createExpense.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await user.type(screen.getByLabelText("Amount"), "8.00");
    const submit = within(screen.getByRole("dialog")).getByRole("button", { name: "Add expense" });
    await user.click(submit);
    expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Saving…" }));
    expect(mocks.createExpense).toHaveBeenCalledTimes(1);
    resolve({ expense });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edits and confirms deletion while refreshing visible aggregates without a hidden History request", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("Fresh Market");
    await user.click(screen.getByRole("button", { name: "Edit Fresh Market expense" }));
    const amount = screen.getByLabelText("Amount");
    expect((amount as HTMLInputElement).value).toBe("25.50");
    await user.clear(amount); await user.type(amount, "30.00");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.patchExpense).toHaveBeenCalledWith("expense-1", expect.objectContaining({ amountCents: 3000 })));
    await user.click(screen.getByRole("button", { name: "Delete Fresh Market expense" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Yes, continue" }));
    await waitFor(() => expect(mocks.deleteExpense).toHaveBeenCalledWith("expense-1"));
    expect(mocks.getSummary.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.listExpenses).not.toHaveBeenCalled();
  });

  it("filters complete history by category and merchant search", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.selectOptions(screen.getByLabelText("Category"), categories[0].id);
    await user.type(screen.getByLabelText("Search merchant or title"), "fresh");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(mocks.listExpenses).toHaveBeenCalledWith(expect.objectContaining({ categoryId: categories[0].id, search: "fresh" })));
  });

  it("creates, edits, archives, and restores categories", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("tab", { name: "Categories" }));
    await user.type(screen.getByLabelText("Name"), "Pet care");
    await user.click(screen.getByRole("button", { name: "Create category" }));
    await waitFor(() => expect(mocks.createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: "Pet care" })));
    await user.click(screen.getByRole("button", { name: "Edit Groceries" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Groceries");
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.archiveCategory).toHaveBeenCalledWith(categories[0].id));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(mocks.patchCategory).toHaveBeenCalledWith(categories[1].id, { archived: false }));
  });

  it("shows an actionable error and retries without losing the selected period", async () => {
    const user = userEvent.setup();
    mocks.getSummary.mockRejectedValueOnce(new Error("Summary unavailable")).mockResolvedValueOnce(summary);
    renderScreen();
    expect(await screen.findByText(/Summary unavailable/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect((await screen.findAllByText("$1000.00")).length).toBeGreaterThan(0);
    expect((screen.getByLabelText("This month") as HTMLInputElement).checked).toBe(true);
  });

  it("has no detectable accessibility violations in the loaded dashboard", async () => {
    const { container } = renderScreen();
    await screen.findByText("Fresh Market");
    expect(await axe(container)).toHaveNoViolations();
  });
});
