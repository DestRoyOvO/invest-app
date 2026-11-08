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
// what they say and stay as the investor left them, and the week ahead lists the same week as the agenda.
//
// Expected rows come from the feed the page reads (/api/calendar) and the quotes of the positions (/api/quotes), with
// the period and group rules written out in e2e/support/research.ts.

/** The default watchlist with two of its names held: the calendar of a returning investor. */
const LISTS: CalendarLists = {
  watchlist: [...DEFAULT_WATCHLIST],
  holdings: { AAPL: { shares: 10, cost: 150 }, MSFT: { shares: 5, cost: 300 } },
  universe: UNIVERSE_STOCKS,
};

/** Plus a position outside the watchlist (BAC, a Top 78 name), so the Holdings chip has an event of its own. */
const LISTS_WITH_BAC: CalendarLists = { ...LISTS, holdings: { ...LISTS.holdings, BAC: { shares: 40, cost: 30 } } };

/** The groups shown before the investor changes anything: holdings, watchlist and macro; Top 78 is off. */
const DEFAULT_GROUPS: readonly EventGroup[] = ["holdings", "watchlist", "macro"];

const CALENDAR_PREFS_KEY = "investseek:calendar:v1";

type Request = Parameters<typeof getJson>[0];

/**
 * The feed a page reads (the calendar: 31 days with the universe; the overview's week ahead: 10 days without it) and
 * the quotes of the positions.
 */
async function calendarData(request: Request, lists: CalendarLists, page: "calendar" | "overview") {
  const symbols = calendarSymbols(lists).join(",");
  const query = page === "calendar" ? `days=31&symbols=${symbols}&scope=universe` : `days=10&symbols=${symbols}`;
  const feed = await getJson<CalendarResponse>(request, `/api/calendar?${query}`);
  const quotes = quoteMap((await getJson<QuotesResponse>(request, `/api/quotes?symbols=${Object.keys(lists.holdings).join(",")}`)).quotes);
  return { feed, quotes };
}

