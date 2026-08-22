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
import {
  invalidateSpendingCategories,
  invalidateSpendingSummaries,
  useSpendingCategories,
  useSpendingSummary,
} from "../lib/spendingDataCache";
import type {
  PaymentMethod,
  PersonalExpense,
  SpendingCategory,
  SpendingColour,
  SpendingIcon,
  SpendingSummary,
  WeekStart,
} from "../lib/types";

type Period = "today" | "week" | "month" | "custom";
type View = "dashboard" | "history" | "categories";

const VIEW_COPY: Record<View, string> = {
  dashboard: "See where your money is going and how spending compares with earnings.",
  history: "Find what you spent, where you spent it, and when it happened.",
  categories: "Organise quick entry without changing your historical records.",
};

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

function formatWholeMoney(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}${CURRENCY}${Math.round(Math.abs(cents) / 100).toLocaleString("en-AU")}`;
}

function formatRange(from: string, to: string): string {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const startText = start.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
  const endText = end.toLocaleDateString("en-AU", { month: "short", day: "numeric", year: "numeric" });
  return `${startText} – ${endText}`;
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

export function spendingRangeFor(period: Period, today: Date, weekStartsOn: WeekStart, customFrom: string, customTo: string) {
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
  const cacheScope = user?.id ?? "logged-out";
  const [view, setView] = useState<View>("dashboard");
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(isoDate(startOfWeek(today, user?.weekStartsOn ?? "Monday")));
  const [customTo, setCustomTo] = useState(isoDate(today));
  const [history, setHistory] = useState<PersonalExpense[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [appliedCategoryFilter, setAppliedCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [editingExpense, setEditingExpense] = useState<PersonalExpense | null>(null);
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const historyRequestRef = useRef(0);
  const historyInitializedRef = useRef(false);

  const range = useMemo(
    () => spendingRangeFor(period, today, user?.weekStartsOn ?? "Monday", customFrom, customTo),
    [period, today, user?.weekStartsOn, customFrom, customTo]
  );
  const rangeValid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to;
  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    refresh: refreshSummary,
  } = useSpendingSummary(cacheScope, range.from, range.to, !!user && rangeValid);
  const {
    data: cachedCategories,
    loading: categoriesLoading,
    error: categoriesError,
    refresh: refreshCategories,
  } = useSpendingCategories(cacheScope, !!user);
  const categories = cachedCategories ?? [];

  const loadHistory = useCallback(async (requestedPage = 1, append = false) => {
    if (!rangeValid) return;
    historyInitializedRef.current = true;
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await api.listPersonalExpenses({
        from: range.from,
        to: range.to,
        categoryId: appliedCategoryFilter || undefined,
        search: appliedSearch || undefined,
        page: requestedPage,
        pageSize: 20,
      });
      if (requestId === historyRequestRef.current) {
        setHistory((current) => append ? [...current, ...result.expenses] : result.expenses);
        setHistoryTotal(result.total);
        setPage(result.page);
        setHasMore(result.hasMore);
      }
    } catch (error) {
      if (requestId === historyRequestRef.current) {
        setHistoryError(error instanceof Error ? error.message : "Couldn't load expense history.");
      }
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  }, [range.from, range.to, rangeValid, appliedCategoryFilter, appliedSearch]);

  useEffect(() => {
    if (view === "history") void loadHistory(1);
  }, [view, loadHistory]);

  const refreshAfterMutation = useCallback(async (message: string) => {
    invalidateSpendingSummaries(cacheScope);
    const refreshes: Promise<unknown>[] = [refreshSummary()];
    if (historyInitializedRef.current) refreshes.push(loadHistory(1));
    await Promise.allSettled(refreshes);
    setAnnouncement(message);
  }, [cacheScope, refreshSummary, loadHistory]);

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

      <p className="spending-view-context">{VIEW_COPY[view]}</p>

      {view !== "categories" && (
        <PeriodControls
          period={period}
          onPeriod={setPeriod}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFrom={setCustomFrom}
          onCustomTo={setCustomTo}
          rangeValid={rangeValid}
        />
      )}

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</div>

      {categoriesError && (
        <StatusBanner tone={cachedCategories ? "warning" : "danger"}>
          <span>
            {categoriesError}{cachedCategories ? " Showing the last loaded categories." : ""}{" "}
            <button type="button" className="banner-inline-action" onClick={() => void refreshCategories().catch(() => {})}>Retry</button>
          </span>
        </StatusBanner>
      )}

      {view === "dashboard" && (
        <SpendingDashboard
          summary={summary}
          loading={summaryLoading}
          error={summaryError}
          onRetry={() => void refreshSummary().catch(() => {})}
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
          categoriesLoading={categoriesLoading}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
          search={search}
          onSearch={setSearch}
          onSubmitSearch={() => {
            setAppliedSearch(search.trim());
            setAppliedCategoryFilter(categoryFilter);
          }}
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
            invalidateSpendingCategories(cacheScope);
            invalidateSpendingSummaries(cacheScope);
            const refreshes: Promise<unknown>[] = [refreshCategories(), refreshSummary()];
            if (historyInitializedRef.current) refreshes.push(loadHistory(1));
            await Promise.allSettled(refreshes);
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
          {(["month", "today", "week", "custom"] as Period[]).map((item) => (
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
    return <SpendingDashboardSkeleton />;
  }
  if (props.error && !props.summary) {
    return <StatusBanner tone="danger"><span>{props.error} <button type="button" className="banner-inline-action" onClick={props.onRetry}>Retry</button></span></StatusBanner>;
  }
  const summary = props.summary;
  if (!summary) return null;
  const change = summary.previous.spendingChangePercent;
  const previousLabel = props.periodText === "this month"
    ? "last month"
    : props.periodText === "this week"
      ? "last week"
      : props.periodText === "today"
        ? "yesterday"
        : "the previous matching period";
  const insight = summary.transactionCount === 0
    ? `No personal expenses have been recorded for ${props.periodText}.`
    : summary.largestCategory
      ? `${summary.largestCategory.name} is your largest spending category ${props.periodText}.`
      : "Your recorded spending is ready to review.";
  const comparison = change === null
    ? `There isn't enough recorded spending from ${previousLabel} to compare yet.`
    : change === 0
      ? `You've spent the same amount as ${previousLabel}.`
      : `You've spent ${Math.abs(change).toFixed(1)}% ${change < 0 ? "less" : "more"} than ${previousLabel}.`;

  return (
    <div className="spending-dashboard" aria-busy={props.loading || undefined}>
      <div className={`spending-cache-status${props.error ? " is-visible" : ""}`} aria-live="polite">
        {props.error && <span>{props.error} Showing the last loaded totals. <button type="button" className="banner-inline-action" onClick={props.onRetry}>Retry</button></span>}
      </div>
      <section className="spending-overview" aria-labelledby="spending-overview-title">
        <div className="spending-overview-heading">
          <div>
            <span className="card-kicker">Money overview</span>
            <h2 id="spending-overview-title">{props.periodText === "this month" ? "This month at a glance" : "Your selected period"}</h2>
          </div>
          <div className="spending-range-chip">
            <span className={`spending-refreshing${props.loading ? " is-visible" : ""}`} aria-live="polite">Updating…</span>
            <span>{formatRange(summary.period.from, summary.period.to)}</span>
          </div>
        </div>
        <div className="spending-summary-grid">
          <SummaryCard tone="earnings" label="Recorded earnings" value={formatMoney(summary.earningsCents)} detail={summary.earningsRecorded ? `Earned ${props.periodText}` : "No earnings recorded yet"} />
          <SummaryCard tone="spending" label="Personal spending" value={formatMoney(summary.totalSpendingCents)} detail={`${summary.transactionCount} ${summary.transactionCount === 1 ? "expense" : "expenses"}`} />
          <SummaryCard tone={summary.differenceCents < 0 ? "warning" : "remaining"} label={summary.differenceCents < 0 ? "Over earnings" : "Remaining"} value={formatMoney(summary.differenceCents)} detail="Earnings minus personal spending" />
          <SummaryCard tone="percentage" label="Earnings spent" value={summary.spendingPercentage === null ? "—" : `${summary.spendingPercentage.toFixed(1)}%`} detail={summary.earningsCents === 0 ? "Add earnings to compare" : "Of recorded earnings"} />
        </div>
      </section>

      <SpendingInsights summary={summary} insight={insight} comparison={comparison} previousLabel={previousLabel} />

      <div className="spending-chart-grid">
        <CategoryBreakdown summary={summary} periodText={props.periodText} />
        <SpendingTrend summary={summary} />
      </div>
      <EarningsComparison summary={summary} />
      <ExpenseListSection title="Recent expenses" expenses={summary.recentExpenses} onEdit={props.onEdit} onDelete={props.onDelete} onAdd={props.onAdd} />
    </div>
  );
}

