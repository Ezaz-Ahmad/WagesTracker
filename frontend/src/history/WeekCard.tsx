import { useState } from "react";
import { CURRENCY, useApp } from "../context/AppContext";
import { buildWeekDays, fmt2, parseIsoDate } from "../lib/date";
import { buildWeekDaysComputed, groupByDate, groupExpensesByDate, type WeekSummary } from "../lib/aggregate";
import { usePdfDownload } from "../lib/usePdfDownload";
import { Amount } from "../components/Amount";
import { BubbleLoader } from "../components/BubbleLoader";
import { StableLabel } from "../components/StableLabel";
import { StatusBanner } from "../components/StatusBanner";
import { ChevronDownIcon, DownloadIcon } from "../components/icons";
import type { DayEditorTarget } from "./DayEditorSheet";

interface WeekCardProps {
  week: WeekSummary;
  metGoal: boolean;
  onEditDay: (target: DayEditorTarget) => void;
}

/**
 * One completed week in History: a summary that stays scannable, an expand
 * control, a PDF download, and — once expanded — the week's seven days with
 * an edit action each.
 *
 * The days are built with `buildWeekDaysComputed`, the same function Home,
 * Entry and Report use. Nothing about a week's hours or earnings is computed
 * here; this component only chooses which week to hand that function.
 *
 * `usePdfDownload` is instantiated per card rather than once for the screen.
 * A single shared instance would have one `downloading` flag for every week,
 * so starting a download on one row would show every row as busy and an
 * error on one would appear on all of them.
 */
export function WeekCard({ week, metGoal, onEditDay }: WeekCardProps) {
  const { user, shifts, dayExpenses, today } = useApp();
  const [expanded, setExpanded] = useState(false);
  const { download, downloading, justDownloaded, error, clearError } = usePdfDownload();

  if (!user) return null;

  const weekStart = parseIsoDate(week.startISO);
  const weekDays = buildWeekDays(weekStart, user.weekStartsOn);
  const shiftsByDate = groupByDate(shifts);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, CURRENCY, user.rate, groupExpensesByDate(dayExpenses));

  function handleDownload() {
    // The shared pipeline refetches this exact week's shifts, fuel, and
    // extras before generation, so stale screen state cannot enter the PDF.
    void download({ user: user!, today, currency: CURRENCY, weekAnchor: weekStart });
  }

  const panelId = `history-week-${week.startISO}`;

  return (
    <li className="card elev-sm history-week">
      <div className="history-week-head">
        <div className="history-week-heading">
          {/* h2, not h3: the screen's only h1 is "History", so a week is the
              next level down. Jumping to h3 leaves a gap that a screen-reader
              user navigating by heading reads as a missing section. */}
          <h2 className="history-week-range">{week.label}</h2>
          <p className="history-week-summary">
            {fmt2(week.hours)}h · <Amount>{CURRENCY}{fmt2(week.earnings)}</Amount>
          </p>
        </div>
        <span className={`tag ${metGoal ? "tag-accent" : "tag-neutral"} history-week-tag`}>
          {metGoal ? "Met goal" : "Under goal"}
        </span>
      </div>

      <div className="history-week-actions">
        <button
          type="button"
          className="btn btn-secondary history-week-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
        >
          <ChevronDownIcon size={15} className={`history-week-chevron${expanded ? " is-open" : ""}`} />
          <StableLabel current={expanded ? "Hide days" : "View days"} longest="Hide days" />
        </button>

        {/* Width-stable across all three states so the row beside it never
            shifts mid-download. */}
        <button
          type="button"
          className={`btn btn-secondary btn-stable history-week-download${justDownloaded ? " btn-save-flash" : ""}`}
          onClick={handleDownload}
          disabled={downloading}
          aria-busy={downloading || undefined}
          aria-label={`Download PDF for ${week.label}`}
        >
          {downloading && (
            <span className="btn-stable-overlay">
              <BubbleLoader label={`Preparing PDF for ${week.label}`} />
            </span>
          )}
          <span className={downloading ? "btn-stable-hidden" : undefined}>
            <DownloadIcon size={15} />
            <StableLabel current={justDownloaded ? "Downloaded" : "PDF"} longest="Downloaded" />
          </span>
        </button>
      </div>

      {error && (
        <StatusBanner tone="danger" onDismiss={clearError} dismissLabel="Dismiss this error">
          {error}{" "}
          <button type="button" className="btn btn-ghost history-retry" onClick={handleDownload}>
            Try again
          </button>
        </StatusBanner>
      )}

      <div id={panelId} hidden={!expanded} className="history-week-days">
        {days.every((d) => d.hours === 0 && d.fuelCost === 0) ? (
          <p className="section-hint history-week-empty">
            Nothing was logged this week. You can still add hours to any day below.
          </p>
        ) : null}
        <ul className="history-day-list">
          {days.map((day) => {
            const dayShifts = shiftsByDate.get(day.dateISO) ?? [];
            const hasEntry = dayShifts.length > 0;
            return (
              <li className="history-day" key={day.dateISO}>
                <div className="history-day-main">
                  <span className="history-day-name">
                    {day.dayAbbr} {day.dateLabel}
                  </span>
                  <span className={`history-day-hours${day.hours > 0 ? "" : " is-empty"}`}>{day.hoursLabel}</span>
                  {day.fuelCost > 0 && (
                    <span className="history-day-fuel">
                      Fuel allowance <Amount>{CURRENCY}{fmt2(day.fuelCost)}</Amount>
                      {(() => {
                        const expense = dayExpenses.find((item) => item.date === day.dateISO);
                        const source = expense?.manualOverride != null || expense?.source === "manual"
                          ? "manual"
                          : expense?.automaticFuelAllowance != null || expense?.source === "automatic"
                            ? "automatic"
                            : "recorded";
                        return <span className="fuel-source-badge history-fuel-source">{source}</span>;
                      })()}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost history-day-edit"
                  onClick={() => onEditDay({ dateISO: day.dateISO })}
                  // The visible label is two words; the accessible name has
                  // to name the day too, or a screen-reader user hears
                  // Keep the established action name while making fuel
                  // discoverable in its description inside the editor.
                  aria-label={`${hasEntry ? "Edit" : "Add"} hours for ${day.dayAbbr} ${day.dateLabel}`}
                >
                  {hasEntry || day.fuelCost > 0 ? "Edit day" : "Add details"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
}
