"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { buildAgenda, formatWeekSummary, nyDayKey, pickTopItems, rangeWindow, relativeDay, summarizeWeek, type AgendaItem, type EventFilter } from "@/lib/events";
import { tpl } from "@/lib/format";

import { dayShort, formatMoney, macroDetail, timeLabel } from "./agenda-format";
import { useAgendaData } from "./use-agenda";
import { useClock } from "./use-clock";

// This week's events for the investor's holdings, watchlist and the macro calendar, on the overview. A compact list
// (at most eight rows, holdings first) with a link to the full calendar.

const MAX_ROWS = 8;
/** "This week" reaches at most eight days ahead (on a Saturday it covers the coming week). */
const FETCH_DAYS = 10;
const GROUPS: ReadonlySet<EventFilter> = new Set<EventFilter>(["holdings", "watchlist", "macro"]);

export function WeekAheadPanel({ className }: { className?: string }) {
  const { t, lang } = usePrefs();
  const c = t.calendar;
  const now = useClock();
  const { feed, input, hydrated } = useAgendaData(FETCH_DAYS, false);
  const span = useMemo(() => (now === null ? null : rangeWindow("week", now)), [now]);
  const agenda = useMemo(() => (feed.data && span ? buildAgenda(feed.data.events, input, span, GROUPS) : null), [feed.data, span, input]);
  const shown = useMemo(() => (agenda ? pickTopItems(agenda.days.flatMap((day) => day.items), MAX_ROWS) : null), [agenda]);
  const today = now === null ? null : nyDayKey(now);

  let body;
  if (!hydrated || today === null || (!feed.data && !feed.error)) body = <SkeletonRows rows={4} />;
  else if (feed.error && !feed.data) body = <ErrorState error={feed.error} onRetry={() => feed.mutate()} compact />;
  else if (!shown || shown.items.length === 0) body = <EmptyState>{c.overview.empty}</EmptyState>;
  else
    body = (
      <ul>
        {shown.items.map((item) => (
          <WeekRow key={item.event.id} item={item} today={today} />
        ))}
      </ul>
    );

  return (
    <Panel
      code="EVTS"
      title={c.weekAhead}
      className={className}
      footer={
        <Link
          href="/calendar"
          className="flex h-9 items-center justify-between gap-3 border-t border-line px-3 text-xs text-fg-2 transition-colors hover:bg-hover hover:text-fg max-sm:h-10"
        >
          <span>{shown && shown.hidden > 0 ? tpl(c.overview.more, { n: shown.hidden }) : c.overview.open}</span>
          <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.75} />
        </Link>
      }
    >
      {agenda && agenda.items.length > 0 ? <p className="border-b border-line px-3 py-2 text-xs text-fg-2">{formatWeekSummary(summarizeWeek(agenda.items), c.summary, lang)}</p> : null}
      {body}
    </Panel>
  );
}

function WeekRow({ item, today }: { item: AgendaItem; today: string }) {
  const { t, lang } = usePrefs();
  const c = t.calendar;
  const { event } = item;
  const relative = relativeDay(item.day, today);
  const dayText = relative.kind === "today" ? c.days.today : relative.kind === "tomorrow" ? c.days.tomorrow : dayShort(item.day, lang);
  // The time column already says "Ex-date" or the session slot, so the name stands alone; the title has the rest.
  const name = event.kind === "macro" && event.macro ? c.macro[event.macro] : (event.name ?? event.symbol ?? "");
  const title =
    event.kind === "macro" && event.macro
      ? [c.macro[event.macro], macroDetail(item, c, lang)].filter(Boolean).join(" ")
      : `${name} · ${event.kind === "dividend" ? c.dividendNoAmount : c.earnings}`;
  const value =
    event.kind === "dividend" && item.dividendCash !== null
      ? tpl(c.cash, { amount: formatMoney(item.dividendCash, item.currency, lang, true) })
      : event.kind === "earnings" && item.positionValue !== null
        ? formatMoney(item.positionValue, item.currency, lang)
        : null;
  return (
    <li className={cn("relative grid h-row grid-cols-[3.75rem_6.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 border-b border-line/70 px-3 text-data last:border-b-0 max-sm:h-11", event.symbol && "hover:bg-hover")}>
      <span className="truncate text-fg-2">{dayText}</span>
      <span className="truncate text-fg-3">{timeLabel(item, c)}</span>
      <span className="flex min-w-0 items-center gap-2">
        {event.symbol ? (
          <Link href={stockPath(event.symbol)} className="mono shrink-0 font-medium text-fg after:absolute after:inset-0 after:content-[''] hover:text-accent focus-visible:outline-offset-[-2px]">
            {event.symbol}
          </Link>
        ) : event.macro ? (
          <span className="mono shrink-0 font-medium text-fg">{c.macroCode[event.macro]}</span>
        ) : null}
        <span className="min-w-0 truncate text-fg-2" title={title}>
          {name}
        </span>
        {event.estimated ? (
          <span className="relative shrink-0" title={event.kind === "macro" ? c.tentativeTitle : c.estTitle}>
            <Badge>{event.kind === "macro" ? c.tentative : c.est}</Badge>
          </span>
        ) : null}
      </span>
      <span className="num text-right text-fg">
        {value ? (
          event.kind === "earnings" ? (
            <TickNumber key={item.valueAtCost ? "cost" : "market"} value={item.positionValue}>
              {value}
            </TickNumber>
          ) : (
            value
          )
        ) : null}
      </span>
    </li>
  );
}