function SpendingDashboardSkeleton() {
  return (
    <div className="spending-dashboard spending-dashboard-skeleton" aria-busy="true" aria-label="Loading spending dashboard">
      <span className="visually-hidden">Loading spending dashboard</span>
      <div className="spending-cache-status" aria-hidden="true" />
      <section className="spending-overview" aria-hidden="true">
        <div className="spending-overview-heading">
          <div className="skeleton-copy-group"><span className="data-skeleton is-kicker" /><span className="data-skeleton is-heading" /></div>
          <span className="data-skeleton is-chip" />
        </div>
        <div className="spending-summary-grid">
          {[0, 1, 2, 3].map((item) => (
            <div className="card spending-summary-card spending-summary-skeleton" key={item}>
              <span className="data-skeleton is-kicker" />
              <span className="data-skeleton is-value" />
              <span className="data-skeleton is-line" />
            </div>
          ))}
        </div>
      </section>
      <div className="card spending-insights spending-panel-skeleton" aria-hidden="true">
        <span className="data-skeleton is-kicker" /><span className="data-skeleton is-heading" /><span className="data-skeleton is-line is-wide" /><span className="data-skeleton is-line" />
      </div>
      <div className="spending-chart-grid" aria-hidden="true">
        <div className="card spending-chart-card spending-chart-skeleton"><span className="data-skeleton is-heading" /><span className="data-skeleton is-donut" /><span className="data-skeleton is-line is-wide" /></div>
        <div className="card spending-chart-card spending-chart-skeleton"><span className="data-skeleton is-heading" /><div className="data-skeleton-bars"><i /><i /><i /><i /><i /></div></div>
      </div>
      <div className="card spending-comparison spending-panel-skeleton" aria-hidden="true"><span className="data-skeleton is-heading" /><span className="data-skeleton is-line is-wide" /><span className="data-skeleton is-line" /></div>
      <div className="card spending-transactions spending-panel-skeleton" aria-hidden="true"><span className="data-skeleton is-heading" /><span className="data-skeleton is-line is-wide" /><span className="data-skeleton is-line is-wide" /></div>
    </div>
  );
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "earnings" | "spending" | "remaining" | "warning" | "percentage" }) {
  return (
    <div className={`card elev-sm spending-summary-card is-${tone}`}>
      <div className="card-kicker">{label}</div>
      <div className="spending-summary-value">{value}</div>
      <div className="card-meta">{detail}</div>
    </div>
  );
}

