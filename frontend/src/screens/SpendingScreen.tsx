import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Overlay } from "../components/Overlay";
import { StatusBanner } from "../components/StatusBanner";
import {
  CategoryGlyph,
  CloseIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
} from "../components/icons";
import { CURRENCY, useApp } from "../context/AppContext";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { addDays, isoDate, parseIsoDate, shortLabel, startOfWeek } from "../lib/date";
import { useFocusTrap } from "../lib/useFocusTrap";
import type {
  PaymentMethod,
  PersonalExpense,
  SpendingCategory,
  SpendingColour,
  SpendingIcon,
  SpendingSummary,
} from "../lib/types";

type Period = "today" | "week" | "month" | "custom";
type View = "dashboard" | "history" | "categories";

export const SPENDING_COLOURS: SpendingColour[] = [
  "#B45309", "#047857", "#1D4ED8", "#7C3AED", "#0E7490", "#BE123C",
  "#9F1239", "#6D28D9", "#0369A1", "#A16207", "#475569",
];
export const SPENDING_ICONS: SpendingIcon[] = [
  "dining", "groceries", "transport", "housing", "bills", "shopping",
  "health", "entertainment", "education", "family", "other",
];

function formatMoney(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}${CURRENCY}${(Math.abs(cents) / 100).toFixed(2)}`;
}

function localDateTimeValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 3) | 8).toString(16);
  });
}

function displayExpenseDate(expense: PersonalExpense): string {
  const date = parseIsoDate(expense.spentDate);
  const time = expense.spentAt.slice(11, 16);
  const [hour, minute] = time.split(":").map(Number);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${shortLabel(date)}, ${h12}:${String(minute).padStart(2, "0")} ${period}`;
}

function paymentLabel(method: PaymentMethod | null): string | null {
  if (!method) return null;
  return { card: "Card", cash: "Cash", bank_transfer: "Bank transfer", other: "Other" }[method];
}

