import type { APIRequestContext } from "@playwright/test";

import { formatDividend, formatMoney } from "@/components/calendar/agenda-format";
import { tpl } from "@/lib/format";
import { MESSAGES } from "@/lib/i18n/messages";
import type { CalendarEvent, CalendarResponse, MacroEventKey, Quote, ScreenerRow } from "@/types/api";

import { expect, type Locator, type Page } from "./test";

// Helpers for the research specs (calendar, screener and discover, factor lab): the API answers the pages read, the
// expectations computed from them, and readers for what the pages show. Expected values come from the data (the app's
// own API routes, the committed research files) and are formatted the way the app formats them; the rules they are
// checked against (which period a day belongs to, what a preset keeps) are written out here rather than taken from the
// app's code, so a spec notices when the two part ways.

const CAL = MESSAGES.en.calendar;
const DAY_MS = 86_400_000;

/** GETs an API route with the test's own request context (its base URL and client address) and parses the JSON. */
export async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

/** A panel by its title: the first region of that name (a table inside it can become a region of its own). */
export function panel(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true }).first();
}

/** The value stored under a localStorage key, parsed; null when the key is not set. */
export async function stored<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }, key) as Promise<T | null>;
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-11-07": the New York calendar date of an instant. */
export function newYorkDay(ms: number): string {
  return NEW_YORK_DATE.format(new Date(ms));
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 0 Sunday to 6 Saturday. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The weekday before `day`. */
export function previousWeekday(day: string): string {
  let current = addDays(day, -1);
  while (weekdayOf(current) === 0 || weekdayOf(current) === 6) current = addDays(current, -1);
  return current;
}

/** The weekday `n` weekdays after `day` (NYSE holidays aside: callers use it where none falls). */
export function weekdaysAfter(day: string, n: number): string {
  let current = day;
  for (let left = n; left > 0; ) {
    current = addDays(current, 1);
    if (weekdayOf(current) !== 0 && weekdayOf(current) !== 6) left--;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Events calendar
// ---------------------------------------------------------------------------

/** The calendar's filter chips, in their order on screen. */
export const EVENT_GROUPS = ["holdings", "watchlist", "universe", "macro"] as const;
export type EventGroup = (typeof EVENT_GROUPS)[number];

export type Period = "week" | "next" | "month";

/** The periods of the calendar's period control, by their labels. */
export const PERIOD_LABELS: Readonly<Record<Period, string>> = { week: CAL.range.week, next: CAL.range.next, month: CAL.range.month };

/** What the investor keeps in this browser, in the stores' shapes (e2e/support/test.ts seeds them). */
export interface CalendarLists {
  holdings: Readonly<Record<string, { shares: number; cost: number }>>;
  watchlist: readonly string[];
  /** The stock universe behind the "Top 78" chip. */
  universe: readonly string[];
}

/** The symbols the calendar asks events for: the holdings first, then the rest of the watchlist. */
export function calendarSymbols(lists: CalendarLists): string[] {
  return [...new Set([...Object.keys(lists.holdings), ...lists.watchlist])];
}

/** The day an event belongs to: its New York date; a date-only value (UTC midnight) keeps its date. */
export function eventDay(event: CalendarEvent): string {
  const ms = Date.parse(event.at);
  return ms % DAY_MS === 0 ? event.at.slice(0, 10) : newYorkDay(ms);
}

/**
 * The days a period covers, as the calendar states it: "This week" runs from today through Sunday, and on a weekend
 * through the coming Sunday (the trading week ahead rather than the one that ended); "Next week" is the Monday to
 * Sunday after that; "4 weeks" runs to the end of the fourth week.
 */
export function periodDays(period: Period, today: string): { from: string; to: string } {
  const weekday = weekdayOf(today);
  const sunday = addDays(today, weekday === 6 ? 8 : weekday === 0 ? 7 : 7 - weekday);
  if (period === "week") return { from: today, to: sunday };
  if (period === "next") return { from: addDays(sunday, 1), to: addDays(sunday, 7) };
  return { from: today, to: addDays(sunday, 21) };
}

/** The chips an event counts under: macro releases under Macro, a company event under each list that has the symbol. */
export function eventGroups(event: CalendarEvent, lists: CalendarLists): EventGroup[] {
  if (event.kind === "macro") return ["macro"];
  const symbol = event.symbol ?? "";
  const groups: EventGroup[] = [];
  if (Object.hasOwn(lists.holdings, symbol)) groups.push("holdings");
  if (lists.watchlist.includes(symbol)) groups.push("watchlist");
  if (lists.universe.includes(symbol)) groups.push("universe");
  return groups;
}

/** The feed's events of a period that some chip covers. */
export function periodEvents(feed: CalendarResponse, lists: CalendarLists, period: Period, today: string): CalendarEvent[] {
  const { from, to } = periodDays(period, today);
  return feed.events.filter((event) => {
    const day = eventDay(event);
    return day >= from && day <= to && eventGroups(event, lists).length > 0;
  });
}

/** The events the pressed chips show: those under at least one of them. */
export function shownEvents(events: readonly CalendarEvent[], lists: CalendarLists, active: readonly EventGroup[]): CalendarEvent[] {
  return events.filter((event) => eventGroups(event, lists).some((group) => active.includes(group)));
}

/** Events per chip (an event counts under every chip it belongs to). */
export function groupCounts(events: readonly CalendarEvent[], lists: CalendarLists): Record<EventGroup, number> {
  const counts: Record<EventGroup, number> = { holdings: 0, watchlist: 0, universe: 0, macro: 0 };
  for (const event of events) for (const group of eventGroups(event, lists)) counts[group]++;
  return counts;
}

/** A chip's accessible name: its label, its count and the hidden noun, e.g. "Holdings 3 events". */
export function chipName(group: EventGroup, count: number): string {
  return `${CAL.filters[group]} ${count} ${count === 1 ? CAL.filters.eventOne : CAL.filters.eventOther}`;
}

const NY_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "08:30 ET": the New York time of an instant. */
export function etTime(ms: number): string {
  return tpl(CAL.timeEt, { time: NY_CLOCK.format(new Date(ms)) });
}

/** The time column of a row: the session slot of a US report, "Ex-date" for a dividend, the ET time of a release. */
export function timeText(event: CalendarEvent): string {
  if (event.kind === "dividend") return CAL.exDate;
  if (event.kind === "earnings") return event.timing ? CAL.slot[event.timing] : CAL.slot.tbd;
  return etTime(Date.parse(event.at));
}

/** Where a US report's session slot falls among a day's times: before the open, during the session, after the close. */
const SLOT_MINUTE: Readonly<Record<"pre" | "intraday" | "post", number>> = { pre: 8 * 60, intraday: 12 * 60, post: 16 * 60 + 1 };

/** Minutes after midnight in New York. */
function newYorkMinute(ms: number): number {
  const [hour, minute] = NY_CLOCK.format(new Date(ms)).split(":").map(Number);
  return (hour % 24) * 60 + minute;
}

/**
 * When an event falls within its day, in minutes after midnight, for ordering: an ex-dividend date first (it applies
 * from the open), a US report at its session slot (before the open as 08:00, during the session as 12:00, after the
 * close as 16:01; its time only marks the session), a macro release or a report outside the US at its New York time,
 * and a report without a time (an estimated or date-only one) after everything else.
 */
export function minuteInDay(event: CalendarEvent): number {
  if (event.kind === "dividend") return -1;
  if (event.kind === "earnings" && event.timing) return SLOT_MINUTE[event.timing];
  const ms = Date.parse(event.at);
  const timed = ms % DAY_MS !== 0 && (event.kind === "macro" || (!event.estimated && (event.symbol ?? "").includes(".")));
  return timed ? newYorkMinute(ms) : 24 * 60;
}

/** Holdings first, then watchlist names, then the rest (Top 78 names and macro releases). */
function listRank(event: CalendarEvent, lists: CalendarLists): number {
  if (event.symbol !== null && Object.hasOwn(lists.holdings, event.symbol)) return 0;
  return event.symbol !== null && lists.watchlist.includes(event.symbol) ? 1 : 2;
}

/**
 * The order the agenda and the week ahead list events in: by day, then by the time within the day (minuteInDay), then
 * holdings before watchlist names before the rest, then by symbol (a release by its key) and id.
 */
export function eventOrder(lists: CalendarLists): (a: CalendarEvent, b: CalendarEvent) => number {
  return (a, b) =>
    eventDay(a).localeCompare(eventDay(b)) ||
    minuteInDay(a) - minuteInDay(b) ||
    listRank(a, lists) - listRank(b, lists) ||
    (a.symbol ?? a.macro ?? "").localeCompare(b.symbol ?? b.macro ?? "") ||
    a.id.localeCompare(b.id);
}

/** Problems with the order of rows that show these events: each row by the event it shows, against eventOrder. */
function orderProblems(where: string, rows: readonly ListedRow[], events: readonly CalendarEvent[], lists: CalendarLists, shows: (row: ListedRow, event: CalendarEvent) => boolean): string[] {
  const expected = [...events].sort(eventOrder(lists)).map((event) => event.id);
  const shown = rows.map((row) => events.find((event) => shows(row, event))?.id ?? `"${row.text}"`);
  return shown.join(" | ") === expected.join(" | ") ? [] : [`${where}: rows in the order ${shown.join(", ")}, expected ${expected.join(", ")}`];
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

/** A macro release's name: "Consumer prices". */
export function macroName(key: MacroEventKey): string {
  return CAL.macro[key];
}

/** What a macro release covers: "for October" (the data's month), "with projections" (an FOMC meeting with an SEP). */
export function macroDetail(key: MacroEventKey, period: string | null, projections: boolean): string {
  if (key === "fomc") return projections ? CAL.projections : "";
  return period ? tpl(CAL.forMonth, { month: MONTH.format(new Date(`${period}-15T00:00:00Z`)) }) : "";
}

/** A macro release in words: "Consumer prices for October", "FOMC rate decision with projections". */
export function macroText(key: MacroEventKey, period: string | null, projections: boolean): string {
  return [CAL.macro[key], macroDetail(key, period, projections)].filter(Boolean).join(" ");
}

/** What a row says the event is: "Earnings", "Dividend 0.27 per share", or the release in words. */
export function kindText(event: CalendarEvent): string {
  if (event.kind === "earnings") return CAL.earnings;
  if (event.kind === "dividend") return event.amount === null ? CAL.dividendNoAmount : tpl(CAL.dividend, { amount: formatDividend(event.amount, "en") });
  return macroText(event.macro ?? "cpi", event.period, event.projections);
}

/** An amount of cash as the calendar prints it: two decimals, grouped, the currency code unless US dollars. */
export function cashAmount(value: number, currency: string | null): string {
  return formatMoney(value, currency, "en", true);
}

/** "About 2.70 for your 10 shares": the cash a holder receives, shares times the dividend per share. */
export function cashText(shares: number, perShare: number, currency: string | null): string {
  return tpl(CAL.cashLabel, { amount: cashAmount(shares * perShare, currency), shares });
}

/** The spoken money of a row: the dividend cash of a holder, or the market value of a position that reports. */
export function moneyText(event: CalendarEvent, lists: CalendarLists, quotes: ReadonlyMap<string, Quote>): string | null {
  const holding = event.symbol ? lists.holdings[event.symbol] : undefined;
  if (!holding || !event.symbol) return null;
  const quote = quotes.get(event.symbol);
  if (event.kind === "dividend" && event.amount !== null) return cashText(holding.shares, event.amount, quote?.currency ?? null);
  if (event.kind === "earnings" && quote?.price) return tpl(CAL.valueLabel, { value: formatMoney(holding.shares * quote.price, quote.currency, "en") });
  return null;
}

const DAY_HEADING = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/** "Tue, Nov 10": a day as the agenda's headings and the macro panel name it. */
export function dayName(day: string): string {
  return DAY_HEADING.format(new Date(`${day}T00:00:00Z`));
}

/** "Tue": a day's short weekday. */
export function weekdayName(day: string): string {
  return WEEKDAY.format(new Date(`${day}T00:00:00Z`));
}

/** The day column of the week ahead: Today, Tomorrow, or the short weekday. */
export function weekAheadDay(day: string, today: string): string {
  const offset = daysBetween(today, day);
  return offset === 0 ? CAL.days.today : offset === 1 ? CAL.days.tomorrow : weekdayName(day);
}

/** How far a day is from today in words: Today, Tomorrow, In 3 days; nothing a week or more ahead. */
export function relativeText(day: string, today: string): string {
  const offset = daysBetween(today, day);
  if (offset === 0) return CAL.days.today;
  if (offset === 1) return CAL.days.tomorrow;
  if (offset === -1) return CAL.days.yesterday;
  if (offset > 1 && offset < 7) return tpl(CAL.days.inDays, { n: offset });
  return "";
}

/** A day heading's accessible name: "Tue, Nov 10 In 3 days". */
export function dayHeadingName(day: string, today: string): string {
  return [dayName(day), relativeText(day, today)].filter(Boolean).join(" ");
}

/** A row of an event list as screen readers get it: its text (aria-hidden parts left out) and the symbols it links. */
export interface ListedRow {
  text: string;
  symbols: string[];
}

/** A day heading of the agenda and the rows under it. */
export interface AgendaDay {
  heading: string;
  rows: ListedRow[];
}

/**
 * The agenda as the page shows it, read in one go: each day heading (level 3) and the list items of its group. Text is
 * joined across elements with spaces and leaves out what is hidden from screen readers (the visible "≈ 2.70" beside
 * its spoken "About 2.70 for your 10 shares"), so it reads like the accessibility tree.
 */
export async function readAgenda(agenda: Locator): Promise<AgendaDay[]> {
  return agenda.evaluate((root) => {
    const text = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return "";
      return [...node.childNodes].map(text).join(" ");
    };
    const clean = (value: string) => value.replace(/\s+/g, " ").trim();
    const row = (item: Element) => ({ text: clean(text(item)), symbols: [...item.querySelectorAll('a[href^="/stock/"]')].map((link) => clean(link.textContent ?? "")) });
    return [...root.querySelectorAll("h3")].map((heading) => ({ heading: clean(text(heading)), rows: [...(heading.parentElement?.querySelectorAll("li") ?? [])].map(row) }));
  });
}

/** The list items inside an element, read like readAgenda's rows. */
export async function readRows(list: Locator): Promise<ListedRow[]> {
  return list.evaluate((root) => {
    const text = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return "";
      return [...node.childNodes].map(text).join(" ");
    };
    const clean = (value: string) => value.replace(/\s+/g, " ").trim();
    return [...root.querySelectorAll("li")].map((item) => ({ text: clean(text(item)), symbols: [...item.querySelectorAll('a[href^="/stock/"]')].map((link) => clean(link.textContent ?? "")) }));
  });
}

/**
 * The body cells of a table, row by row, as screen readers get them: text joined across elements with spaces, hidden
 * parts left out and an image (role="img") read by its label. One read for a whole table.
 */
export async function readCells(table: Locator): Promise<string[][]> {
  return table.evaluate((element) => {
    const text = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return "";
      if (node.getAttribute("role") === "img") return node.getAttribute("aria-label") ?? "";
      return [...node.childNodes].map(text).join(" ");
    };
    const clean = (value: string) => value.replace(/\s+/g, " ").trim();
    return [...element.querySelectorAll("tbody tr")].map((row) => [...row.children].map((cell) => clean(text(cell))));
  });
}

/** The rows that are this event: its symbol's link and its kind, or no symbol and the release's name. */
export function rowsOf(rows: readonly ListedRow[], event: CalendarEvent): ListedRow[] {
  if (event.symbol) {
    const kind = event.kind === "earnings" ? CAL.earnings : CAL.dividendNoAmount;
    return rows.filter((row) => row.symbols.includes(event.symbol!) && row.text.includes(kind));
  }
  return rows.filter((row) => row.symbols.length === 0 && row.text.includes(CAL.macro[event.macro ?? "cpi"]));
}

export interface AgendaContext {
  today: string;
  lists: CalendarLists;
  quotes: ReadonlyMap<string, Quote>;
}

/**
 * What differs between the agenda and these events: one heading per day in date order, named by its date and its
 * distance from today, and under each exactly the events of that day in the agenda's order (eventOrder), each starting
 * with its time and stating its kind (with the macro code of a release) and the money a position has at stake. Empty
 * when they agree.
 */
export function agendaProblems(agenda: readonly AgendaDay[], events: readonly CalendarEvent[], context: AgendaContext): string[] {
  const days = [...new Set(events.map(eventDay))].sort();
  const headings = days.map((day) => dayHeadingName(day, context.today));
  const shown = agenda.map((group) => group.heading);
  if (shown.join(" | ") !== headings.join(" | ")) return [`day headings "${shown.join(" | ")}", expected "${headings.join(" | ")}"`];
  const problems: string[] = [];
  for (const [index, day] of days.entries()) {
    const rows = agenda[index].rows;
    const dayEvents = events.filter((event) => eventDay(event) === day);
    if (rows.length !== dayEvents.length) problems.push(`${day}: ${rows.length} rows, expected ${dayEvents.length} (${dayEvents.map((event) => event.id).join(", ")})`);
    problems.push(...orderProblems(day, rows, dayEvents, context.lists, (row, event) => rowsOf([row], event).length === 1));
    for (const event of dayEvents) {
      const matches = rowsOf(rows, event);
      if (matches.length !== 1) {
        problems.push(`${event.id}: ${matches.length} rows on ${day}`);
        continue;
      }
      const row = matches[0].text;
      if (!row.startsWith(timeText(event))) problems.push(`${event.id}: "${row}" does not start with "${timeText(event)}"`);
      const money = moneyText(event, context.lists, context.quotes);
      const parts = [kindText(event), ...(event.kind === "macro" ? [CAL.macroCode[event.macro ?? "cpi"]] : []), ...(money ? [money] : [])];
      for (const part of parts) if (!row.includes(part)) problems.push(`${event.id}: no "${part}" in "${row}"`);
    }
  }
  return problems;
}

/** Waits until the agenda shows exactly these events (see agendaProblems). */
export async function expectAgenda(agenda: Locator, events: readonly CalendarEvent[], context: AgendaContext): Promise<void> {
  await expect.poll(async () => agendaProblems(await readAgenda(agenda), events, context), { message: "the agenda's days and rows" }).toEqual([]);
}

/**
 * What differs between the week ahead's rows and these events: one row per event, in the agenda's order (eventOrder),
 * starting with its day (Today, Tomorrow or the weekday) and its time, with the money a position has at stake. Empty
 * when they agree.
 */
export function weekAheadProblems(rows: readonly ListedRow[], events: readonly CalendarEvent[], context: AgendaContext): string[] {
  const problems = rows.length === events.length ? [] : [`${rows.length} rows, expected ${events.length} (${events.map((event) => event.id).join(", ")})`];
  // The week ahead names the event without its kind; the time column tells a report from an ex-date.
  const shows = (row: ListedRow, event: CalendarEvent) =>
    row.text.includes(timeText(event)) && (event.symbol ? row.symbols.includes(event.symbol) : row.symbols.length === 0 && row.text.includes(CAL.macro[event.macro ?? "cpi"]));
  problems.push(...orderProblems("the week ahead", rows, events, context.lists, shows));
  for (const event of events) {
    const matches = rows.filter((row) => shows(row, event));
    if (matches.length !== 1) {
      problems.push(`${event.id}: ${matches.length} rows`);
      continue;
    }
    const start = `${weekAheadDay(eventDay(event), context.today)} ${timeText(event)}`;
    if (!matches[0].text.startsWith(start)) problems.push(`${event.id}: "${matches[0].text}" does not start with "${start}"`);
    const money = moneyText(event, context.lists, context.quotes);
    if (money && !matches[0].text.includes(money)) problems.push(`${event.id}: no "${money}" in "${matches[0].text}"`);
  }
  return problems;
}

/** The one-line summary of a period: who reports, who goes ex-dividend, the first two macro releases. */
export function weekSummary(events: readonly CalendarEvent[], lists: CalendarLists): string {
  const held = (symbol: string | null) => symbol !== null && Object.hasOwn(lists.holdings, symbol);
  const reporting = new Set(events.filter((e) => e.kind === "earnings" && held(e.symbol)).map((e) => e.symbol));
  const watching = new Set(events.filter((e) => e.kind === "earnings" && !held(e.symbol) && lists.watchlist.includes(e.symbol ?? "")).map((e) => e.symbol));
  const exDividend = new Set(events.filter((e) => e.kind === "dividend" && held(e.symbol)).map((e) => e.symbol));
  const s = CAL.summary;
  const counted = (n: number, one: string, other: string) => (n > 0 ? [tpl(n === 1 ? one : other, { n })] : []);
  const macro = events
    .filter((e) => e.kind === "macro")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, 2)
    .map((e) => tpl(s.macroAt, { name: s.macroNames[e.macro ?? "cpi"], day: weekdayName(eventDay(e)), time: NY_CLOCK.format(new Date(Date.parse(e.at))) }));
  const parts = [
    ...counted(reporting.size, s.holdingsOne, s.holdingsOther),
    ...counted(watching.size, s.watchlistOne, s.watchlistOther),
    ...counted(exDividend.size, s.exDividendOne, s.exDividendOther),
    ...macro,
  ];
  return parts.length > 0 ? parts.join(" · ") : s.none;
}

