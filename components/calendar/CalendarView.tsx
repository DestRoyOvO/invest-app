"use client";

import { AlertTriangle } from "lucide-react";
import { useCallback, useMemo } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Button } from "@/components/ui/Button";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useLocalStore } from "@/hooks/useLocalStore";
import {
  AGENDA_FETCH_DAYS,
  buildAgenda,
  formatWeekSummary,
  macroListEnding,
  NEW_YORK,
  nyDayKey,
  rangeWindow,
  summarizeWeek,
  type AgendaRange,
  type EventFilter,
} from "@/lib/events";
import { formatDate, formatTime, tpl } from "@/lib/format";
import { DEFAULT_CURRENCY, pickBaseCurrency } from "@/lib/portfolio";

import { AgendaList } from "./AgendaList";
import { GlanceStrip, MacroPanel, ReadingNotes } from "./CalendarSide";
import { calendarPrefsStore } from "./calendar-prefs";
import { FilterChips } from "./FilterChips";
import { useAgendaData } from "./use-agenda";
import { useClock, useViewerZone } from "./use-clock";

/** The events calendar (EVTS): what is scheduled for the investor's names and the macro calendar, by day. */
export function CalendarView() {
  const { t, lang } = usePrefs();
  const c = t.calendar;
  const { openCommand } = useUi();
  const now = useClock();
  const zone = useViewerZone();
  const prefs = useLocalStore(calendarPrefsStore);
  const { feed, input, hydrated, held, watchlist, quotes } = useAgendaData(AGENDA_FETCH_DAYS, true);
  const active = useMemo(() => new Set<EventFilter>(prefs.filters), [prefs.filters]);

  const span = useMemo(() => (now === null ? null : rangeWindow(prefs.range, now)), [now, prefs.range]);
  const agenda = useMemo(() => (feed.data && span ? buildAgenda(feed.data.events, input, span, active) : null), [feed.data, span, input, active]);
  const today = now === null ? null : nyDayKey(now);

  const setRange = useCallback((range: AgendaRange) => calendarPrefsStore.update((current) => ({ ...current, range })), []);
  const toggle = useCallback(
    (filter: EventFilter) =>
      calendarPrefsStore.update((current) => ({
        ...current,
        filters: current.filters.includes(filter) ? current.filters.filter((f) => f !== filter) : [...current.filters, filter],
      })),
    [],
  );
  const enable = useCallback((filters: readonly EventFilter[]) => calendarPrefsStore.update((current) => ({ ...current, filters: [...new Set([...current.filters, ...filters])] })), []);

  // Value of every position in the base currency, for the share of the portfolio that reports.
  const portfolioValue = useMemo(() => {
    const priced = (quotes ?? []).filter((q) => q.price !== null && q.price > 0 && input.holdings[q.symbol]);
    if (priced.length === 0) return null;
    const base = pickBaseCurrency(priced.map((q) => q.currency ?? DEFAULT_CURRENCY));
    return priced.filter((q) => (q.currency ?? DEFAULT_CURRENCY) === base).reduce((sum, q) => sum + input.holdings[q.symbol].shares * (q.price ?? 0), 0);
  }, [quotes, input.holdings]);

  const rangeOptions = [
    { value: "week" as const, label: c.range.week },
    { value: "next" as const, label: c.range.next },
    { value: "month" as const, label: c.range.month },
  ];
  const rangeLabel = rangeOptions.find((o) => o.value === prefs.range)?.label ?? "";
  const summary = agenda ? formatWeekSummary(summarizeWeek(agenda.items), c.summary, lang) : null;
  const macroEnding = feed.data && span && now !== null ? macroListEnding(feed.data.macroCalendarEnds, span, now) : false;
  const noNames = held.length === 0 && watchlist.length === 0;

  let body;
  if (!hydrated || now === null || today === null || (!feed.data && !feed.error)) {
    body = <SkeletonRows rows={8} />;
  } else if (feed.error && !feed.data) {
    body = <ErrorState error={feed.error} onRetry={() => feed.mutate()} />;
  } else if (active.size === 0) {
    body = (
      <EmptyState actions={<Button size="sm" onClick={() => enable(["holdings", "watchlist", "universe", "macro"])}>{c.empty.showAll}</Button>}>{c.empty.noFilters}</EmptyState>
    );
  } else if (!agenda || agenda.shown === 0) {
    const showTop = !active.has("universe");
    body = noNames ? (
      <EmptyState
        actions={
          <>
            <Button size="sm" variant="primary" onClick={openCommand}>
              {c.empty.addTickers}
            </Button>
            {showTop ? (
              <Button size="sm" onClick={() => enable(["universe"])}>
                {c.empty.showTop}
              </Button>
            ) : null}
          </>
        }
      >
        {c.empty.noNames}
      </EmptyState>
    ) : (
      <EmptyState
        actions={
          <>
            {prefs.range === "week" ? (
              <Button size="sm" onClick={() => setRange("next")}>
                {c.empty.nextWeek}
              </Button>
            ) : null}
            {showTop ? (
              <Button size="sm" onClick={() => enable(["universe"])}>
                {c.empty.showTop}
              </Button>
            ) : null}
          </>
        }
      >
        {c.empty.nothing}
      </EmptyState>
    );
  } else {
    body = (
      <>
        {noNames ? (
          <EmptyState
            className="border-b border-line"
            actions={
              <>
                <Button size="sm" onClick={openCommand}>
                  {c.empty.addTickers}
                </Button>
                {active.has("universe") ? null : (
                  <Button size="sm" onClick={() => enable(["universe"])}>
                    {c.empty.showTop}
                  </Button>
                )}
              </>
            }
          >
            {c.empty.noNames}
          </EmptyState>
        ) : null}
        <AgendaList days={agenda.days} today={today} zone={zone} now={now} />
      </>
    );
  }

  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <h1 className="sr-only">{c.title}</h1>
      <GlanceStrip items={agenda?.items ?? null} portfolioValue={portfolioValue} rangeLabel={rangeLabel} className="xl:col-span-2" />
      <div className="flex min-w-0 flex-col gap-px">
        <Panel
          code="EVTS"
          title={c.title}
          actions={feed.data ? <PanelMeta>{tpl(t.common.asOf, { time: tpl(c.timeEt, { time: formatTime(feed.data.asOf, lang, NEW_YORK) }) })}</PanelMeta> : null}
          footer={
            <p className="border-t border-line px-3 py-2 text-micro text-fg-3">
              {c.notes.times}
              {zone ? ` ${tpl(c.notes.local, { zone })}` : ""}
            </p>
          }
        >
          <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
            <Segmented label={c.range.label} hideLabel size="sm" value={prefs.range} options={rangeOptions} onChange={setRange} className="w-full lg:w-80" />
            <FilterChips counts={agenda?.counts ?? null} active={active} onToggle={toggle} />
          </div>
          {summary ? <p className="border-b border-line px-3 py-2 text-sm text-fg-2">{summary}</p> : null}
          <StaleBanner show={Boolean(feed.error && feed.data)} since={feed.data?.asOf} />
          {macroEnding && feed.data ? (
            <p role="status" className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-1.5 text-xs text-warn">
              <AlertTriangle aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
              {tpl(c.notes.macroEnds, { date: formatDate(feed.data.macroCalendarEnds, lang, "America/New_York") })}
            </p>
          ) : null}
          {body}
        </Panel>
        <ColumnEnd />
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <MacroPanel now={now} />
        <ReadingNotes />
        <ColumnEnd />
      </div>
    </div>
  );
}

/** Fills the rest of a column with the page canvas, so a short column ends in a hairline instead of a slab of rule color. */
function ColumnEnd() {
  return <div aria-hidden className="min-h-0 flex-1 bg-canvas" />;
}