function SpendingInsights({ summary, insight, comparison, previousLabel }: {
  summary: SpendingSummary;
  insight: string;
  comparison: string;
  previousLabel: string;
}) {
  return (
    <section className="card elev-sm spending-insights" aria-labelledby="spending-insights-title">
      <div className="spending-insight-copy">
        <span className="card-kicker">Useful right now</span>
        <h2 id="spending-insights-title" className="card-title">Insights</h2>
        <strong>{insight}</strong>
        <span>{comparison}</span>
      </div>
      <dl className="spending-insight-stats">
        <div><dt>Largest category</dt><dd>{summary.largestCategory?.name ?? "—"}<small>{summary.largestCategory ? formatMoney(summary.largestCategory.totalCents) : "No expenses yet"}</small></dd></div>
        <div><dt>Average per day</dt><dd>{formatMoney(summary.averageDailyCents)}<small>Across {summary.period.days} {summary.period.days === 1 ? "day" : "days"}</small></dd></div>
        <div><dt>Transactions</dt><dd>{summary.transactionCount}<small>{summary.transactionCount === 1 ? "Expense recorded" : "Expenses recorded"}</small></dd></div>
        <div><dt>{previousLabel[0].toUpperCase() + previousLabel.slice(1)}</dt><dd>{formatMoney(summary.previous.totalSpendingCents)}<small>Recorded spending</small></dd></div>
      </dl>
    </section>
  );
}

