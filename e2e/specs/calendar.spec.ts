import { tpl } from "@/lib/format";
import { MESSAGES } from "@/lib/i18n/messages";
import { MACRO_EVENTS } from "@/lib/macro-calendar";
import { DEFAULT_WATCHLIST, UNIVERSE_STOCKS } from "@/lib/universe";
import type { CalendarResponse, QuotesResponse } from "@/types/api";
import type { DividendHistory } from "@/types/research";

import { AT_DEFAULT_NOW, PINNED_NOW } from "../support/env";
import {
  calendarSymbols,
  cashAmount,
  cashText,
  chipName,
  dayHeadingName,
  dayName,
  EVENT_GROUPS,
  etTime,
  eventGroups,
  expectAgenda,
  getJson,
  groupCounts,
  macroText,
  newYorkDay,
  panel,
  PERIOD_LABELS,
  periodDays,
  periodEvents,
  previousWeekday,
  quoteMap,
  readAgenda,
  readRows,
  rowsOf,
  shownEvents,
  stored,
  weekAheadProblems,
  weekdayName,
  weekdaysAfter,
  weekSummary,
  type CalendarLists,
  type EventGroup,
} from "../support/research";
import { expect, test, type Page } from "../support/test";

// The events calendar (EVTS) and the week ahead on the overview, against the fixture data on the pinned clock: the
// default watchlist's reports and AAPL's ex-dividend date fall on the sessions the fixture schedules them on, a
// position shows its money at stake (the dividend cash, shares times the dividend per share; the market value of a
// position that reports), the macro releases of each period come from the committed schedule, the group chips show
// what they say and stay as the investor left them, and the week ahead lists the same week as the agenda, in the same
// order.
//
// Expected rows come from the feed the page reads (/api/calendar) and the quotes of the positions (/api/quotes), with
// the period, group and order rules written out in e2e/support/research.ts.

const CAL = MESSAGES.en.calendar;

/** The default watchlist with two of its names held: the calendar of a returning investor. */
const LISTS: CalendarLists = {
  watchlist: [...DEFAULT_WATCHLIST],
  holdings: { AAPL: { shares: 10, cost: 150 }, MSFT: { shares: 5, cost: 300 } },
  universe: UNIVERSE_STOCKS,
};

/** The groups shown before the investor changes anything: holdings, watchlist and macro; Top 78 is off. */
const DEFAULT_GROUPS: readonly EventGroup[] = ["holdings", "watchlist", "macro"];

const CALENDAR_PREFS_KEY = "investseek:calendar:v1";

type Request = Parameters<typeof getJson>[0];

/** The feed a page reads: the calendar asks for 31 days with the universe, the overview's week ahead for 10 without. */
function feedPath(lists: CalendarLists, page: "calendar" | "overview"): string {
  const symbols = calendarSymbols(lists).join(",");
  return `/api/calendar?${page === "calendar" ? `days=31&symbols=${symbols}&scope=universe` : `days=10&symbols=${symbols}`}`;
}

/** The feed a page reads and the quotes of the positions. */
async function calendarData(request: Request, lists: CalendarLists, page: "calendar" | "overview") {
  const feed = await getJson<CalendarResponse>(request, feedPath(lists, page));
  const quotes = quoteMap((await getJson<QuotesResponse>(request, `/api/quotes?symbols=${Object.keys(lists.holdings).join(",")}`)).quotes);
  return { feed, quotes };
}

/** Today in New York on the browser's clock (the suite sets it to the server's). */
async function browserToday(page: Page): Promise<string> {
  return newYorkDay(await page.evaluate(() => Date.now()));
}

/**
 * A Top 78 stock to hold beside LISTS, so the Holdings chip has an event of its own: the first, alphabetically, that is
 * neither held nor watched and has an event this week (on the server's clock, which the browser's starts from). The
 * calendar asks for the implied move of a held stock that reports within two weeks, so a stock that reports must have
 * one. Undefined when no stock qualifies.
 */