function rangeFor(period: Period, today: Date, weekStartsOn: "Monday" | "Sunday", customFrom: string, customTo: string) {
  if (period === "today") {
    const date = isoDate(today);
    return { from: date, to: date };
  }
  if (period === "week") {
    const start = startOfWeek(today, weekStartsOn);
    return { from: isoDate(start), to: isoDate(addDays(start, 6)) };
  }
  if (period === "month") {
    return {
      from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  return { from: customFrom, to: customTo };
}

function periodLabel(period: Period, from: string, to: string): string {
  if (period === "today") return "today";
  if (period === "week") return "this week";
  if (period === "month") return "this month";
  if (!from || !to) return "this period";
  return `${shortLabel(parseIsoDate(from))} to ${shortLabel(parseIsoDate(to))}`;
}

export function SpendingScreen() {
  const { today, user } = useApp();
  const [view, setView] = useState<View>("dashboard");
  const [period, setPeriod] = useState<Period>("week");
  const [customFrom, setCustomFrom] = useState(isoDate(startOfWeek(today, user?.weekStartsOn ?? "Monday")));
  const [customTo, setCustomTo] = useState(isoDate(today));
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [history, setHistory] = useState<PersonalExpense[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [editingExpense, setEditingExpense] = useState<PersonalExpense | null>(null);
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const range = useMemo(
    () => rangeFor(period, today, user?.weekStartsOn ?? "Monday", customFrom, customTo),
    [period, today, user?.weekStartsOn, customFrom, customTo]
  );
  const rangeValid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to;

  const loadCategories = useCallback(async () => {
    const result = await api.listSpendingCategories(true);
    setCategories(result.categories);
  }, []);

  const loadSummary = useCallback(async () => {
    if (!rangeValid) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await api.getSpendingSummary(range.from, range.to));
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Couldn't load spending summary.");
    } finally {
      setSummaryLoading(false);
    }
  }, [range.from, range.to, rangeValid]);

  const loadHistory = useCallback(async (requestedPage = 1, append = false) => {
    if (!rangeValid) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await api.listPersonalExpenses({
        from: range.from,
        to: range.to,
        categoryId: categoryFilter || undefined,
        search: appliedSearch || undefined,
        page: requestedPage,
        pageSize: 20,
      });
      setHistory((current) => append ? [...current, ...result.expenses] : result.expenses);
      setHistoryTotal(result.total);
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Couldn't load expense history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [range.from, range.to, rangeValid, categoryFilter, appliedSearch]);

  useEffect(() => {
    void loadCategories().catch(() => setSummaryError("Couldn't load spending categories."));
  }, [loadCategories]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadHistory(1); }, [loadHistory]);

  const refreshAfterMutation = useCallback(async (message: string) => {
    await Promise.all([loadSummary(), loadHistory(1), loadCategories()]);
    setAnnouncement(message);
  }, [loadSummary, loadHistory, loadCategories]);

  function openAddExpense() {
    setEditingExpense(null);
    setExpenseFormOpen(true);
  }

  function openEditExpense(expense: PersonalExpense) {
    setEditingExpense(expense);
    setExpenseFormOpen(true);
  }

  async function deleteExpense(expense: PersonalExpense) {
    try {
      await api.deletePersonalExpense(expense.id);
      await refreshAfterMutation("Expense deleted.");
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Couldn't delete the expense.");
    }
  }

  if (!user) return null;

  return (
    <div className="screen-wide spending-screen">
      <div className="spending-heading-row">
        <div>
          <h1 className="section-title">Spending</h1>
          <p className="section-hint">Track what you earn, record what you spend, and understand the difference.</p>
        </div>
        <button type="button" className="btn btn-primary spending-add-btn" onClick={openAddExpense}>
          <PlusIcon size={17} /> Add expense
        </button>
      </div>

      <div className="spending-view-tabs" role="tablist" aria-label="Spending views">
        {(["dashboard", "history", "categories"] as View[]).map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={view === item}
            className={view === item ? "is-active" : ""}
            onClick={() => setView(item)}
            key={item}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      <PeriodControls
        period={period}
        onPeriod={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
        rangeValid={rangeValid}
      />

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</div>

      {view === "dashboard" && (
        <SpendingDashboard
          summary={summary}
          loading={summaryLoading}
          error={summaryError}
          onRetry={() => void loadSummary()}
          periodText={periodLabel(period, range.from, range.to)}
          onEdit={openEditExpense}
          onDelete={(expense) => void deleteExpense(expense)}
          onAdd={openAddExpense}
        />
      )}

      {view === "history" && (
        <ExpenseHistory
          expenses={history}
          total={historyTotal}
          loading={historyLoading}
          error={historyError}
          categories={categories}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
          search={search}
          onSearch={setSearch}
          onSubmitSearch={() => setAppliedSearch(search.trim())}
          onRetry={() => void loadHistory(1)}
          onEdit={openEditExpense}
          onDelete={(expense) => void deleteExpense(expense)}
          hasMore={hasMore}
          onLoadMore={() => void loadHistory(page + 1, true)}
          onAdd={openAddExpense}
        />
      )}

      {view === "categories" && (
        <CategoryManager
          categories={categories}
          onChanged={async (message) => {
            await Promise.all([loadCategories(), loadSummary(), loadHistory(1)]);
            setAnnouncement(message);
          }}
        />
      )}

      {expenseFormOpen && (
        <ExpenseDialog
          categories={categories}
          expense={editingExpense}
          onClose={() => setExpenseFormOpen(false)}
          onSaved={async () => {
            setExpenseFormOpen(false);
            await refreshAfterMutation(editingExpense ? "Expense updated." : "Expense added.");
          }}
        />
      )}
    </div>
  );
}

function PeriodControls(props: {
  period: Period;
  onPeriod: (period: Period) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
  rangeValid: boolean;
}) {
  return (
    <div className="spending-period-wrap">
      <fieldset className="fieldset-plain">
        <legend className="visually-hidden">Dashboard period</legend>
        <div className="spending-periods">
          {(["today", "week", "month", "custom"] as Period[]).map((item) => (
            <label key={item} className={props.period === item ? "is-active" : ""}>
              <input type="radio" name="spending-period" checked={props.period === item} onChange={() => props.onPeriod(item)} />
              {item === "today" ? "Today" : item === "week" ? "This week" : item === "month" ? "This month" : "Custom range"}
            </label>
          ))}
        </div>
      </fieldset>
      {props.period === "custom" && (
        <div className="spending-custom-range">
          <label>From<input className="input" type="date" value={props.customFrom} onChange={(e) => props.onCustomFrom(e.target.value)} /></label>
          <label>To<input className="input" type="date" value={props.customTo} onChange={(e) => props.onCustomTo(e.target.value)} /></label>
          {!props.rangeValid && <span className="field-hint-danger" role="alert">Choose an end date on or after the start date.</span>}
        </div>
      )}
    </div>
  );
}

function SpendingDashboard(props: {
  summary: SpendingSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  periodText: string;
  onEdit: (expense: PersonalExpense) => void;
  onDelete: (expense: PersonalExpense) => void;
  onAdd: () => void;
}) {
  if (props.loading && !props.summary) {
    return <div className="spending-loading" aria-busy="true"><span className="spinner" /> Loading spending dashboard…</div>;
  }
  if (props.error && !props.summary) {
    return <StatusBanner tone="danger"><span>{props.error} <button type="button" className="banner-inline-action" onClick={props.onRetry}>Retry</button></span></StatusBanner>;
  }
  const summary = props.summary;
  if (!summary) return null;
  const change = summary.previous.spendingChangePercent;
  const insight = summary.transactionCount === 0
    ? `No personal expenses have been recorded for ${props.periodText}.`
    : summary.largestCategory
      ? `Most of your recorded spending ${props.periodText} was ${summary.largestCategory.name}.`
      : "Your recorded spending is ready to review.";
  const comparison = change === null
    ? "No earlier recorded spending is available for comparison."
    : change === 0
      ? "Recorded spending was the same as the previous period."
      : `You recorded ${Math.abs(change).toFixed(1)}% ${change < 0 ? "less" : "more"} spending than the previous period.`;

  return (
    <div className="spending-dashboard" aria-busy={props.loading || undefined}>
      {props.error && <StatusBanner tone="warning"><span>{props.error} Showing the last loaded totals.</span></StatusBanner>}
      <div className="spending-summary-grid">
        <SummaryCard label="Earnings recorded" value={formatMoney(summary.earningsCents)} detail={summary.earningsRecorded ? props.periodText : `${formatMoney(0)} earnings recorded`} />
        <SummaryCard label="Personal spending" value={formatMoney(summary.totalSpendingCents)} detail={`${summary.transactionCount} ${summary.transactionCount === 1 ? "transaction" : "transactions"}`} />
        <SummaryCard label="Difference" value={formatMoney(summary.differenceCents)} detail="Recorded earnings minus personal spending" neutral={summary.differenceCents < 0} />
        <SummaryCard label="Spending of earnings" value={summary.spendingPercentage === null ? "—" : `${summary.spendingPercentage.toFixed(1)}%`} detail={summary.earningsCents === 0 ? "$0 earnings recorded" : "Of recorded earnings"} />
      </div>

      <div className="spending-secondary-grid">
        <SummaryCard label="Daily average" value={formatMoney(summary.averageDailyCents)} detail={`Across ${summary.period.days} ${summary.period.days === 1 ? "day" : "days"}`} compact />
        <SummaryCard label="Largest category" value={summary.largestCategory?.name ?? "—"} detail={summary.largestCategory ? formatMoney(summary.largestCategory.totalCents) : "No expenses in this period"} compact />
        <SummaryCard label="Previous period" value={formatMoney(summary.previous.totalSpendingCents)} detail={comparison} compact />
      </div>

      <div className="spending-insight card elev-sm">
        <strong>{insight}</strong>
        <span>{comparison}</span>
      </div>

      <div className="spending-chart-grid">
        <CategoryBreakdown summary={summary} />
        <SpendingTrend summary={summary} />
      </div>
      <EarningsComparison summary={summary} />
      <ExpenseListSection title="Recent expenses" expenses={summary.recentExpenses} onEdit={props.onEdit} onDelete={props.onDelete} onAdd={props.onAdd} />
    </div>
  );
}

function SummaryCard({ label, value, detail, compact, neutral }: { label: string; value: string; detail: string; compact?: boolean; neutral?: boolean }) {
  return (
    <div className={`card elev-sm spending-summary-card${compact ? " is-compact" : ""}${neutral ? " is-neutral" : ""}`}>
      <div className="card-kicker">{label}</div>
      <div className="spending-summary-value">{value}</div>
      <div className="card-meta">{detail}</div>
    </div>
  );
}

function CategoryBreakdown({ summary }: { summary: SpendingSummary }) {
  let progress = 0;
  const stops = summary.categories.map((category) => {
    const start = progress;
    progress += summary.totalSpendingCents ? (category.totalCents / summary.totalSpendingCents) * 100 : 0;
    return `${category.colour} ${start}% ${progress}%`;
  });
  const description = summary.categories.length
    ? `Category breakdown. ${summary.categories.map((item) => `${item.name}: ${formatMoney(item.totalCents)}`).join("; ")}.`
    : "Category breakdown. No personal expenses were recorded for this period.";
  return (
    <section className="card elev-sm spending-chart-card" aria-labelledby="category-breakdown-title">
      <h2 id="category-breakdown-title" className="card-title">Category breakdown</h2>
      <p className="visually-hidden">{description}</p>
      <div className="category-chart-layout">
        <div className="spending-donut" aria-hidden="true" style={{ background: stops.length ? `conic-gradient(${stops.join(",")})` : undefined }}>
          <span>{summary.transactionCount}</span><small>expenses</small>
        </div>
        <ul className="spending-legend" aria-label="Category totals">
          {summary.categories.length ? summary.categories.map((category) => (
            <li key={category.id}>
              <span className="category-colour-dot" style={{ backgroundColor: category.colour }} aria-hidden="true" />
              <CategoryGlyph icon={category.icon} size={16} />
              <span>{category.name}</span><strong>{formatMoney(category.totalCents)}</strong>
            </li>
          )) : <li className="spending-empty-inline">No category spending yet.</li>}
        </ul>
      </div>
    </section>
  );
}

function SpendingTrend({ summary }: { summary: SpendingSummary }) {
  const max = Math.max(1, ...summary.trend.map((item) => item.totalCents));
  const description = summary.trend.length
    ? `Spending trend from ${summary.period.from} to ${summary.period.to}. ${summary.trend.map((item) => `${item.date}: ${formatMoney(item.totalCents)}`).join("; ")}.`
    : "Spending trend. No personal expenses were recorded for this period.";
  return (
    <section className="card elev-sm spending-chart-card" aria-labelledby="spending-trend-title">
      <h2 id="spending-trend-title" className="card-title">Spending trend</h2>
      <p className="visually-hidden">{description}</p>
      {summary.trend.length ? (
        <div className="spending-trend-bars" aria-hidden="true">
          {summary.trend.map((item) => (
            <div className="spending-trend-item" key={item.date} title={`${item.date}: ${formatMoney(item.totalCents)}`}>
              <div className="spending-trend-track"><span style={{ height: `${Math.max(5, (item.totalCents / max) * 100)}%` }} /></div>
              <small>{item.date.slice(5).replace("-", "/")}</small>
            </div>
          ))}
        </div>
      ) : <div className="spending-chart-empty">Add an expense to start your trend.</div>}
      <ul className="visually-hidden">
        {summary.trend.map((item) => <li key={item.date}>{item.date}: {formatMoney(item.totalCents)}</li>)}
      </ul>
    </section>
  );
}

function EarningsComparison({ summary }: { summary: SpendingSummary }) {
  const max = Math.max(summary.earningsCents, summary.totalSpendingCents, 1);
  return (
    <section className="card elev-sm spending-comparison" aria-labelledby="earnings-comparison-title">
      <div>
        <h2 id="earnings-comparison-title" className="card-title">Earnings versus spending</h2>
        <p>Recorded earnings {formatMoney(summary.earningsCents)}; personal spending {formatMoney(summary.totalSpendingCents)}; difference {formatMoney(summary.differenceCents)}.</p>
      </div>
      <div className="comparison-bars" aria-hidden="true">
        <div><span>Earnings</span><div><i style={{ width: `${(summary.earningsCents / max) * 100}%` }} /></div><strong>{formatMoney(summary.earningsCents)}</strong></div>
        <div><span>Spending</span><div><i className="is-spending" style={{ width: `${(summary.totalSpendingCents / max) * 100}%` }} /></div><strong>{formatMoney(summary.totalSpendingCents)}</strong></div>
      </div>
    </section>
  );
}

function ExpenseHistory(props: {
  expenses: PersonalExpense[];
  total: number;
  loading: boolean;
  error: string | null;
  categories: SpendingCategory[];
  categoryFilter: string;
  onCategoryFilter: (value: string) => void;
  search: string;
  onSearch: (value: string) => void;
  onSubmitSearch: () => void;
  onRetry: () => void;
  onEdit: (expense: PersonalExpense) => void;
  onDelete: (expense: PersonalExpense) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  onAdd: () => void;
}) {
  return (
    <section className="spending-history" aria-labelledby="expense-history-title">
      <div className="spending-section-heading"><div><h2 id="expense-history-title">Expense history</h2><p>{props.total} recorded {props.total === 1 ? "expense" : "expenses"} in this period.</p></div></div>
      <form className="spending-filters card" onSubmit={(event) => { event.preventDefault(); props.onSubmitSearch(); }}>
        <label>Search merchant or title<input className="input" type="search" value={props.search} onChange={(e) => props.onSearch(e.target.value)} placeholder="e.g. supermarket" /></label>
        <label>Category<select className="input" value={props.categoryFilter} onChange={(e) => props.onCategoryFilter(e.target.value)}><option value="">All categories</option>{props.categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.archived ? " (archived)" : ""}</option>)}</select></label>
        <button type="submit" className="btn btn-secondary">Apply filters</button>
      </form>
      {props.error && <StatusBanner tone="danger"><span>{props.error} <button className="banner-inline-action" type="button" onClick={props.onRetry}>Retry</button></span></StatusBanner>}
      {props.loading && props.expenses.length === 0 ? <div className="spending-loading" aria-busy="true"><span className="spinner" /> Loading expenses…</div> : (
        <ExpenseListSection title="Transactions" expenses={props.expenses} onEdit={props.onEdit} onDelete={props.onDelete} onAdd={props.onAdd} />
      )}
      {props.hasMore && <button className="btn btn-secondary spending-load-more" type="button" disabled={props.loading} onClick={props.onLoadMore}>{props.loading ? "Loading…" : "Load more"}</button>}
    </section>
  );
}

function ExpenseListSection({ title, expenses, onEdit, onDelete, onAdd }: {
  title: string;
  expenses: PersonalExpense[];
  onEdit: (expense: PersonalExpense) => void;
  onDelete: (expense: PersonalExpense) => void;
  onAdd: () => void;
}) {
  return (
    <section className="card elev-sm spending-transactions" aria-labelledby={`expense-list-${title.replace(/\s/g, "-")}`}>
      <h2 id={`expense-list-${title.replace(/\s/g, "-")}`} className="card-title">{title}</h2>
      {expenses.length === 0 ? (
        <div className="spending-empty-state"><CategoryGlyph icon="other" size={30} /><strong>No personal expenses recorded</strong><span>Add an expense when you're ready. Work-related costs remain separate.</span><button type="button" className="btn btn-primary" onClick={onAdd}><PlusIcon size={17} /> Add expense</button></div>
      ) : (
        <ul className="expense-list">
          {expenses.map((expense) => (
            <li key={expense.id}>
              <span className="expense-category-icon" style={{ color: expense.category.colour }} aria-hidden="true"><CategoryGlyph icon={expense.category.icon} size={20} /></span>
              <div className="expense-main"><strong>{expense.merchant || expense.category.name}</strong><span>{expense.category.name}{expense.category.archived ? " · Archived" : ""} · {displayExpenseDate(expense)}{paymentLabel(expense.paymentMethod) ? ` · ${paymentLabel(expense.paymentMethod)}` : ""}</span>{expense.note && <small>{expense.note}</small>}</div>
              <strong className="expense-amount">{formatMoney(expense.amountCents)}</strong>
              <div className="expense-actions">
                <button type="button" className="btn btn-icon btn-ghost" aria-label={`Edit ${expense.merchant || expense.category.name} expense`} onClick={() => onEdit(expense)}><EditIcon size={17} /></button>
                <button type="button" className="btn btn-icon btn-ghost expense-delete" aria-label={`Delete ${expense.merchant || expense.category.name} expense`} data-confirm="Delete this personal expense? This cannot be undone." data-confirm-tone="danger" onClick={() => onDelete(expense)}><TrashIcon size={17} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExpenseDialog({ categories, expense, onClose, onSaved }: {
  categories: SpendingCategory[];
  expense: PersonalExpense | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const activeCategories = categories.filter((category) => !category.archived || category.id === expense?.categoryId);
  const [amount, setAmount] = useState(expense ? (expense.amountCents / 100).toFixed(2) : "");
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? activeCategories[0]?.id ?? "");
  const [spentAt, setSpentAt] = useState(expense?.spentAt ?? localDateTimeValue());
  const [merchant, setMerchant] = useState(expense?.merchant ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(expense?.paymentMethod ?? "");
  const [requestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose, amountRef);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = amount.trim();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) {
      setError("Enter a valid amount with up to two decimal places.");
      amountRef.current?.focus();
      return;
    }
    const amountCents = Math.round(Number(trimmed) * 100);
    if (amountCents <= 0) {
      setError("Amount must be greater than zero.");
      amountRef.current?.focus();
      return;
    }
    if (!categoryId) {
      setError("Choose a category.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { amountCents, categoryId, spentAt, merchant, note, paymentMethod: paymentMethod || null };
      if (expense) await api.patchPersonalExpense(expense.id, input);
      else await api.createPersonalExpense({ ...input, clientRequestId: requestId });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't save the expense. Your entries are still here—try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay>
      <div className="spending-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="spending-dialog" role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title" ref={dialogRef} tabIndex={-1}>
          <div className="spending-dialog-header"><div><span className="card-kicker">Personal spending</span><h2 id="expense-dialog-title">{expense ? "Edit expense" : "Add expense"}</h2></div><button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close expense form"><CloseIcon /></button></div>
          <form onSubmit={submit} noValidate>
            {error && <StatusBanner tone="danger">{error}</StatusBanner>}
            <div className="field spending-amount-field"><label htmlFor="expense-amount">Amount</label><span>{CURRENCY}</span><input ref={amountRef} id="expense-amount" className="input" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-describedby="expense-amount-hint" required /><small id="expense-amount-hint">Enter the exact personal expense amount.</small></div>
            <fieldset className="fieldset-plain spending-category-picker"><legend>Category</legend><div>{activeCategories.map((category) => <label className={categoryId === category.id ? "is-selected" : ""} key={category.id} style={{ ["--category-colour" as string]: category.colour }}><input type="radio" name="expense-category" value={category.id} checked={categoryId === category.id} onChange={() => setCategoryId(category.id)} /><CategoryGlyph icon={category.icon} size={18} /><span>{category.name}</span>{category.archived && <small>Archived</small>}</label>)}</div></fieldset>
            <div className="spending-form-grid">
              <div className="field"><label htmlFor="expense-date">Date and time</label><input id="expense-date" className="input" type="datetime-local" value={spentAt} max={localDateTimeValue()} onChange={(e) => setSpentAt(e.target.value)} required /></div>
              <div className="field"><label htmlFor="expense-payment">Payment method <span>(optional)</span></label><select id="expense-payment" className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}><option value="">Not specified</option><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></div>
            </div>
            <div className="field"><label htmlFor="expense-merchant">Merchant or short title <span>(optional)</span></label><input id="expense-merchant" className="input" maxLength={100} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Weekly groceries" /></div>
            <div className="field"><label htmlFor="expense-note">Note <span>(optional)</span></label><textarea id="expense-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything useful to remember" /></div>
            <div className="spending-dialog-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : expense ? "Save changes" : "Add expense"}</button></div>
          </form>
        </div>
      </div>
    </Overlay>
  );
}

function CategoryManager({ categories, onChanged }: { categories: SpendingCategory[]; onChanged: (message: string) => Promise<void> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = categories.find((category) => category.id === editingId) ?? null;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<SpendingIcon>("other");
  const [colour, setColour] = useState<SpendingColour>("#475569");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beginEdit(category: SpendingCategory) {
    setEditingId(category.id); setName(category.name); setIcon(category.icon); setColour(category.colour); setError(null);
  }
  function reset() { setEditingId(null); setName(""); setIcon("other"); setColour("#475569"); setError(null); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) { setError("Enter a category name."); return; }
    setBusy(true); setError(null);
    try {
      if (editing) await api.patchSpendingCategory(editing.id, { name, icon, colour });
      else await api.createSpendingCategory({ name, icon, colour });
      reset();
      await onChanged(editing ? "Category updated." : "Custom category created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save the category.");
    } finally { setBusy(false); }
  }

  async function setArchived(category: SpendingCategory, archived: boolean) {
    setError(null);
    try {
      if (archived) await api.archiveSpendingCategory(category.id);
      else await api.patchSpendingCategory(category.id, { archived: false });
      await onChanged(archived ? "Category archived. Historical expenses still show it." : "Category restored.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't update the category."); }
  }

  return (
    <section className="spending-categories" aria-labelledby="spending-categories-title">
      <div className="spending-section-heading"><div><h2 id="spending-categories-title">Spending categories</h2><p>Customise quick entry without losing labels on historical expenses.</p></div></div>
      <div className="spending-category-layout">
        <form className="card elev-sm category-editor" onSubmit={submit}>
          <h3>{editing ? "Edit category" : "Create a custom category"}</h3>
          {error && <StatusBanner tone="danger">{error}</StatusBanner>}
          <div className="field"><label htmlFor="category-name">Name</label><input id="category-name" className="input" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pet care" /></div>
          <fieldset className="fieldset-plain category-icon-options"><legend>Icon</legend><div>{SPENDING_ICONS.map((item) => <label className={icon === item ? "is-selected" : ""} key={item}><input type="radio" name="category-icon" checked={icon === item} onChange={() => setIcon(item)} /><CategoryGlyph icon={item} size={19} /><span className="visually-hidden">{item}</span></label>)}</div></fieldset>
          <fieldset className="fieldset-plain category-colour-options"><legend>Colour</legend><div>{SPENDING_COLOURS.map((item) => <label className={colour === item ? "is-selected" : ""} key={item} style={{ backgroundColor: item }}><input type="radio" name="category-colour" checked={colour === item} onChange={() => setColour(item)} /><span className="visually-hidden">Colour {item}</span></label>)}</div></fieldset>
          <div className="category-editor-actions">{editing && <button className="btn btn-secondary" type="button" onClick={reset}>Cancel</button>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create category"}</button></div>
        </form>
        <div className="card elev-sm category-list-card"><h3>Your categories</h3><ul className="category-management-list">{categories.map((category) => <li key={category.id} className={category.archived ? "is-archived" : ""}><span className="expense-category-icon" style={{ color: category.colour }}><CategoryGlyph icon={category.icon} size={19} /></span><div><strong>{category.name}</strong><span>{category.isDefault ? "Default" : "Custom"}{category.archived ? " · Archived" : " · Active"}</span></div><button type="button" className="btn btn-icon btn-ghost" onClick={() => beginEdit(category)} aria-label={`Edit ${category.name}`}><EditIcon size={16} /></button>{category.archived ? <button type="button" className="btn btn-secondary category-state-btn" onClick={() => void setArchived(category, false)}>Restore</button> : <button type="button" className="btn btn-secondary category-state-btn" data-confirm={`Archive ${category.name}? It will remain on historical expenses.`} onClick={() => void setArchived(category, true)}>Archive</button>}</li>)}</ul></div>
      </div>
    </section>
  );
}