function CategoryBreakdown({ summary, periodText }: { summary: SpendingSummary; periodText: string }) {
  let progress = 0;
  const stops = summary.categories.map((category) => {
    const start = progress;
    progress += summary.totalSpendingCents ? (category.totalCents / summary.totalSpendingCents) * 100 : 0;
    return `${category.colour} ${start}% ${progress}%`;
  });
  const description = summary.categories.length
    ? `Category breakdown. ${summary.categories.map((item) => `${item.name}: ${formatMoney(item.totalCents)}, ${((item.totalCents / summary.totalSpendingCents) * 100).toFixed(1)} percent`).join("; ")}.`
    : "Category breakdown. No personal expenses were recorded for this period.";
  return (
    <section className="card elev-sm spending-chart-card" aria-labelledby="category-breakdown-title">
      <div className="spending-card-heading"><div><span className="card-kicker">Spending breakdown</span><h2 id="category-breakdown-title" className="card-title">Where your money went</h2></div><span>{summary.categories.length} {summary.categories.length === 1 ? "category" : "categories"}</span></div>
      <p className="visually-hidden">{description}</p>
      <div className="category-chart-layout">
        <div className="spending-donut" aria-hidden="true" style={{ background: stops.length ? `conic-gradient(${stops.join(",")})` : undefined }}>
          <span>{formatWholeMoney(summary.totalSpendingCents)}</span><small>Spent {periodText}</small>
        </div>
        <ul className="spending-legend" aria-label="Category totals">
          {summary.categories.length ? summary.categories.map((category) => (
            <li key={category.id}>
              <span className="category-colour-dot" style={{ backgroundColor: category.colour }} aria-hidden="true" />
              <CategoryGlyph icon={category.icon} size={16} />
              <span className="spending-legend-name">{category.name}</span>
              <strong>{formatMoney(category.totalCents)}</strong>
              <span className="spending-legend-percent">{((category.totalCents / summary.totalSpendingCents) * 100).toFixed(1)}%</span>
            </li>
          )) : <li className="spending-empty-inline">No category spending yet.</li>}
        </ul>
      </div>
    </section>
  );
}

function buildTrendBuckets(summary: SpendingSummary) {
  const totalDays = Math.max(1, summary.period.days);
  const bucketSize = totalDays <= 8 ? 1 : totalDays <= 62 ? 7 : Math.ceil(totalDays / 8);
  const periodEnd = parseIsoDate(summary.period.to);
  const buckets: { key: string; label: string; totalCents: number }[] = [];

  for (let offset = 0; offset < totalDays; offset += bucketSize) {
    const start = addDays(parseIsoDate(summary.period.from), offset);
    const end = addDays(start, Math.min(bucketSize - 1, totalDays - offset - 1));
    const boundedEnd = end > periodEnd ? periodEnd : end;
    const from = isoDate(start);
    const to = isoDate(boundedEnd);
    const totalCents = summary.trend.reduce((total, item) => item.date >= from && item.date <= to ? total + item.totalCents : total, 0);
    const label = bucketSize === 1
      ? start.toLocaleDateString("en-AU", { weekday: "short" })
      : `${start.toLocaleDateString("en-AU", { month: "short", day: "numeric" })}–${boundedEnd.toLocaleDateString("en-AU", { day: "numeric" })}`;
    buckets.push({ key: from, label, totalCents });
  }
  return buckets;
}

