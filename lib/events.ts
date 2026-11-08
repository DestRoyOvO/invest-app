// Pure helpers behind the events calendar (EVTS) and the week-ahead panel: New York calendar days, date ranges, agenda
// grouping and filters, money at stake, relative day labels and week summaries. No React and no fetching, so server
// modules (lib/server/options.ts) use the day helpers too. Tested in lib/events.test.ts.

import { tpl } from "@/lib/format";
import type { CalendarEvent, Lang, MacroEventKey } from "@/types/api";

export const NEW_YORK = "America/New_York";
const DAY_MS = 86_400_000;
const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const partsCache = new Map<string, Intl.DateTimeFormat>();

function zoneParts(ms: number, timeZone: string): { day: string; minute: number } {
  let format = timeZone === NEW_YORK ? NY_PARTS : partsCache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    partsCache.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  // Some engines print midnight as "24" even with h23.
  const hour = Number(get("hour")) % 24;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minute: hour * 60 + Number(get("minute")) };
}

/** "YYYY-MM-DD" of an instant in New York. */
export function nyDayKey(ms: number): string {
  return zoneParts(ms, NEW_YORK).day;
}

/** Minutes after midnight in New York. */
export function nyMinuteOfDay(ms: number): number {
  return zoneParts(ms, NEW_YORK).minute;
}

/** True for date-only values: Yahoo sends dates without a time of day as UTC midnight. */
export function isDateOnly(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t % DAY_MS === 0;
}

