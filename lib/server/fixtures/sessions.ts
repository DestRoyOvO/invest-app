import "server-only";

import type { MarketState } from "@/types/api";

// Trading calendars for the fixture market data: the NYSE holiday calendar (rules plus the special closures from 2000
// on), weekday calendars for other exchanges and FX, and an every-day calendar for crypto. Dates are day numbers (days
// since 1970-01-01, UTC); times are epoch milliseconds. Session times follow each exchange's time zone, so daylight
// saving time is handled by the platform's time zone data.

export const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Day number of a calendar date (month 1-12). */
export function dayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** "2026-11-06" for a day number. */
export function dayKey(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Day number of "2026-11-06". */
export function parseDayKey(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return dayNumber(year, month, day);
}

/** 0 Sunday to 6 Saturday. 1970-01-01 was a Thursday. */
export function weekdayOf(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function yearOf(day: number): number {
  return new Date(day * DAY_MS).getUTCFullYear();
}

// ---------------------------------------------------------------------------
// NYSE holidays
// ---------------------------------------------------------------------------

/** The n-th (1-based) given weekday of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = dayNumber(year, month, 1);
  return first + ((weekday - weekdayOf(first) + 7) % 7) + (n - 1) * 7;
}

/** The last given weekday of a month. */
function lastWeekday(year: number, month: number, weekday: number): number {
  const last = dayNumber(year, month + 1, 0);
  return last - ((weekdayOf(last) - weekday + 7) % 7);
}

/** Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNumber(year, month, day);
}

/** A fixed-date holiday on a Saturday is observed the Friday before, on a Sunday the Monday after. */
function observed(day: number): number {
  const weekday = weekdayOf(day);
  return weekday === 6 ? day - 1 : weekday === 0 ? day + 1 : day;
}

/** Unscheduled NYSE closures (weather, national days of mourning, September 11). */
const SPECIAL_CLOSURES: readonly string[] = [
  "2001-09-11",
  "2001-09-12",
  "2001-09-13",
  "2001-09-14",
  "2004-06-11",
  "2007-01-02",
  "2012-10-29",
  "2012-10-30",
  "2018-12-05",
  "2025-01-09",
];

const holidayCache = new Map<number, ReadonlySet<number>>();

/**
 * NYSE full-day holidays of a year, from the exchange's rules (Rule 7.2): New Year's Day (not observed on a Saturday),
 * Martin Luther King Jr. Day, Washington's Birthday, Good Friday, Memorial Day, Juneteenth (from 2022), Independence
 * Day, Labor Day, Thanksgiving and Christmas, plus the special closures above. Checked against the published calendars
 * for 2000 to 2030; early closes (13:00) are not modelled.
 */
export function nyseHolidays(year: number): ReadonlySet<number> {
  const known = holidayCache.get(year);
  if (known) return known;
  const days = new Set<number>();
  const newYear = dayNumber(year, 1, 1);
  if (weekdayOf(newYear) === 0) days.add(newYear + 1);
  else if (weekdayOf(newYear) !== 6) days.add(newYear);
  days.add(nthWeekday(year, 1, 1, 3));
  days.add(nthWeekday(year, 2, 1, 3));
  days.add(easterSunday(year) - 2);
  days.add(lastWeekday(year, 5, 1));
  if (year >= 2022) days.add(observed(dayNumber(year, 6, 19)));
  days.add(observed(dayNumber(year, 7, 4)));
  days.add(nthWeekday(year, 9, 1, 1));
  days.add(nthWeekday(year, 11, 4, 4));
  days.add(observed(dayNumber(year, 12, 25)));
  for (const key of SPECIAL_CLOSURES) if (key.startsWith(`${year}-`)) days.add(parseDayKey(key));
  holidayCache.set(year, days);
  return days;
}

export function isNyseSession(day: number): boolean {
  const weekday = weekdayOf(day);
  return weekday >= 1 && weekday <= 5 && !nyseHolidays(yearOf(day)).has(day);
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** UTC offset of a time zone at an instant, in minutes (local time minus UTC). */
export function zoneOffsetMinutes(timeZone: string, instant: number): number {
  if (timeZone === "UTC") return 0;
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour") % 24, part("minute"), part("second"));
  return Math.round((local - Math.floor(instant / 1000) * 1000) / MINUTE_MS);
}

const noonOffsets = new Map<string, number>();

/** The offset in force at local noon of a day: right for every session time, which never falls on a 2am clock change. */
export function dayOffsetMinutes(timeZone: string, day: number): number {
  const key = `${timeZone}|${day}`;
  let offset = noonOffsets.get(key);
  if (offset === undefined) {
    offset = zoneOffsetMinutes(timeZone, day * DAY_MS + 12 * 60 * MINUTE_MS);
    noonOffsets.set(key, offset);
  }
  return offset;
}

/** The instant of a local wall time (minutes after local midnight, may be negative or past 24:00) on a day. */
export function localToUtc(timeZone: string, day: number, minutes: number): number {
  return day * DAY_MS + minutes * MINUTE_MS - dayOffsetMinutes(timeZone, day) * MINUTE_MS;
}

/** Like localToUtc, but exact near a clock change (used for midnight stamps of weekly and monthly bars). */
export function localToUtcExact(timeZone: string, day: number, minutes: number): number {
  const guess = localToUtc(timeZone, day, minutes);
  const offset = zoneOffsetMinutes(timeZone, guess);
  return day * DAY_MS + minutes * MINUTE_MS - offset * MINUTE_MS;
}

/** The local calendar day of an instant. */
export function localDayOf(timeZone: string, instant: number): number {
  return Math.floor((instant + zoneOffsetMinutes(timeZone, instant) * MINUTE_MS) / DAY_MS);
}

/** Minutes after local midnight of an instant. */
export function localMinutesOf(timeZone: string, instant: number): number {
  const local = instant + zoneOffsetMinutes(timeZone, instant) * MINUTE_MS;
  return Math.floor((local - Math.floor(local / DAY_MS) * DAY_MS) / MINUTE_MS);
}

const shortNames = new Map<string, Intl.DateTimeFormat>();

/** "EST", "EDT", "GMT+8"... the abbreviation Yahoo puts next to the exchange time zone. */
export function zoneShortName(timeZone: string, instant: number): string {
  if (timeZone === "UTC") return "UTC";
  let formatter = shortNames.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" });
    shortNames.set(timeZone, formatter);
  }
  return formatter.formatToParts(new Date(instant)).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

// ---------------------------------------------------------------------------
// Market profiles
// ---------------------------------------------------------------------------

export type CalendarKind = "nyse" | "weekdays" | "daily";

export interface MarketProfile {
  key: string;
  timeZone: string;
  calendar: CalendarKind;
  /** Regular session, minutes after local midnight of the session date (futures open at 18:00 the evening before: -360). */
  open: number;
  close: number;
  /** Extended hours (US listings only). */
  pre: number | null;
  post: number | null;
  /** Local time at which Yahoo stamps daily bars: the open for exchanges, midnight for round-the-clock markets. */
  dailyStamp: number;
  periodsPerYear: number;
  /** First day with bars. */
  epoch: number;
}

const EPOCH_2000 = dayNumber(2000, 1, 3);

function exchange(key: string, timeZone: string, open: number, close: number): MarketProfile {
  return { key, timeZone, calendar: "weekdays", open, close, pre: null, post: null, dailyStamp: open, periodsPerYear: 252, epoch: EPOCH_2000 };
}

export const PROFILES = {
  us: { key: "us", timeZone: "America/New_York", calendar: "nyse", open: 570, close: 960, pre: 240, post: 1200, dailyStamp: 570, periodsPerYear: 252, epoch: EPOCH_2000 },
  fx: { key: "fx", timeZone: "Europe/London", calendar: "weekdays", open: 0, close: 1440, pre: null, post: null, dailyStamp: 0, periodsPerYear: 260, epoch: dayNumber(2003, 12, 1) },
  futures: { key: "futures", timeZone: "America/New_York", calendar: "weekdays", open: -360, close: 1020, pre: null, post: null, dailyStamp: 0, periodsPerYear: 252, epoch: dayNumber(2000, 8, 30) },
  crypto: { key: "crypto", timeZone: "UTC", calendar: "daily", open: 0, close: 1440, pre: null, post: null, dailyStamp: 0, periodsPerYear: 365, epoch: dayNumber(2014, 9, 17) },
  toronto: exchange("toronto", "America/Toronto", 570, 960),
  london: exchange("london", "Europe/London", 480, 990),
  frankfurt: exchange("frankfurt", "Europe/Berlin", 540, 1050),
  paris: exchange("paris", "Europe/Paris", 540, 1050),
  zurich: exchange("zurich", "Europe/Zurich", 540, 1050),
  tokyo: exchange("tokyo", "Asia/Tokyo", 540, 930),
  hongkong: exchange("hongkong", "Asia/Hong_Kong", 570, 960),
  shanghai: exchange("shanghai", "Asia/Shanghai", 570, 900),
  seoul: exchange("seoul", "Asia/Seoul", 540, 930),
  taipei: exchange("taipei", "Asia/Taipei", 540, 810),
  sydney: exchange("sydney", "Australia/Sydney", 600, 960),
  mumbai: exchange("mumbai", "Asia/Kolkata", 555, 930),
} as const satisfies Record<string, MarketProfile>;

export type ProfileKey = keyof typeof PROFILES;

export function isTradingDay(profile: MarketProfile, day: number): boolean {
  if (day < profile.epoch) return false;
  if (profile.calendar === "daily") return true;
  if (profile.calendar === "nyse") return isNyseSession(day);
  const weekday = weekdayOf(day);
  return weekday >= 1 && weekday <= 5;
}

export function sessionOpen(profile: MarketProfile, day: number): number {
  return localToUtc(profile.timeZone, day, profile.open);
}

export function sessionClose(profile: MarketProfile, day: number): number {
  return localToUtc(profile.timeZone, day, profile.close);
}

/** The instant Yahoo stamps the day's daily bar with. */
export function dailyStamp(profile: MarketProfile, day: number): number {
  return localToUtc(profile.timeZone, day, profile.dailyStamp);
}

export function nextTradingDay(profile: MarketProfile, day: number): number {
  let next = day + 1;
  while (!isTradingDay(profile, next)) next++;
  return next;
}

export function previousTradingDay(profile: MarketProfile, day: number): number {
  let previous = day - 1;
  while (previous >= profile.epoch && !isTradingDay(profile, previous)) previous--;
  return previous;
}

/** The trading day `count` sessions after (positive) or before (negative) `day`. */
export function addTradingDays(profile: MarketProfile, day: number, count: number): number {
  let current = day;
  for (let i = 0; i < Math.abs(count); i++) current = count > 0 ? nextTradingDay(profile, current) : previousTradingDay(profile, current);
  return current;
}

/** The trading day on or before `day`. */
export function tradingDayOnOrBefore(profile: MarketProfile, day: number): number {
  return isTradingDay(profile, day) ? day : previousTradingDay(profile, day);
}

/**
 * The latest session that has closed at `now`. Fixture prices stop there, so the data changes only when a session
 * closes and stays the same for the whole of a test run in between.
 */
export function latestCompletedSession(profile: MarketProfile, now: number): number {
  let day = localDayOf(profile.timeZone, now) + 1;
  for (let i = 0; i < 20; i++, day--) {
    if (isTradingDay(profile, day) && sessionClose(profile, day) <= now) return day;
  }
  return previousTradingDay(profile, day);
}

/** Trading days from `from` to `to`, both included. */
export function tradingDaysBetween(profile: MarketProfile, from: number, to: number): number[] {
  const days: number[] = [];
  for (let day = Math.max(from, profile.epoch); day <= to; day++) if (isTradingDay(profile, day)) days.push(day);
  return days;
}

/**
 * Yahoo's marketState from the clock: REGULAR during the session (always, for crypto), PRE and POST around a US
 * session, CLOSED otherwise. Prices do not follow it; they stay those of the latest completed session.
 */
export function marketStateAt(profile: MarketProfile, now: number): MarketState {
  if (profile.calendar === "daily") return "REGULAR";
  const today = localDayOf(profile.timeZone, now);
  for (const day of [today, today + 1]) {
    if (!isTradingDay(profile, day)) continue;
    if (now >= sessionOpen(profile, day) && now < sessionClose(profile, day)) return "REGULAR";
    if (profile.pre !== null && now >= localToUtc(profile.timeZone, day, profile.pre) && now < sessionOpen(profile, day)) return "PRE";
    if (profile.post !== null && now >= sessionClose(profile, day) && now < localToUtc(profile.timeZone, day, profile.post)) return "POST";
  }
  return "CLOSED";
}