/** Quotes by symbol. */
export function quoteMap(quotes: readonly Quote[]): Map<string, Quote> {
  return new Map(quotes.map((quote) => [quote.symbol, quote]));
}

// ---------------------------------------------------------------------------
// Screener
// ---------------------------------------------------------------------------

type SortValue = number | string | null;

/** The raw value behind each screener column the specs sort or filter by, from a snapshot row. */
export const SCREEN_VALUES: Readonly<Record<string, (row: ScreenerRow) => SortValue>> = {
  symbol: (row) => row.symbol,
  name: (row) => row.name,
  price: (row) => row.price,
  chg: (row) => row.changePercent,
  cap: (row) => row.marketCap,
  assets: (row) => row.netAssets,
  pe: (row) => row.trailingPE,
  yield: (row) => row.dividendYield,
  rating: (row) => row.analystRating,
  earnings: (row) => row.nextEarningsDate,
  high: (row) => row.fromHigh52,
  ma200: (row) => row.vs200d,
  vol: (row) => row.factors.volatility,
};

const COLLATOR = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

function missing(value: SortValue): value is null {
  return value === null || (typeof value === "number" && Number.isNaN(value));
}

/**
 * Symbols in the order a sort by `key` gives: numbers by value, text in natural order, missing values last in both
 * directions, ties in the snapshot's order (the order of `rows`).
 */