/** The calendar day an event belongs to: its New York date, or the UTC date of a date-only value. */
export function eventDayKey(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return t % DAY_MS === 0 ? new Date(t).toISOString().slice(0, 10) : nyDayKey(t);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** True for listings on a US exchange. Yahoo suffixes other listings with their market (0700.HK, SAP.DE, 7203.T). */
export function isUsListing(symbol: string): boolean {
  return !symbol.includes(".");
}

/**
 * True when Yahoo's time of a confirmed report is the release time. For US listings it only marks the session (13:30Z
 * before the open, 21:00Z after the close, whatever the company's actual time), so only the slot is known there.
 */
export function reportTimeKnown(symbol: string, iso: string): boolean {
  return !isUsListing(symbol) && !isDateOnly(iso);
}

export type AgendaRange = "week" | "next" | "month";
export const AGENDA_RANGES: readonly AgendaRange[] = ["week", "next", "month"];

/** Days the calendar requests: enough for the longest range ("4 weeks" ends at most 29 days out). */
export const AGENDA_FETCH_DAYS = 31;

/** Inclusive range of New York days. */
export interface DayWindow {
  from: string;
  to: string;
}

/**
 * The days a range covers. "This week" runs from today to Sunday; on a weekend it covers the coming trading week rather
 * than the one that just ended. "Next week" is the Monday to Sunday after it; "4 weeks" runs to the end of the fourth.
 */
export function rangeWindow(range: AgendaRange, now: number): DayWindow {
  const today = nyDayKey(now);
  const weekday = weekdayOf(today);
  const weekEnd = addDays(today, weekday === 6 ? 8 : weekday === 0 ? 7 : 7 - weekday);
  if (range === "week") return { from: today, to: weekEnd };
  if (range === "next") return { from: addDays(weekEnd, 1), to: addDays(weekEnd, 7) };
  return { from: today, to: addDays(weekEnd, 21) };
}

export type EventFilter = "holdings" | "watchlist" | "universe" | "macro";
export const EVENT_FILTERS: readonly EventFilter[] = ["holdings", "watchlist", "universe", "macro"];
export const DEFAULT_FILTERS: readonly EventFilter[] = ["holdings", "watchlist", "macro"];

export interface HoldingLike {
  shares: number;
  /** Average cost per share. */
  cost: number;
}

export interface PriceLike {
  price: number | null;
  currency: string | null;
}

export interface AgendaInput {
  holdings: Readonly<Record<string, HoldingLike>>;
  watchlist: readonly string[];
  /** The stock universe behind the "Top 78" filter. */
  universe: ReadonlySet<string>;
  /** Latest quotes of held symbols, for position values. */
  prices?: ReadonlyMap<string, PriceLike>;
}

export interface AgendaItem {
  event: CalendarEvent;
  /** Calendar day: the New York date, or the UTC date of a date-only value. */
  day: string;
  /** Minutes after midnight in New York when the exact time is known; null for dates, estimates and session slots. */
  minute: number | null;
  /** The filters the event matches. */
  filters: EventFilter[];
  /** Shares held; null when the symbol is not held. */
  shares: number | null;
  /** Shares times the last price, or times the average cost while no price is known. */
  positionValue: number | null;
  /** True when positionValue uses the average cost. */
  valueAtCost: boolean;
  /** Quote currency of the position, when known. */
  currency: string | null;
  /** Approximate cash a holder receives: shares times the dividend per share. */
  dividendCash: number | null;
}

export function eventFilters(event: CalendarEvent, input: AgendaInput): EventFilter[] {
  if (event.kind === "macro") return ["macro"];
  const symbol = event.symbol;
  if (!symbol) return [];
  const out: EventFilter[] = [];
  if (input.holdings[symbol]) out.push("holdings");
  if (input.watchlist.includes(symbol)) out.push("watchlist");
  if (input.universe.has(symbol)) out.push("universe");
  return out;
}

/**
 * Wall-clock minute of an event, or null when no exact time is known: dividends, date-only values, estimated reports
 * and reports whose time only marks a session slot (see reportTimeKnown).
 */
function eventMinute(event: CalendarEvent): number | null {
  if (event.kind === "dividend" || isDateOnly(event.at)) return null;
  if (event.kind === "earnings" && (event.estimated || event.timing !== null || !reportTimeKnown(event.symbol ?? "", event.at))) return null;
  const t = Date.parse(event.at);
  return Number.isFinite(t) ? nyMinuteOfDay(t) : null;
}

export function toAgendaItem(event: CalendarEvent, input: AgendaInput): AgendaItem {
  const holding = event.symbol ? input.holdings[event.symbol] : undefined;
  const quote = event.symbol ? input.prices?.get(event.symbol) : undefined;
  const price = quote?.price ?? null;
  const priced = price !== null && Number.isFinite(price) && price > 0;
  return {
    event,
    day: eventDayKey(event.at),
    minute: eventMinute(event),
    filters: eventFilters(event, input),
    shares: holding ? holding.shares : null,
    positionValue: holding ? holding.shares * (priced ? price : holding.cost) : null,
    valueAtCost: holding !== undefined && !priced,
    currency: quote?.currency ?? null,
    dividendCash: holding && event.kind === "dividend" && event.amount !== null ? holding.shares * event.amount : null,
  };
}

const SLOT_MINUTE = { pre: 8 * 60, intraday: 12 * 60, post: 16 * 60 + 1 } as const;

/** Order inside a day: ex-dividend dates first (they apply from the open), then by time, then reports without a time. */
function sortMinute(item: AgendaItem): number {
  if (item.event.kind === "dividend") return -1;
  if (item.minute !== null) return item.minute;
  if (item.event.timing) return SLOT_MINUTE[item.event.timing];
  return 24 * 60;
}

/** Holdings before watchlist names before the rest. */
function ownership(item: AgendaItem): number {
  if (item.shares !== null) return 0;
  return item.filters.includes("watchlist") ? 1 : 2;
}

export function compareItems(a: AgendaItem, b: AgendaItem): number {
  return (
    a.day.localeCompare(b.day) ||
    sortMinute(a) - sortMinute(b) ||
    ownership(a) - ownership(b) ||
    (a.event.symbol ?? a.event.macro ?? "").localeCompare(b.event.symbol ?? b.event.macro ?? "") ||
    a.event.id.localeCompare(b.event.id)
  );
}

export function inWindow(item: AgendaItem, window: DayWindow): boolean {
  return item.day >= window.from && item.day <= window.to;
}

/** Events per filter (an event can count under several filters). */
export function filterCounts(items: readonly AgendaItem[]): Record<EventFilter, number> {
  const counts: Record<EventFilter, number> = { holdings: 0, watchlist: 0, universe: 0, macro: 0 };
  for (const item of items) for (const filter of item.filters) counts[filter]++;
  return counts;
}

/** Events matching at least one active filter. */
export function applyFilters(items: readonly AgendaItem[], active: ReadonlySet<EventFilter>): AgendaItem[] {
  return items.filter((item) => item.filters.some((filter) => active.has(filter)));
}

export interface AgendaDay {
  day: string;
  items: AgendaItem[];
}

/** Items sorted and grouped by day, days in order. */
export function groupByDay(items: readonly AgendaItem[]): AgendaDay[] {
  const days: AgendaDay[] = [];
  for (const item of [...items].sort(compareItems)) {
    const current = days.at(-1);
    if (current && current.day === item.day) current.items.push(item);
    else days.push({ day: item.day, items: [item] });
  }
  return days;
}

export interface Agenda {
  /** Every event in the window, before the filters (the filter counts come from these). */
  items: AgendaItem[];
  counts: Record<EventFilter, number>;
  /** The filtered events by day. */
  days: AgendaDay[];
  /** Number of filtered events. */
  shown: number;
}

export function buildAgenda(events: readonly CalendarEvent[], input: AgendaInput, window: DayWindow, active: ReadonlySet<EventFilter>): Agenda {
  const items = events.map((event) => toAgendaItem(event, input)).filter((item) => item.filters.length > 0 && inWindow(item, window));
  const filtered = applyFilters(items, active);
  return { items, counts: filterCounts(items), days: groupByDay(filtered), shown: filtered.length };
}

/**
 * The rows of a compact week list: at most `max`, holdings first, then macro releases, then watchlist names, shown in
 * time order. `hidden` counts the rest.
 */
export function pickTopItems(items: readonly AgendaItem[], max: number): { items: AgendaItem[]; hidden: number } {
  const rank = (item: AgendaItem) => (item.shares !== null ? 0 : item.event.kind === "macro" ? 1 : item.filters.includes("watchlist") ? 2 : 3);
  const sorted = [...items].sort(compareItems);
  const chosen = new Set([...sorted].sort((a, b) => rank(a) - rank(b) || compareItems(a, b)).slice(0, Math.max(0, max)));
  return { items: sorted.filter((item) => chosen.has(item)), hidden: Math.max(0, items.length - chosen.size) };
}

export type RelativeDay =
  | { kind: "today" | "tomorrow" | "yesterday"; offset: number }
  /** Later this week (2 to 6 days ahead): name the weekday. */
  | { kind: "weekday"; offset: number }
  | { kind: "date"; offset: number };

export function relativeDay(day: string, today: string): RelativeDay {
  const offset = daysBetween(today, day);
  if (offset === 0) return { kind: "today", offset };
  if (offset === 1) return { kind: "tomorrow", offset };
  if (offset === -1) return { kind: "yesterday", offset };
  if (offset > 1 && offset < 7) return { kind: "weekday", offset };
  return { kind: "date", offset };
}

/**
 * The same instant on the viewer's clock when it differs from New York: the local time and how many days it falls after
 * (or before) the New York date. Null when the two clocks agree.
 */
export function localTimeOf(ms: number, timeZone: string): { time: string; minute: number; dayOffset: number } | null {
  let local: { day: string; minute: number };
  try {
    local = zoneParts(ms, timeZone);
  } catch {
    return null;
  }
  const ny = zoneParts(ms, NEW_YORK);
  if (local.day === ny.day && local.minute === ny.minute) return null;
  const hh = String(Math.floor(local.minute / 60)).padStart(2, "0");
  const mm = String(local.minute % 60).padStart(2, "0");
  return { time: `${hh}:${mm}`, minute: local.minute, dayOffset: daysBetween(ny.day, local.day) };
}

/** "HH:MM" on the New York clock. */
export function nyClock(ms: number): string {
  const minute = nyMinuteOfDay(ms);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** True when the macro dates on file end within `warnDays` of now or before the shown window ends. */
export function macroListEnding(macroCalendarEnds: string, window: DayWindow, now: number, warnDays = 45): boolean {
  const ends = Date.parse(macroCalendarEnds);
  if (!Number.isFinite(ends)) return false;
  return ends - now < warnDays * DAY_MS || eventDayKey(macroCalendarEnds) < window.to;
}

export interface WeekSummary {
  /** Held symbols with an earnings report in the window. */
  holdingsReporting: number;
  /** Watchlist symbols that are not held and report in the window. */
  watchlistReporting: number;
  /** Held symbols going ex-dividend in the window. */
  holdingsExDividend: number;
  /** Macro releases in time order. */
  macro: Array<{ key: MacroEventKey; at: string; projections: boolean }>;
}

export function summarizeWeek(items: readonly AgendaItem[]): WeekSummary {
  const held = new Set<string>();
  const watched = new Set<string>();
  const exDividend = new Set<string>();
  const macro: WeekSummary["macro"] = [];
  for (const item of [...items].sort(compareItems)) {
    const { event } = item;
    if (event.kind === "macro" && event.macro) macro.push({ key: event.macro, at: event.at, projections: event.projections });
    if (!event.symbol) continue;
    if (event.kind === "earnings") {
      if (item.shares !== null) held.add(event.symbol);
      else if (item.filters.includes("watchlist")) watched.add(event.symbol);
    }
    if (event.kind === "dividend" && item.shares !== null) exDividend.add(event.symbol);
  }
  return { holdingsReporting: held.size, watchlistReporting: watched.size, holdingsExDividend: exDividend.size, macro };
}

export interface WeekSummaryLabels {
  holdingsOne: string;
  holdingsOther: string;
  watchlistOne: string;
  watchlistOther: string;
  exDividendOne: string;
  exDividendOther: string;
  /** "{name} {day} {time} ET" */
  macroAt: string;
  macroNames: Record<MacroEventKey, string>;
  /** Shown when nothing is scheduled. */
  none: string;
}

const dayFormatCache = new Map<string, Intl.DateTimeFormat>();

function nyDayFormat(lang: Lang, style: "weekday" | "date"): Intl.DateTimeFormat {
  const key = `${lang}:${style}`;
  let format = dayFormatCache.get(key);
  if (!format) {
    const options: Intl.DateTimeFormatOptions = style === "weekday" ? { weekday: "short" } : { month: "short", day: "numeric" };
    format = new Intl.DateTimeFormat(LOCALES[lang], { ...options, timeZone: NEW_YORK });
    dayFormatCache.set(key, format);
  }
  return format;
}

/** Short weekday of an instant in New York, e.g. "Wed" or "周三". */
export function nyWeekday(ms: number, lang: Lang): string {
  return nyDayFormat(lang, "weekday").format(new Date(ms));
}

/** Short New York date, e.g. "Nov 10" or "11月10日". */
export function nyShortDate(ms: number, lang: Lang): string {
  return nyDayFormat(lang, "date").format(new Date(ms));
}

/**
 * One line such as "3 holdings report · FOMC Wed 14:00 ET"; at most `maxMacro` macro releases are named. Over more than
 * a week a weekday is ambiguous, so `dayStyle: "date"` names the date instead ("CPI Nov 10 08:30 ET").
 */
export function formatWeekSummary(summary: WeekSummary, labels: WeekSummaryLabels, lang: Lang, maxMacro = 2, dayStyle: "weekday" | "date" = "weekday"): string {
  const parts: string[] = [];
  const counted = (n: number, one: string, other: string) => {
    if (n > 0) parts.push(tpl(n === 1 ? one : other, { n }));
  };
  counted(summary.holdingsReporting, labels.holdingsOne, labels.holdingsOther);
  counted(summary.watchlistReporting, labels.watchlistOne, labels.watchlistOther);
  counted(summary.holdingsExDividend, labels.exDividendOne, labels.exDividendOther);
  for (const release of summary.macro.slice(0, Math.max(0, maxMacro))) {
    const t = Date.parse(release.at);
    const day = dayStyle === "date" ? nyShortDate(t, lang) : nyWeekday(t, lang);
    parts.push(tpl(labels.macroAt, { name: labels.macroNames[release.key], day, time: nyClock(t) }));
  }
  return parts.length > 0 ? parts.join(" · ") : labels.none;
}