async function extraHolding(request: Request): Promise<string | undefined> {
  const today = newYorkDay(Date.parse((await getJson<{ time: string }>(request, "/api/health")).time));
  const feed = await getJson<CalendarResponse>(request, feedPath(LISTS, "calendar"));
  const week = periodEvents(feed, LISTS, "week", today);
  const candidates = [...new Set(week.filter((event) => eventGroups(event, LISTS).join() === "universe").map((event) => event.symbol!))].sort();
  for (const symbol of candidates) {
    const reports = feed.events.some((event) => event.kind === "earnings" && event.symbol === symbol);
    if (!reports || (await request.get(`/api/stock/${encodeURIComponent(symbol)}/implied-move`)).ok()) return symbol;
  }
  return undefined;
}

test.describe("events calendar", () => {
  test.skip(PINNED_NOW === null, "Written for a pinned clock: on the real clock the schedule moves while the test runs.");

  test("shows the watchlist's reports and AAPL's ex-dividend cash on the sessions the fixture schedules", async ({ page, app, request }) => {
    test.skip(!AT_DEFAULT_NOW, "The fixed dates count sessions from the default E2E_NOW, a Saturday with no holiday in the two weeks ahead.");
    await app.seedStorage(LISTS);
    await app.goto("/calendar");
    const today = await browserToday(page);
    expect(weekdayName(today), "the pinned day").toBe("Sat");
    const { feed, quotes } = await calendarData(request, LISTS, "calendar");
    const context = { today, lists: LISTS, quotes };

    // docs/testing.md, "Upcoming events": counted in sessions after the latest completed one, Friday's.
    const latest = previousWeekday(today);
    const thisWeek = [`earnings:NVDA:${weekdaysAfter(latest, 2)}`, `dividend:AAPL:${weekdaysAfter(latest, 3)}`, `earnings:MSFT:${weekdaysAfter(latest, 4)}`];
    const nextWeek = [`earnings:AAPL:${weekdaysAfter(latest, 6)}`, `earnings:GOOGL:${weekdaysAfter(latest, 8)}`, `earnings:AMZN:${weekdaysAfter(latest, 9)}`];

    const agenda = panel(page, CAL.title);
    const period = agenda.getByRole("radiogroup", { name: CAL.range.label });
    await expect(period.getByRole("radio", { name: PERIOD_LABELS.week })).toBeChecked();

    // This week runs from today, a Saturday, through the coming Sunday: Tuesday is "In 3 days", and with nothing on
    // the weekend no day is Today or Tomorrow.
    const week = shownEvents(periodEvents(feed, LISTS, "week", today), LISTS, DEFAULT_GROUPS);
    expect(week.map((event) => event.id)).toEqual(expect.arrayContaining(thisWeek));
    await expectAgenda(agenda, week, context);
    await expect(agenda.getByRole("heading", { level: 3, name: `${dayName(weekdaysAfter(latest, 2))} ${tpl(CAL.days.inDays, { n: 3 })}`, exact: true })).toBeVisible();
    await expect(agenda.getByRole("heading", { level: 3, name: new RegExp(`${CAL.days.today}|${CAL.days.tomorrow}`) })).toHaveCount(0);
    await expect(agenda.getByText(weekSummary(periodEvents(feed, LISTS, "week", today), LISTS), { exact: true })).toBeVisible();

    // AAPL goes ex-dividend in 3 sessions: ten shares receive ten times the dividend per share of the dividends API.
    const dividends = await getJson<DividendHistory>(request, "/api/stock/AAPL/dividends");
    const exDay = weekdaysAfter(latest, 3);
    expect(dividends.next?.exDate).toBe(exDay);
    const aapl = week.find((event) => event.id === `dividend:AAPL:${exDay}`)!;
    const exDayRows = async () => (await readAgenda(agenda)).find((group) => group.heading === dayHeadingName(exDay, today))?.rows ?? [];
    await expect.poll(async () => rowsOf(await exDayRows(), aapl).map((row) => row.text.includes(cashText(10, dividends.next?.amount ?? NaN, dividends.currency)))).toEqual([true]);
    // The At a glance tile adds up the cash of every position that goes ex this week.
    const exDividend = week.filter((event) => event.kind === "dividend" && event.symbol !== null && Object.hasOwn(LISTS.holdings, event.symbol));
    expect(exDividend).toContain(aapl);
    const cash = exDividend.reduce((sum, event) => sum + LISTS.holdings[event.symbol!].shares * (event.amount ?? 0), 0);
    await expect(page.getByRole("group", { name: `${CAL.glance.title}: ${PERIOD_LABELS.week}` })).toContainText(tpl(CAL.cash, { amount: cashAmount(cash, "USD") }));

    // Next week: AAPL reports in 6 sessions, GOOGL in 8 and AMZN in 9. A week or more ahead, a day goes by its date.
    await period.getByRole("radio", { name: PERIOD_LABELS.next }).click();
    const next = shownEvents(periodEvents(feed, LISTS, "next", today), LISTS, DEFAULT_GROUPS);
    expect(next.map((event) => event.id)).toEqual(expect.arrayContaining(nextWeek));
    await expectAgenda(agenda, next, context);
    await expect(page.getByRole("group", { name: `${CAL.glance.title}: ${PERIOD_LABELS.next}` })).toBeVisible();

    // Four weeks: the macro releases of the committed schedule that fall in them, at their ET times, among the rest.
    await period.getByRole("radio", { name: PERIOD_LABELS.month }).click();
    const month = shownEvents(periodEvents(feed, LISTS, "month", today), LISTS, DEFAULT_GROUPS);
    const { from, to } = periodDays("month", today);
    const releases = MACRO_EVENTS.filter((event) => {
      const day = newYorkDay(Date.parse(event.at));
      return day >= from && day <= to;
    });
    expect(releases.length).toBeGreaterThan(0);
    expect(month.filter((event) => event.kind === "macro").map((event) => `${event.macro}:${event.at}`)).toEqual(releases.map((event) => `${event.key}:${new Date(event.at).toISOString()}`));
    await expectAgenda(agenda, month, context);
  });

  test("lists the next macro releases on file beside the agenda", async ({ page, app }) => {
    test.skip(app.isPhone, "The same panel on both layouts: one project is enough.");
    await app.goto("/calendar");
    const now = await page.evaluate(() => Date.now());
    // FOMC, CPI and jobs releases from lib/macro-calendar.ts: the next six, each with its day, ET time and subject.
    const upcoming = MACRO_EVENTS.filter((event) => Date.parse(event.at) >= now).slice(0, 6);
    expect(new Set(upcoming.map((event) => event.key))).toEqual(new Set(["fomc", "cpi", "jobs"]));
    const expected = upcoming.map((event) => {
      const at = Date.parse(event.at);
      return `${dayName(newYorkDay(at))} ${etTime(at)} ${macroText(event.key, event.period, event.projections === true)}`;
    });
    const releases = panel(page, CAL.macroPanel.title);
    await expect.poll(async () => (await readRows(releases)).map((row, index) => row.text.slice(0, expected[index]?.length ?? 0)), { message: "the macro releases" }).toEqual(expected);
  });

  test("the group chips show the groups they name, and the choice stays for the next visit", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The chips and the period control work the same on phones; one project is enough.");
    // A position outside the watchlist (a Top 78 name with an event this week), so the Holdings chip has an event of its own.
    const extra = await extraHolding(request);
    if (AT_DEFAULT_NOW) expect(extra, "a Top 78 stock off the default lists with an event in the pinned week").toBeDefined();
    if (extra === undefined) {
      test.skip(true, "At this E2E_NOW no Top 78 stock outside the lists has an event this week.");
      return;
    }
    const lists: CalendarLists = { ...LISTS, holdings: { ...LISTS.holdings, [extra]: { shares: 40, cost: 30 } } };
    await app.seedStorage(lists);
    await app.goto("/calendar");
    const today = await browserToday(page);
    const { feed, quotes } = await calendarData(request, lists, "calendar");
    const context = { today, lists, quotes };
    const agenda = panel(page, CAL.title);
    const chips = agenda.getByRole("group", { name: CAL.filters.label });

    // Each chip counts the period's events of its group; the extra position is held but not watched.
    const week = periodEvents(feed, lists, "week", today);
    expect(week.some((event) => event.symbol === extra && eventGroups(event, lists).join() === "holdings,universe"), `an event of ${extra} under Holdings and Top 78 only`).toBe(true);
    const counts = groupCounts(week, lists);
    const chip = (group: EventGroup) => chips.getByRole("button", { name: chipName(group, counts[group]), exact: true });
    /** Exactly these chips are pressed, each named with its count. */
    const expectPressed = (groups: Iterable<EventGroup>, n: Record<EventGroup, number>) =>
      expect(chips.getByRole("button", { pressed: true })).toHaveText(EVENT_GROUPS.filter((group) => [...groups].includes(group)).map((group) => chipName(group, n[group])));
    await expect(chips.getByRole("button")).toHaveText(EVENT_GROUPS.map((group) => chipName(group, counts[group])));
    await expectPressed(DEFAULT_GROUPS, counts);

    const active = new Set<EventGroup>(DEFAULT_GROUPS);
    await expectAgenda(agenda, shownEvents(week, lists, [...active]), context);
    const toggle = async (group: EventGroup) => {
      await chip(group).click();
      if (active.has(group)) active.delete(group);
      else active.add(group);
      await expectPressed(active, counts);
      await expectAgenda(agenda, shownEvents(week, lists, [...active]), context);
    };
    // Without the watchlist its names go, except those held.
    await toggle("watchlist");
    // Without the macro calendar its releases go.
    await toggle("macro");
    // Top 78 adds the universe's events, watched names among them.
    await toggle("universe");
    // Without the holdings the extra position stays, as a Top 78 name.
    await toggle("holdings");
    await toggle("universe");

    // No group at all: the agenda says so and offers every group back.
    await expect(agenda.getByText(CAL.empty.noFilters, { exact: true })).toBeVisible();
    await agenda.getByRole("button", { name: CAL.empty.showAll, exact: true }).click();
    await expectPressed(EVENT_GROUPS, counts);

    // The period and the groups are kept in this browser, so a reload shows the same calendar.
    await agenda.getByRole("radiogroup", { name: CAL.range.label }).getByRole("radio", { name: PERIOD_LABELS.next }).click();
    const next = periodEvents(feed, lists, "next", today);
    const nextCounts = groupCounts(next, lists);
    const nextChip = (group: EventGroup) => chips.getByRole("button", { name: chipName(group, nextCounts[group]), exact: true });
    await nextChip("holdings").click();
    await nextChip("macro").click();
    const kept: EventGroup[] = ["watchlist", "universe"];
    await expectAgenda(agenda, shownEvents(next, lists, kept), context);
    await expect.poll(() => stored<{ range: string; filters: string[] }>(page, CALENDAR_PREFS_KEY)).toEqual({ range: "next", filters: expect.arrayContaining(kept) });
    expect((await stored<{ filters: string[] }>(page, CALENDAR_PREFS_KEY))?.filters).toHaveLength(kept.length);

    await page.reload();
    await app.settle();
    await expect(agenda.getByRole("radiogroup", { name: CAL.range.label }).getByRole("radio", { name: PERIOD_LABELS.next })).toBeChecked();
    await expectPressed(kept, nextCounts);
    await expectAgenda(agenda, shownEvents(next, lists, kept), context);
  });

  test("the week ahead on the overview lists the same week as the calendar", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The panel and the agenda are the same DOM on phones; one project is enough.");
    await app.seedStorage(LISTS);
    await app.goto("/");
    const today = await browserToday(page);
    const { feed, quotes } = await calendarData(request, LISTS, "overview");
    const week = shownEvents(periodEvents(feed, LISTS, "week", today), LISTS, DEFAULT_GROUPS);
    // The panel lists at most eight rows; this week fits, so every event of it is there. Another E2E_NOW can give an
    // empty week or a longer one.
    if (!AT_DEFAULT_NOW) test.skip(week.length === 0 || week.length > 8, `This week has ${week.length} events at this E2E_NOW; the test needs 1 to 8.`);
    expect(week.length).toBeGreaterThan(0);
    expect(week.length).toBeLessThanOrEqual(8);

    const weekAhead = panel(page, CAL.weekAhead);
    const summary = weekSummary(periodEvents(feed, LISTS, "week", today), LISTS);
    await expect(weekAhead.getByText(summary, { exact: true })).toBeVisible();
    const context = { today, lists: LISTS, quotes };
    await expect.poll(async () => weekAheadProblems(await readRows(weekAhead), week, context), { message: "the week ahead's rows" }).toEqual([]);

    // "Full calendar" opens the agenda on the same week, with the same summary.
    await weekAhead.getByRole("link", { name: CAL.overview.open }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    const agenda = panel(page, CAL.title);
    await expect(agenda.getByText(summary, { exact: true })).toBeVisible();
    await expectAgenda(agenda, week, context);
  });
});