export function sortedSymbols(rows: readonly ScreenerRow[], key: string, direction: "asc" | "desc"): string[] {
  const value = SCREEN_VALUES[key];
  if (!value) throw new Error(`No value for the screener column ${key}`);
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => {
      if (missing(a.value) || missing(b.value)) return missing(a.value) === missing(b.value) ? a.index - b.index : missing(a.value) ? 1 : -1;
      const base = typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : COLLATOR.compare(String(a.value), String(b.value));
      return sign * base || a.index - b.index;
    })
    .map(({ row }) => row.symbol);
}

/** New York calendar days from `now` to `iso` (0 the same day); null when missing. */
export function newYorkDaysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return daysBetween(newYorkDay(now), newYorkDay(Date.parse(iso)));
}

/** The table of a screener or discover panel. */
export function tableIn(region: Locator): Locator {
  return region.getByRole("table");
}

/** Checks the symbols of a table's rows, in order (each row links its symbol; nothing else in the rows is a link). */
export async function expectSymbols(table: Locator, symbols: readonly string[]): Promise<void> {
  await expect(table.getByRole("link")).toHaveText([...symbols]);
}

/** The text of every body cell under a column head, top to bottom (hidden columns included), read in one go. */
export async function columnTexts(table: Locator, header: string): Promise<string[]> {
  const { heads, cells } = await table.evaluate((element, name) => {
    const heads = [...element.querySelectorAll("thead th")].map((head) => (head.textContent ?? "").trim());
    const index = heads.indexOf(name);
    const cells = index < 0 ? null : [...element.querySelectorAll("tbody tr")].map((row) => (row.children[index]?.textContent ?? "").trim());
    return { heads, cells };
  }, header);
  expect(cells, `the column ${header} among ${heads.join(", ")}`).not.toBeNull();
  return cells ?? [];
}

