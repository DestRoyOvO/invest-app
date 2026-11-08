"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { useSeen } from "@/hooks/useCalendarApi";
import { useEarnings, useImpliedMove } from "@/hooks/useEarningsApi";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { AgendaDay, AgendaItem } from "@/lib/events";
import { formatRatio, tpl } from "@/lib/format";
import { MACRO_SOURCES } from "@/lib/macro-calendar";

import { dayHeading, formatDividend, formatMoney, localLabel, macroDetail, markGlyph, marksLabel, relativeLabel, timeLabel } from "./agenda-format";
import { hasUsOptions, lastSurprises, shortDay, signedPercent, withinDays } from "./earnings-model";

// The day-grouped agenda of the events calendar. One DOM serves both layouts: on phones each event is a two-line card
// (time and money on top, the name and the report context below); from sm up the same cells line up in columns.

/** Implied moves are requested for holdings and watchlist names reporting within this many days. */
export const IMPLIED_MOVE_DAYS = 14;

const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2 sm:gap-x-2.5 [grid-template-areas:'time_position'_'main_extra'] sm:h-row sm:items-center sm:gap-y-0 sm:py-0";
const GRID = "sm:grid-cols-[6.25rem_4.5rem_minmax(0,1fr)_5.5rem_5rem_4.75rem] sm:[grid-template-areas:'time_symbol_event_position_move_marks']";
const GRID_LOCAL =
  "sm:grid-cols-[6.25rem_5.75rem_4.5rem_minmax(0,1fr)_5.5rem_5rem_4.75rem] sm:[grid-template-areas:'time_local_symbol_event_position_move_marks']";

interface AgendaListProps {
  days: readonly AgendaDay[];
  /** Today's New York date, for the relative day labels. */
  today: string;
  /** The viewer's time zone when it differs from New York: adds the "Your time" column. */
  zone: string | null;
  now: number;
}

export function AgendaList({ days, today, zone, now }: AgendaListProps) {
  const { t } = usePrefs();
  const c = t.calendar;
  const grid = zone ? GRID_LOCAL : GRID;
  return (
    <div>
      <div aria-hidden className={cn("hidden h-8 items-center gap-x-2.5 border-b border-line px-3 sm:grid", grid)}>
        <span className="col-head truncate [grid-area:time]">{c.columns.time}</span>
        {zone ? <span className="col-head truncate [grid-area:local]">{c.columns.local}</span> : null}
        <span className="col-head truncate [grid-area:symbol]">{c.columns.symbol}</span>
        <span className="col-head truncate [grid-area:event]">{c.columns.event}</span>
        <span className="col-head truncate text-right [grid-area:position]">{c.columns.position}</span>
        <span className="col-head truncate text-right [grid-area:move]">{c.columns.move}</span>
        <span className="col-head truncate text-right [grid-area:marks]">{c.columns.surprises}</span>
      </div>
      <div>
        {days.map((day) => (
          <AgendaDayGroup key={day.day} day={day} today={today} zone={zone} now={now} grid={grid} />
        ))}
      </div>
    </div>
  );
}

function AgendaDayGroup({ day, today, zone, now, grid }: { day: AgendaDay; today: string; zone: string | null; now: number; grid: string }) {
  const { t, lang } = usePrefs();
  const relative = relativeLabel(day.day, today, t.calendar);
  return (
    <div className="border-t border-line first:border-t-0">
      <h3 className="flex h-8 items-center justify-between gap-3 border-b border-line bg-panel-2 px-3">
        <span className="text-xs font-semibold text-fg">{dayHeading(day.day, lang)}</span>
        {relative ? <span className="text-micro text-fg-3">{relative}</span> : null}
      </h3>
      <ul>
        {day.items.map((item) => (
          <AgendaRow key={item.event.id} item={item} zone={zone} now={now} grid={grid} />
        ))}
      </ul>
    </div>
  );
}

