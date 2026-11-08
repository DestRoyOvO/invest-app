"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { SkeletonRows } from "@/components/ui/States";
import { StatTile } from "@/components/ui/StatTile";
import { nyClock, nyShortDate, nyWeekday, type AgendaItem } from "@/lib/events";
import { formatDate, formatRatio, tpl } from "@/lib/format";
import { MACRO_CALENDAR_ENDS, MACRO_EVENTS, MACRO_SOURCES } from "@/lib/macro-calendar";

import { SourceLink } from "./AgendaList";
import { formatMoney, glance, periodMonthName, type Amount } from "./agenda-format";
import { weekdayDay } from "./earnings-model";

// The calendar's side column: totals for the period, the next macro releases, and how to read the agenda.

function money(amount: Amount | null, lang: "en" | "zh", cents = false): string {
  return amount ? formatMoney(amount.value, amount.currency, lang, cents) : "—";
}

function tickers(symbols: readonly string[], max = 4): string {
  return symbols.length > max ? `${symbols.slice(0, max).join(", ")} +${symbols.length - max}` : symbols.join(", ");
}

interface GlanceStripProps {
  /** The period's events before the group filters; null while loading. */
  items: readonly AgendaItem[] | null;
  /** Value of all positions in the base currency, for the share reporting. */
  portfolioValue: number | null;
  rangeLabel: string;
  /** Name macro days by weekday (one week) or by date (four weeks). */
  dayStyle?: "weekday" | "date";
  className?: string;
}

/** Four figures for the period above the agenda: holdings and watchlist names reporting, dividend cash, macro releases. */
export function GlanceStrip({ items, portfolioValue, rangeLabel, dayStyle = "weekday", className }: GlanceStripProps) {
  const { t, lang } = usePrefs();
  const g = t.calendar.glance;
  const figures = items ? glance(items) : null;
  const share = figures?.reportingValue && portfolioValue ? figures.reportingValue.value / portfolioValue : null;
  return (
    <div role="group" aria-label={`${g.title}: ${rangeLabel}`} className={className}>
      {figures ? (
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          <StatTile
            label={g.reporting}
            value={figures.reporting.length}
            sub={figures.reporting.length > 0 ? [money(figures.reportingValue, lang), share !== null ? tpl(g.ofPortfolio, { pct: formatRatio(share, { digits: 0 }) }) : null].filter(Boolean).join(" · ") : g.none}
          />
          <StatTile label={g.watchReporting} value={figures.watchReporting.length} sub={figures.watchReporting.length > 0 ? tickers(figures.watchReporting) : g.none} />
          <StatTile
            label={g.dividendCash}
            value={figures.dividendCash ? tpl(t.calendar.cash, { amount: money(figures.dividendCash, lang, true) }) : "—"}
            sub={figures.exDividend.length > 0 ? tickers(figures.exDividend) : g.none}
          />
          <StatTile
            label={g.macro}
            value={figures.macro.length}
            sub={
              figures.macro.length > 0
                ? figures.macro
                    .slice(0, 3)
                    .flatMap((m) => (m.event.macro ? [`${t.calendar.macroCode[m.event.macro]} ${(dayStyle === "date" ? nyShortDate : nyWeekday)(Date.parse(m.event.at), lang)}`] : []))
                    .join(" · ")
                : g.none
            }
          />
        </div>
      ) : (
        <div className="bg-panel">
          <SkeletonRows rows={2} />
        </div>
      )}
    </div>
  );
}

/** The next macro releases on file, from lib/macro-calendar.ts (no request needed). */
export function MacroPanel({ now }: { now: number | null }) {
  const { t, lang } = usePrefs();
  const c = t.calendar;
  const upcoming = now === null ? [] : MACRO_EVENTS.filter((event) => Date.parse(event.at) >= now).slice(0, 6);
  return (
    <Panel title={c.macroPanel.title}>
      {now === null ? (
        <SkeletonRows rows={4} />
      ) : upcoming.length === 0 ? (
        <p className="px-3 py-3 text-sm text-fg-2">{c.macroPanel.empty}</p>
      ) : (
        <ul>
          {upcoming.map((event) => {
            const at = Date.parse(event.at);
            const name = c.macro[event.key];
            const detail = event.key === "fomc" ? (event.projections ? c.projections : null) : event.period ? tpl(c.forMonth, { month: periodMonthName(event.period, lang) }) : null;
            return (
              <li key={`${event.key}:${event.at}`} className="flex items-center gap-3 border-b border-line/70 px-3 py-1.5 text-data last:border-b-0">
                <span className="w-24 shrink-0">
                  <span className="block text-fg">{weekdayDay(new Date(at).toISOString(), lang)}</span>
                  <span className="num block text-micro text-fg-3">{tpl(c.timeEt, { time: nyClock(at) })}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fg-2">{name}</span>
                  {detail || event.tentative ? (
                    <span className="flex items-center gap-1.5 text-micro text-fg-3">
                      {detail}
                      {event.tentative ? <Badge>{c.tentative}</Badge> : null}
                    </span>
                  ) : null}
                </span>
                <SourceLink href={MACRO_SOURCES[event.key]} name={name} />
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line px-3 py-2 text-micro text-fg-3">{tpl(c.notes.macroEnds, { date: formatDate(MACRO_CALENDAR_ENDS, lang, "America/New_York") })}</p>
    </Panel>
  );
}

/** How to read the agenda: time zones, estimates, implied moves and the surprise marks. */
export function ReadingNotes() {
  const { t } = usePrefs();
  const n = t.calendar.notes;
  const notes = [n.est, n.move, n.surprises, n.source];
  return (
    <Panel title={n.title}>
      <ul className="space-y-1.5 px-3 py-2.5 text-xs leading-5 text-fg-2">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </Panel>
  );
}