/** Today in New York on the browser's clock (the suite sets it to the server's). */
async function browserToday(page: Page): Promise<string> {
  return newYorkDay(await page.evaluate(() => Date.now()));
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

    const agenda = panel(page, "Events calendar");
    const period = agenda.getByRole("radiogroup", { name: "Period" });
    await expect(period.getByRole("radio", { name: PERIOD_LABELS.week })).toBeChecked();

    // This week runs from today, a Saturday, through the coming Sunday: Tuesday is "In 3 days", and with nothing on
    // the weekend no day is Today or Tomorrow.
    const week = shownEvents(periodEvents(feed, LISTS, "week", today), LISTS, DEFAULT_GROUPS);
    expect(week.map((event) => event.id)).toEqual(expect.arrayContaining(thisWeek));
    await expectAgenda(agenda, week, context);
    await expect(agenda.getByRole("heading", { level: 3, name: `${dayName(weekdaysAfter(latest, 2))} In 3 days`, exact: true })).toBeVisible();
    await expect(agenda.getByRole("heading", { level: 3, name: /Today|Tomorrow/ })).toHaveCount(0);
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
    await expect(page.getByRole("group", { name: `At a glance: ${PERIOD_LABELS.week}` })).toContainText(`≈ ${cashAmount(cash, "USD")}`);

    // Next week: AAPL reports in 6 sessions, GOOGL in 8 and AMZN in 9. A week or more ahead, a day goes by its date.
    await period.getByRole("radio", { name: PERIOD_LABELS.next }).click();
    const next = shownEvents(periodEvents(feed, LISTS, "next", today), LISTS, DEFAULT_GROUPS);
    expect(next.map((event) => event.id)).toEqual(expect.arrayContaining(nextWeek));
    await expectAgenda(agenda, next, context);
    await expect(page.getByRole("group", { name: `At a glance: ${PERIOD_LABELS.next}` })).toBeVisible();

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
    const releases = panel(page, "Macro releases");
    await expect.poll(async () => (await readRows(releases)).map((row, index) => row.text.slice(0, expected[index]?.length ?? 0)), { message: "the macro releases" }).toEqual(expected);
  });

  test("the group chips show the groups they name, and the choice stays for the next visit", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The chips and the period control work the same on phones; one project is enough.");
    await app.seedStorage(LISTS_WITH_BAC);
    await app.goto("/calendar");
    const today = await browserToday(page);
    const { feed, quotes } = await calendarData(request, LISTS_WITH_BAC, "calendar");
    const context = { today, lists: LISTS_WITH_BAC, quotes };
    const agenda = panel(page, "Events calendar");
    const chips = agenda.getByRole("group", { name: "Show events for" });

    // Each chip counts the period's events of its group. BAC, held but not watched, reports this week.
    const week = periodEvents(feed, LISTS_WITH_BAC, "week", today);
    expect(week.some((event) => event.symbol === "BAC"), "an event under Holdings alone").toBe(true);
    const counts = groupCounts(week, LISTS_WITH_BAC);
    const chip = (group: EventGroup) => chips.getByRole("button", { name: chipName(group, counts[group]), exact: true });
    /** Exactly these chips are pressed, each named with its count. */
    const expectPressed = (groups: Iterable<EventGroup>, n: Record<EventGroup, number>) =>
      expect(chips.getByRole("button", { pressed: true })).toHaveText(EVENT_GROUPS.filter((group) => [...groups].includes(group)).map((group) => chipName(group, n[group])));
    await expect(chips.getByRole("button")).toHaveText(EVENT_GROUPS.map((group) => chipName(group, counts[group])));
    await expectPressed(DEFAULT_GROUPS, counts);

    const active = new Set<EventGroup>(DEFAULT_GROUPS);
    await expectAgenda(agenda, shownEvents(week, LISTS_WITH_BAC, [...active]), context);
    const toggle = async (group: EventGroup) => {
      await chip(group).click();
      if (active.has(group)) active.delete(group);
      else active.add(group);
      await expectPressed(active, counts);
      await expectAgenda(agenda, shownEvents(week, LISTS_WITH_BAC, [...active]), context);
    };
    // Without the watchlist NVDA's report goes, and the watched positions (AAPL, MSFT) stay with the holdings.
    await toggle("watchlist");
    // Without the macro calendar the CPI release goes.
    await toggle("macro");
    // Top 78 adds the universe's events, NVDA's among them.
    await toggle("universe");
    // Without the holdings BAC stays, as a Top 78 name.
    await toggle("holdings");
    await toggle("universe");

    // No group at all: the agenda says so and offers every group back.
    await expect(agenda.getByText("No groups selected. Choose at least one to see events.")).toBeVisible();
    await agenda.getByRole("button", { name: "Show all groups" }).click();
    await expectPressed(EVENT_GROUPS, counts);

    // The period and the groups are kept in this browser, so a reload shows the same calendar.
    await agenda.getByRole("radiogroup", { name: "Period" }).getByRole("radio", { name: PERIOD_LABELS.next }).click();
    const next = periodEvents(feed, LISTS_WITH_BAC, "next", today);
    const nextCounts = groupCounts(next, LISTS_WITH_BAC);
    const nextChip = (group: EventGroup) => chips.getByRole("button", { name: chipName(group, nextCounts[group]), exact: true });
    await nextChip("holdings").click();
    await nextChip("macro").click();
    const kept: EventGroup[] = ["watchlist", "universe"];
    await expectAgenda(agenda, shownEvents(next, LISTS_WITH_BAC, kept), context);
    await expect.poll(() => stored<{ range: string; filters: string[] }>(page, CALENDAR_PREFS_KEY)).toEqual({ range: "next", filters: expect.arrayContaining(kept) });
    expect((await stored<{ filters: string[] }>(page, CALENDAR_PREFS_KEY))?.filters).toHaveLength(kept.length);

    await page.reload();
    await app.settle();
    await expect(agenda.getByRole("radiogroup", { name: "Period" }).getByRole("radio", { name: PERIOD_LABELS.next })).toBeChecked();
    await expectPressed(kept, nextCounts);
    await expectAgenda(agenda, shownEvents(next, LISTS_WITH_BAC, kept), context);
  });

  test("the week ahead on the overview lists the same week as the calendar", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The panel and the agenda are the same DOM on phones; one project is enough.");
    await app.seedStorage(LISTS);
    await app.goto("/");
    const today = await browserToday(page);
    const { feed, quotes } = await calendarData(request, LISTS, "overview");
    const week = shownEvents(periodEvents(feed, LISTS, "week", today), LISTS, DEFAULT_GROUPS);
    // The panel lists at most eight rows; this week fits, so every event of it is there.
    expect(week.length).toBeGreaterThan(0);
    expect(week.length).toBeLessThanOrEqual(8);

    const weekAhead = panel(page, "Week ahead");
    const summary = weekSummary(periodEvents(feed, LISTS, "week", today), LISTS);
    await expect(weekAhead.getByText(summary, { exact: true })).toBeVisible();
    const context = { today, lists: LISTS, quotes };
    await expect.poll(async () => weekAheadProblems(await readRows(weekAhead), week, context), { message: "the week ahead's rows" }).toEqual([]);

    // "Full calendar" opens the agenda on the same week, with the same summary.
    await weekAhead.getByRole("link", { name: "Full calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    const agenda = panel(page, "Events calendar");
    await expect(agenda.getByText(summary, { exact: true })).toBeVisible();
    await expectAgenda(agenda, week, context);
  });
});