function SpendingTrend({ summary }: { summary: SpendingSummary }) {
  const buckets = buildTrendBuckets(summary);
  const max = Math.max(1, ...buckets.map((item) => item.totalCents));
  const description = summary.trend.length
    ? `Spending trend from ${summary.period.from} to ${summary.period.to}. ${summary.trend.map((item) => `${item.date}: ${formatMoney(item.totalCents)}`).join("; ")}.`
    : "Spending trend. No personal expenses were recorded for this period.";
  return (
    <section className="card elev-sm spending-chart-card" aria-labelledby="spending-trend-title">
      <div className="spending-card-heading"><div><span className="card-kicker">Trend</span><h2 id="spending-trend-title" className="card-title">Spending over time</h2></div><span>{summary.period.days <= 8 ? "Daily" : "Grouped for clarity"}</span></div>
      <p className="visually-hidden">{description}</p>
      {summary.trend.length ? (
        <div className="spending-trend-bars" aria-hidden="true">
          {buckets.map((item) => (
            <div className="spending-trend-item" key={item.key} title={`${item.label}: ${formatMoney(item.totalCents)}`}>
              <strong>{formatWholeMoney(item.totalCents)}</strong>
              <div className="spending-trend-track"><span style={{ height: `${Math.max(5, (item.totalCents / max) * 100)}%` }} /></div>
              <small>{item.label}</small>
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
  const spendingPerDollar = summary.earningsCents > 0 ? summary.totalSpendingCents / summary.earningsCents : null;
  const takeaway = summary.earningsCents === 0
    ? "Record earnings for this period to see a direct comparison."
    : summary.differenceCents >= 0
      ? `You have ${formatMoney(summary.differenceCents)} remaining after personal spending.`
      : `Personal spending is ${formatMoney(Math.abs(summary.differenceCents))} above recorded earnings.`;
  return (
    <section className="card elev-sm spending-comparison" aria-labelledby="earnings-comparison-title">
      <div className="spending-card-heading">
        <div><span className="card-kicker">Cash flow</span><h2 id="earnings-comparison-title" className="card-title">Earnings versus spending</h2></div>
        <span className={`spending-difference-pill${summary.differenceCents < 0 ? " is-negative" : ""}`}>{formatMoney(summary.differenceCents)} difference</span>
      </div>
      <p>{takeaway}{spendingPerDollar !== null ? ` ${formatMoney(Math.round(spendingPerDollar * 100))} of every ${formatMoney(100)} earned went to personal spending.` : ""}</p>
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
  categoriesLoading: boolean;
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
        <label>Category<select className="input" value={props.categoryFilter} disabled={props.categoriesLoading && props.categories.length === 0} onChange={(e) => props.onCategoryFilter(e.target.value)}><option value="">{props.categoriesLoading && props.categories.length === 0 ? "Loading categories…" : "All categories"}</option>{props.categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.archived ? " (archived)" : ""}</option>)}</select></label>
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
          <div className="spending-dialog-header"><div><span className="card-kicker">Personal spending</span><h2 id="expense-dialog-title">{expense ? "Edit expense" : "Add expense"}</h2><p>{expense ? "Update the details below." : "Record it now. You can edit it any time."}</p></div><button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close expense form"><CloseIcon /></button></div>
          <form className="spending-dialog-form" onSubmit={submit} noValidate>
            <div className="spending-dialog-body">
              {error && <StatusBanner tone="danger">{error}</StatusBanner>}
              <div className="field spending-amount-field"><label htmlFor="expense-amount">Amount</label><span>{CURRENCY}</span><input ref={amountRef} id="expense-amount" className="input" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-describedby="expense-amount-hint" required /><small id="expense-amount-hint">Enter the exact personal expense amount.</small></div>
              <fieldset className="fieldset-plain spending-category-picker"><legend>Category</legend><div>{activeCategories.map((category) => <label className={categoryId === category.id ? "is-selected" : ""} key={category.id} style={{ ["--category-colour" as string]: category.colour }}><input type="radio" name="expense-category" value={category.id} checked={categoryId === category.id} onChange={() => setCategoryId(category.id)} /><CategoryGlyph icon={category.icon} size={18} /><span>{category.name}</span>{category.archived && <small>Archived</small>}</label>)}</div></fieldset>
              <div className="spending-form-grid">
                <div className="field"><label htmlFor="expense-date">Date and time</label><input id="expense-date" className="input" type="datetime-local" value={spentAt} max={localDateTimeValue()} onChange={(e) => setSpentAt(e.target.value)} required /></div>
                <div className="field"><label htmlFor="expense-payment">Payment method <span>(optional)</span></label><select id="expense-payment" className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}><option value="">Not specified</option><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></div>
              </div>
              <div className="field"><label htmlFor="expense-merchant">Merchant or short title <span>(optional)</span></label><input id="expense-merchant" className="input" maxLength={100} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Weekly groceries" /></div>
              <div className="field"><label htmlFor="expense-note">Note <span>(optional)</span></label><textarea id="expense-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything useful to remember" /></div>
            </div>
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

  const activeCount = categories.filter((category) => !category.archived).length;
  const archivedCount = categories.length - activeCount;

  return (
    <section className="spending-categories" aria-labelledby="spending-categories-title">
      <div className="spending-section-heading"><div><h2 id="spending-categories-title">Spending categories</h2><p>Customise quick entry without losing labels on historical expenses.</p></div></div>
      <div className="category-status-row" aria-label="Category status"><span><strong>{activeCount}</strong> active</span><span><strong>{archivedCount}</strong> archived</span></div>
      <div className="spending-category-layout">
        <form className="card elev-sm category-editor" onSubmit={submit}>
          <h3>{editing ? "Edit category" : "Create a custom category"}</h3>
          {error && <StatusBanner tone="danger">{error}</StatusBanner>}
          <div className="field"><label htmlFor="category-name">Name</label><input id="category-name" className="input" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pet care" /></div>
          <fieldset className="fieldset-plain category-icon-options"><legend>Icon</legend><div>{SPENDING_ICONS.map((item) => <label className={icon === item ? "is-selected" : ""} key={item}><input type="radio" name="category-icon" checked={icon === item} onChange={() => setIcon(item)} /><CategoryGlyph icon={item} size={19} /><span className="visually-hidden">{item}</span></label>)}</div></fieldset>
          <fieldset className="fieldset-plain category-colour-options"><legend>Colour</legend><div>{SPENDING_COLOURS.map((item) => <label className={colour === item ? "is-selected" : ""} key={item} style={{ backgroundColor: item }}><input type="radio" name="category-colour" checked={colour === item} onChange={() => setColour(item)} /><span className="visually-hidden">Colour {item}</span></label>)}</div></fieldset>
          <div className="category-editor-actions">{editing && <button className="btn btn-secondary" type="button" onClick={reset}>Cancel</button>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create category"}</button></div>
        </form>
        <div className="card elev-sm category-list-card"><div className="category-list-heading"><h3>Your categories</h3><p>Archived categories stay attached to past expenses.</p></div><ul className="category-management-list">{categories.map((category) => <li key={category.id} className={category.archived ? "is-archived" : ""}><span className="expense-category-icon" style={{ color: category.colour }}><CategoryGlyph icon={category.icon} size={19} /></span><div><strong>{category.name}</strong><span>{category.isDefault ? "Default" : "Custom"}{category.archived ? " · Archived" : " · Active"}</span></div><button type="button" className="btn btn-icon btn-ghost" onClick={() => beginEdit(category)} aria-label={`Edit ${category.name}`}><EditIcon size={16} /></button>{category.archived ? <button type="button" className="btn btn-secondary category-state-btn" onClick={() => void setArchived(category, false)}>Restore</button> : <button type="button" className="btn btn-secondary category-state-btn" data-confirm={`Archive ${category.name}? It will remain on historical expenses.`} onClick={() => void setArchived(category, true)}>Archive</button>}</li>)}</ul></div>
      </div>
    </section>
  );
}