/**
 * The column heads on screen, left to right, read in one go: the text of each head that takes up room (a column hidden
 * at this width takes none), its hidden label included.
 */
export async function visibleHeads(table: Locator): Promise<string[]> {
  return table.evaluate((element) =>
    [...element.querySelectorAll("thead th")].filter((head) => head.getBoundingClientRect().width > 0).map((head) => (head.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
}

/** A number as the app prints it ("1,234.5", "−3.2%", "40.3"); null for a dash. */
export function parseShown(text: string): number | null {
  const clean = text.replace(/−/g, "-").replace(/[,%+\s]/g, "");
  if (clean === "" || clean === "—") return null;
  const value = Number(clean);
  if (!Number.isFinite(value)) throw new Error(`Not a number: ${text}`);
  return value;
}

const COMPACT: Readonly<Record<string, number>> = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** A compact amount as the app prints it ("345.26B", "6.02T"); null for a dash. */
export function parseCompact(text: string): number | null {
  if (text.trim() === "—") return null;
  const match = /^([\d.,]+)([KMBT]?)$/.exec(text.trim());
  if (!match) throw new Error(`Not a compact amount: ${text}`);
  return Number(match[1].replace(/,/g, "")) * COMPACT[match[2]];
}

/**
 * RFC 4180 CSV: quoted fields with doubled quotes, CRLF or LF line ends; the trailing line end adds no row. A leading
 * byte order mark (the app writes one so Excel reads Chinese names) is not part of the first field.
 */
export function parseCsv(csv: string): string[][] {
  const text = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/**
 * The computed colors of design tokens in the page's theme (e.g. "--fg-3" to "rgb(125, 136, 151)"), read from a probe
 * element inside `scope`, so they compare with what toHaveCSS reports for the page's own elements.
 */
export async function tokenColors<T extends string>(scope: Locator, tokens: readonly T[]): Promise<Record<T, string>> {
  const colors = await scope.evaluate((element, names) => {
    const out: Record<string, string> = {};
    for (const name of names) {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      element.append(probe);
      out[name] = getComputedStyle(probe).color;
      probe.remove();
    }
    return out;
  }, tokens as readonly string[]);
  return colors as Record<T, string>;
}
