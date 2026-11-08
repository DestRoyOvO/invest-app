// US session math for the market clock, the countdown and the session ribbon. Pure, so it is unit tested.
//
// Open or closed always comes from Yahoo's marketState; the clock only places "now" inside the day and estimates the
// countdown. The estimate assumes the regular session runs 09:30 to 16:00 ET on weekdays: it knows no holiday calendar
// and no early closes, except that a weekday Yahoo reports as CLOSED during the day is treated as a holiday.

import type { MarketState } from "@/types/api";

export const ET_TIME_ZONE = "America/New_York";

/** Minutes after midnight in New York. */
export const SESSION = { preOpen: 4 * 60, open: 9 * 60 + 30, close: 16 * 60, postClose: 20 * 60 } as const;

const DAY = 24 * 60;

export interface EtClock {
  /** 0 Sunday to 6 Saturday, in New York. */
  weekday: number;
  /** Minutes since midnight in New York, seconds included as a fraction. */
  minutes: number;
}

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The New York weekday and time of day of an instant. */
export function etClock(now: number | Date): EtClock {
  const parts = ET_PARTS.formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "0";
  const hour = Number(part("hour")) % 24;
  return { weekday: WEEKDAYS[part("weekday")] ?? 0, minutes: hour * 60 + Number(part("minute")) + Number(part("second")) / 60 };
}

/** Pre-market, regular session or after hours: the states in which the ribbon shows a live session. */
export function isTradingState(state: MarketState | null): boolean {
  return state === "PRE" || state === "REGULAR" || state === "POST";
}

function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/** Approximate minutes until the next regular open (09:30 ET on a weekday). */
export function minutesToOpen(state: MarketState | null, clock: EtClock): number {
  const { weekday, minutes } = clock;
  // Before 09:30 on a weekday the market opens today, unless Yahoo says CLOSED after 04:00 (a holiday).
  const opensToday = isWeekday(weekday) && minutes < SESSION.open && !(state === "CLOSED" && minutes >= SESSION.preOpen);
  if (opensToday) return SESSION.open - minutes;
  const daysAhead = weekday === 5 ? 3 : weekday === 6 ? 2 : 1;
  return daysAhead * DAY + SESSION.open - minutes;
}

export interface Countdown {
  kind: "opens" | "closes";
  minutes: number;
}

/** "Closes in" during the regular session, "Opens in" otherwise. Without a state the clock decides. */
export function sessionCountdown(state: MarketState | null, clock: EtClock): Countdown {
  const inRegularHours = isWeekday(clock.weekday) && clock.minutes >= SESSION.open && clock.minutes < SESSION.close;
  if (state === "REGULAR" || (state === null && inRegularHours)) {
    return { kind: "closes", minutes: Math.max(0, SESSION.close - clock.minutes) };
  }
  // Yahoo can still say PRE for a moment after 09:30: count down to today's open, not tomorrow's.
  if ((state === "PRE" || state === "PREPRE") && clock.minutes < SESSION.close) {
    return { kind: "opens", minutes: Math.max(0, SESSION.open - clock.minutes) };
  }
  return { kind: "opens", minutes: minutesToOpen(state, clock) };
}

export interface DurationTemplates {
  /** e.g. "{d}d {h}h" */
  days: string;
  /** e.g. "{h}h {m}m" */
  hours: string;
  /** e.g. "{m}m" */
  minutes: string;
}

/** "1d 19h", "4h 31m" or "12m" (rounded up to whole minutes, at least 1). */
export function formatDuration(totalMinutes: number, templates: DurationTemplates): string {
  const total = Math.max(1, Math.ceil(totalMinutes));
  const d = Math.floor(total / DAY);
  const h = Math.floor((total % DAY) / 60);
  const m = total % 60;
  const fill = (template: string) => template.replace("{d}", String(d)).replace("{h}", String(h)).replace("{m}", String(m));
  if (d > 0) return fill(templates.days);
  if (h > 0) return fill(templates.hours);
  return fill(templates.minutes);
}

export type SegmentKind = "pre" | "regular" | "post";

export interface RibbonSegment {
  kind: SegmentKind;
  /** Start and width as fractions of the 04:00 to 20:00 window. */
  start: number;
  width: number;
  /** Share of the segment already elapsed (0 to 1). */
  elapsed: number;
}

export interface RibbonModel {
  /** Yahoo reports a live session (pre-market, regular or after hours). */
  open: boolean;
  segments: RibbonSegment[];
  /** Position of "now" in the window (0 to 1) while open; null when closed. */
  now: number | null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const SEGMENTS: ReadonlyArray<readonly [SegmentKind, number, number]> = [
  ["pre", SESSION.preOpen, SESSION.open],
  ["regular", SESSION.open, SESSION.close],
  ["post", SESSION.close, SESSION.postClose],
];

/** The ribbon under the top bar: 04:00 to 20:00 ET, with the elapsed part of each segment and a "now" tick. */
export function ribbonModel(state: MarketState | null, clock: EtClock): RibbonModel {
  const open = isTradingState(state);
  const span = SESSION.postClose - SESSION.preOpen;
  const segments = SEGMENTS.map(([kind, from, to]) => ({
    kind,
    start: (from - SESSION.preOpen) / span,
    width: (to - from) / span,
    elapsed: open ? clamp01((clock.minutes - from) / (to - from)) : 0,
  }));
  return { open, segments, now: open ? clamp01((clock.minutes - SESSION.preOpen) / span) : null };
}