function AgendaRow({ item, zone, now, grid }: { item: AgendaItem; zone: string | null; now: number; grid: string }) {
  const { t } = usePrefs();
  const c = t.calendar;
  const { event } = item;
  const local = localLabel(item, zone, c);
  const symbol = event.symbol;
  const wantsMove = event.kind === "earnings" && symbol !== null && hasUsOptions(symbol) && (item.shares !== null || item.filters.includes("watchlist")) && withinDays(event.at, now, IMPLIED_MOVE_DAYS);
  const wantsMarks = event.kind === "earnings" && symbol !== null;
  const [ref, seen] = useSeen<HTMLLIElement>();

  return (
    <li ref={ref} className={cn("relative border-b border-line/70 last:border-b-0", symbol && "hover:bg-hover", ROW, grid)}>
      <span className="min-w-0 truncate text-data text-fg-2 [grid-area:time]">
        {timeLabel(item, c)}
        {local ? (
          <span className="num text-fg-3 sm:hidden">
            {" · "}
            <span className="sr-only">{c.columns.local}: </span>
            {local}
          </span>
        ) : null}
      </span>
      {zone ? (
        <span className="num hidden truncate text-data text-fg-3 sm:block sm:[grid-area:local]">
          {local ? <span className="sr-only">{c.columns.local}: </span> : null}
          {local}
        </span>
      ) : null}

      <span className="flex min-w-0 items-center gap-2 [grid-area:main] sm:contents">
        <span className="shrink-0 sm:[grid-area:symbol]">
          {symbol ? (
            <Link
              href={stockPath(symbol)}
              className="mono text-data font-medium text-fg after:absolute after:inset-0 after:content-[''] hover:text-accent focus-visible:outline-offset-[-2px]"
            >
              {symbol}
            </Link>
          ) : event.macro ? (
            <span className="mono text-data font-medium text-fg">{c.macroCode[event.macro]}</span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-data sm:[grid-area:event]">
          <EventText item={item} />
        </span>
      </span>

      <span className="num truncate text-right text-data text-fg [grid-area:position]">
        <PositionText item={item} />
      </span>

      <span className="flex items-center justify-end gap-3 [grid-area:extra] sm:contents">
        <span className="num relative text-right text-data sm:[grid-area:move]">{wantsMove ? <MoveText symbol={symbol} enabled={seen} /> : null}</span>
        <span className="relative flex justify-end sm:[grid-area:marks]">{wantsMarks ? <SurpriseMarks symbol={symbol} enabled={seen} /> : null}</span>
      </span>
    </li>
  );
}

/**
 * "Source" link to a macro schedule, at least 24px tall (40px on phones). Its accessible name starts with the visible
 * word and adds the schedule in hidden text, so voice control can use what is on screen (WCAG 2.5.3).
 */
export function SourceLink({ href, name, className }: { href: string; name: string; className?: string }) {
  const { t } = usePrefs();
  const c = t.calendar;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex min-h-6 shrink-0 items-center gap-0.5 px-1 text-xs text-fg-3 hover:text-accent max-sm:min-h-10 max-sm:min-w-10 max-sm:justify-center", className)}
    >
      <span>
        {c.source}
        <span className="sr-only"> {tpl(c.sourceFor, { name })}</span>
      </span>
      <ExternalLink aria-hidden className="size-3" strokeWidth={1.75} />
    </a>
  );
}

function EventText({ item }: { item: AgendaItem }) {
  const { t, lang } = usePrefs();
  const c = t.calendar;
  const { event } = item;
  if (event.kind === "macro" && event.macro) {
    const detail = macroDetail(item, c, lang);
    const name = c.macro[event.macro];
    return (
      <>
        <span className="min-w-0 truncate text-fg-2">
          {name}
          {detail ? <span className="text-fg-3"> {detail}</span> : null}
        </span>
        {event.estimated ? (
          <span className="relative shrink-0" title={c.tentativeTitle}>
            <Badge>{c.tentative}</Badge>
          </span>
        ) : null}
        <SourceLink href={MACRO_SOURCES[event.macro]} name={name} className="relative" />
      </>
    );
  }
  const kindText = event.kind === "dividend" ? (event.amount !== null ? tpl(c.dividend, { amount: formatDividend(event.amount, lang) }) : c.dividendNoAmount) : c.earnings;
  // The company name gives way first, so the dividend amount stays readable on narrow rows.
  return (
    <>
      <span className="min-w-0 truncate text-fg-2" title={event.name ?? undefined}>
        {event.name ?? event.symbol}
      </span>
      <span className="-ml-1 shrink-0 whitespace-nowrap text-fg-3">· {kindText}</span>
      {event.kind === "earnings" && event.estimated ? (
        <span className="relative shrink-0" title={c.estTitle}>
          <Badge>{c.est}</Badge>
        </span>
      ) : null}
    </>
  );
}

function PositionText({ item }: { item: AgendaItem }) {
  const { t, lang } = usePrefs();
  const c = t.calendar;
  if (item.event.kind === "dividend" && item.dividendCash !== null) {
    const amount = formatMoney(item.dividendCash, item.currency, lang, true);
    const label = tpl(c.cashLabel, { amount, shares: item.shares ?? 0 });
    return (
      <span title={label}>
        <span className="sr-only">{label}</span>
        <span aria-hidden>{tpl(c.cash, { amount })}</span>
      </span>
    );
  }
  if (item.event.kind === "earnings" && item.positionValue !== null) {
    const value = formatMoney(item.positionValue, item.currency, lang);
    const label = `${tpl(c.valueLabel, { value })}${item.valueAtCost ? ` (${c.atCost})` : ""}`;
    return (
      <span title={label}>
        <span className="sr-only">{label}</span>
        {/* Remounts when the quote arrives, so switching from cost to market value is not flashed as a price move. */}
        <TickNumber key={item.valueAtCost ? "cost" : "market"} value={item.positionValue} className={cn(item.valueAtCost && "text-fg-2")}>
          <span aria-hidden>
            {value}
            {item.valueAtCost ? "*" : ""}
          </span>
        </TickNumber>
      </span>
    );
  }
  return null;
}

/** The implied move of a row, requested once the row scrolls near the viewport. */
function MoveText({ symbol, enabled }: { symbol: string; enabled: boolean }) {
  const { t, lang } = usePrefs();
  const { data, error } = useImpliedMove(enabled ? symbol : null);
  if (data) {
    const pct = formatRatio(data.move, { digits: 1 });
    const label = tpl(t.calendar.moveLabel, { pct, date: shortDay(data.expiry, lang) });
    return (
      <span title={label} className="text-fg">
        <span className="sr-only">{label}</span>
        <span aria-hidden>{tpl(t.calendar.move, { pct })}</span>
      </span>
    );
  }
  if (error) return <span className="text-fg-3">—</span>;
  if (!enabled) return null;
  return (
    <span role="status" aria-label={t.calendar.loadingMove} className="inline-flex justify-end">
      <Skeleton className="h-3 w-10" />
    </span>
  );
}

/** The last four reports as neutral +, − and = marks, oldest first. */
function SurpriseMarks({ symbol, enabled }: { symbol: string; enabled: boolean }) {
  const { t } = usePrefs();
  const { data, error } = useEarnings(enabled ? symbol : null);
  if (data) {
    const entries = lastSurprises(data.history, 4);
    if (entries.length === 0) return <span className="text-fg-3">—</span>;
    return (
      <span role="img" aria-label={marksLabel(entries, t.calendar)} title={entries.map((e) => `${e.period} ${signedPercent(e.surprise)}`).join(" · ")} className="inline-flex gap-0.5">
        {entries.map((entry) => (
          <span key={entry.period} aria-hidden className="mono inline-flex size-4 items-center justify-center rounded-xs border border-line-2 text-[0.625rem] leading-none text-fg-2">
            {markGlyph(entry)}
          </span>
        ))}
      </span>
    );
  }
  if (error) return <span className="text-fg-3">—</span>;
  if (!enabled) return null;
  return (
    <span role="status" aria-label={t.calendar.loadingSurprises} className="inline-flex">
      <Skeleton className="h-3 w-16" />
    </span>
  );
}
