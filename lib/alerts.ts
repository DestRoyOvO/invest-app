// Local alerts: rule definitions, evaluation against quotes, the catch-up from daily bars and the two stores.
//
// There is no server side: no scheduler, push service or account. AlertEngine (components/alerts) evaluates the rules
// against fresh quotes while InvestSeek is open in a tab. When the investor comes back after a gap, it replays the
// daily highs and lows since each price rule was last checked, so a missed price alert is reported late instead of
// never. Everything here is pure except the stores, so the rules are tested without a browser.
//
// Firing rules
// - "once" fires one time and then waits until the investor re-arms it (editing a rule re-arms it).
// - "daily" fires at most once per session while its condition holds (the cooldown).
// - Event ids are deterministic (rule id plus the arming time or the session), so the same trigger seen twice, by a
//   live check and a catch-up or by two tabs, is logged once.

import type { ChartRange, Quote } from "@/types/api";

import { createLocalStore } from "./local-store";
import { normalizeSymbol } from "./symbols";

export const ALERT_KINDS = ["above", "below", "day_move", "pnl_from_cost", "earnings_within", "cross_ma200"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertRepeat = "once" | "daily";
export type MaSide = "above" | "below";

export interface AlertRule {
  /** Letters, digits, "-" and "_", at most 64 characters. */
  id: string;
  symbol: string;
  kind: AlertKind;
  /**
   * above / below: the price level. day_move: the size of the move in percent units, either direction (5 = up or
   * down 5% or more). pnl_from_cost: percent from the average cost, signed (-10 = a loss of 10% or more, 20 = a gain
   * of 20% or more). earnings_within: days before the report (0 = on the day). cross_ma200: null.
   */
  value: number | null;
  repeat: AlertRepeat;
  note: string;
  paused: boolean;
  createdAt: string;
  /** When the rule was created or last re-armed: a "once" rule fires at most once per arming. */
  armedAt: string;
  /** Last check: its time, the session it saw and that session's high and low so far (the catch-up baseline). */
  lastCheckedAt: string | null;
  checkedSession: string | null;
  checkedHigh: number | null;
  checkedLow: number | null;
  /** cross_ma200: the side of the 200-day average the price was on at the last check. */
  side: MaSide | null;
  lastTriggeredAt: string | null;
  /** Session (YYYY-MM-DD) of the last trigger: a daily rule fires at most once per session. */
  lastTriggeredSession: string | null;
  /** A "once" rule that fired and waits to be re-armed. */
  done: boolean;
  triggerCount: number;
}

/** A trigger, as kept in the alert log. The UI words it from these fields, so it follows the language setting. */
export interface AlertEvent {
  id: string;
  ruleId: string;
  symbol: string;
  kind: AlertKind;
  /** The rule's value when it fired. */
  value: number | null;
  /**
   * What was seen: the price (above, below, cross_ma200), the day change in percent (day_move), the P&L from cost
   * in percent (pnl_from_cost) or the days left before the report (earnings_within).
   */
  observed: number | null;
  /** above / below: the session high or low that reached the level between two checks, when the price itself did not. */
  extreme: number | null;
  /** cross_ma200: the 200-day average and the side the price crossed to. */
  reference: number | null;
  direction: MaSide | null;
  /** earnings_within: the report time (ISO) and whether the company has confirmed it. */
  eventDate: string | null;
  estimated: boolean;
  /** Found in daily bars after the fact: the first session that reached the level, its high or low, and how many sessions did. */
  missed: { session: string; extreme: number; sessions: number } | null;
  currency: string | null;
  note: string;
  at: string;
  seen: boolean;
}

export const ALERTS_STORAGE_KEY = "investseek:alerts:v1";
export const ALERT_LOG_STORAGE_KEY = "investseek:alert-log:v1";
export const MAX_ALERT_RULES = 100;
export const MAX_ALERT_EVENTS = 200;
export const MAX_ALERT_NOTE_CHARS = 200;
/** A price rule left unchecked this long (closed tab, sleep, throttled background tab) is replayed from daily bars first. */
export const CATCH_UP_AFTER_MS = 5 * 60_000;
/** Limits for each kind's value. */
export const VALUE_LIMITS: Record<Exclude<AlertKind, "cross_ma200">, { min: number; max: number }> = {
  above: { min: 0.000001, max: 1e9 },
  below: { min: 0.000001, max: 1e9 },
  day_move: { min: 0.1, max: 100 },
  pnl_from_cost: { min: -99.9, max: 10_000 },
  earnings_within: { min: 0, max: 90 },
};

const EMPTY_RULES: readonly AlertRule[] = [];
const EMPTY_LOG: readonly AlertEvent[] = [];
const DAY_MS = 86_400_000;
const EPSILON = 1e-9;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isSession(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** True when `value` is acceptable for a rule of this kind (cross_ma200 takes null). */
export function isValidRuleValue(kind: AlertKind, value: unknown): boolean {
  if (kind === "cross_ma200") return value === null || value === undefined;
  if (!isFiniteNumber(value)) return false;
  const { min, max } = VALUE_LIMITS[kind];
  if (value < min || value > max) return false;
  if (kind === "earnings_within") return Number.isInteger(value);
  if (kind === "pnl_from_cost") return Math.abs(value) >= 0.1;
  return true;
}

function sanitizeRule(raw: unknown): AlertRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && /^[\w-]{1,64}$/.test(r.id) ? r.id : null;
  const symbol = normalizeSymbol(r.symbol);
  const kind = (ALERT_KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as AlertKind) : null;
  if (!id || !symbol || !kind || !isIsoTime(r.createdAt) || !isValidRuleValue(kind, r.value)) return null;
  const count = isFiniteNumber(r.triggerCount) && r.triggerCount >= 0 ? Math.floor(r.triggerCount) : 0;
  return {
    id,
    symbol,
    kind,
    value: kind === "cross_ma200" ? null : (r.value as number),
    repeat: r.repeat === "daily" ? "daily" : "once",
    note: typeof r.note === "string" ? r.note.trim().slice(0, MAX_ALERT_NOTE_CHARS) : "",
    paused: r.paused === true,
    createdAt: r.createdAt,
    armedAt: isIsoTime(r.armedAt) ? r.armedAt : r.createdAt,
    lastCheckedAt: isIsoTime(r.lastCheckedAt) ? r.lastCheckedAt : null,
    checkedSession: isSession(r.checkedSession) ? r.checkedSession : null,
    checkedHigh: isPositive(r.checkedHigh) ? r.checkedHigh : null,
    checkedLow: isPositive(r.checkedLow) ? r.checkedLow : null,
    side: r.side === "above" || r.side === "below" ? r.side : null,
    lastTriggeredAt: isIsoTime(r.lastTriggeredAt) ? r.lastTriggeredAt : null,
    lastTriggeredSession: isSession(r.lastTriggeredSession) ? r.lastTriggeredSession : null,
    done: r.done === true,
    triggerCount: count,
  };
}

/** Turns stored or imported data into a valid rule list: invalid rules and duplicate ids dropped, at most MAX_ALERT_RULES. */
export function sanitizeRules(raw: unknown): readonly AlertRule[] {
  if (!Array.isArray(raw)) return EMPTY_RULES;
  const out: AlertRule[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    const rule = sanitizeRule(item);
    if (!rule || ids.has(rule.id)) continue;
    ids.add(rule.id);
    out.push(rule);
    if (out.length >= MAX_ALERT_RULES) break;
  }
  return out;
}

function sanitizeEvent(raw: unknown): AlertEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const symbol = normalizeSymbol(r.symbol);
  const kind = (ALERT_KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as AlertKind) : null;
  if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 120 || typeof r.ruleId !== "string" || !symbol || !kind || !isIsoTime(r.at)) return null;
  const m = r.missed as Record<string, unknown> | null | undefined;
  const missed =
    m && typeof m === "object" && isSession(m.session) && isPositive(m.extreme) && isFiniteNumber(m.sessions) && m.sessions >= 1
      ? { session: m.session, extreme: m.extreme, sessions: Math.floor(m.sessions) }
      : null;
  return {
    id: r.id,
    ruleId: r.ruleId.slice(0, 64),
    symbol,
    kind,
    value: isFiniteNumber(r.value) ? r.value : null,
    observed: isFiniteNumber(r.observed) ? r.observed : null,
    extreme: isPositive(r.extreme) ? r.extreme : null,
    reference: isPositive(r.reference) ? r.reference : null,
    direction: r.direction === "above" || r.direction === "below" ? r.direction : null,
    eventDate: isIsoTime(r.eventDate) ? r.eventDate : null,
    estimated: r.estimated === true,
    missed,
    currency: typeof r.currency === "string" && /^[A-Za-z]{2,5}$/.test(r.currency) ? r.currency : null,
    note: typeof r.note === "string" ? r.note.trim().slice(0, MAX_ALERT_NOTE_CHARS) : "",
    at: r.at,
    seen: r.seen === true,
  };
}

/** Turns stored or imported data into a valid alert log: newest first, unique ids, at most MAX_ALERT_EVENTS. */
export function sanitizeLog(raw: unknown): readonly AlertEvent[] {
  if (!Array.isArray(raw)) return EMPTY_LOG;
  const seen = new Set<string>();
  const out: AlertEvent[] = [];
  for (const item of raw) {
    const event = sanitizeEvent(item);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ALERT_EVENTS);
}

// ---------------------------------------------------------------------------
// Sessions and dates
// ---------------------------------------------------------------------------

/**
 * UTC calendar date (YYYY-MM-DD) of a time. Daily bars are stamped at UTC midnight of their session date, and the
 * last regular-session trade of US, European and Asian exchanges falls on its session date in UTC, so this one key
 * lines quotes up with bars.
 */
export function utcDate(time: number | string | Date): string | null {
  const date = time instanceof Date ? time : new Date(time);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** The session a quote belongs to: the UTC date of its last regular-session trade, or of `now` when that is unknown. */
export function sessionOf(quote: Pick<Quote, "regularMarketTime"> | null | undefined, now: Date): string {
  return (quote?.regularMarketTime ? utcDate(quote.regularMarketTime) : null) ?? (utcDate(now) as string);
}

const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

function nyDayNumber(date: Date): number {
  const [y, m, d] = NY_DATE.format(date).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Calendar days from today to a report time, both in New York (0 = the report is today). Null for a bad date. */
export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return nyDayNumber(date) - nyDayNumber(now);
}

// ---------------------------------------------------------------------------
// Evaluation against a quote
// ---------------------------------------------------------------------------

/** The quote fields the rules read. */
export type AlertQuote = Pick<
  Quote,
  "symbol" | "price" | "changePercent" | "dayHigh" | "dayLow" | "currency" | "regularMarketTime" | "nextEarningsDate" | "earningsDateEstimated" | "twoHundredDayAverage" | "stale"
>;

/** Positions by symbol (hooks/useHoldings.ts): shares and average cost per share. */
export type AlertHoldings = Readonly<Record<string, { shares: number; cost: number }>>;

/** Why a rule could not be checked against the latest quote. */
export type AlertUnavailable = "no_quote" | "stale" | "no_price" | "no_position" | "no_earnings_date" | "no_average";

/** Where a rule stands at a quote, before cooldowns: shared by the engine and the status column on /alerts. */
export interface AlertReading {
  /** The condition holds. For cross_ma200: the price is on the other side of the average than at the last check. */
  met: boolean;
  unavailable: AlertUnavailable | null;
  /** See AlertEvent.observed. */
  observed: number | null;
  /** above / below: met through a new session high or low between two checks rather than at the current price. */
  extreme: number | null;
  reference: number | null;
  side: MaSide | null;
  eventDate: string | null;
  estimated: boolean;
}

/** The outcome of one check: whether the rule fires, the fields to store and the event to log. */
export interface AlertCheck {
  met: boolean;
  fire: boolean;
  unavailable: AlertUnavailable | null;
  observed: number | null;
  patch: Partial<AlertRule>;
  event: AlertEvent | null;
}

const NO_READING: Omit<AlertReading, "unavailable"> = { met: false, observed: null, extreme: null, reference: null, side: null, eventDate: null, estimated: false };

function unavailable(reason: AlertUnavailable, observed: number | null = null): AlertReading {
  return { ...NO_READING, unavailable: reason, observed };
}

/** True when the rule is watching: not paused, and a "once" rule that has not fired yet. */
export function isActive(rule: Pick<AlertRule, "paused" | "repeat" | "done">): boolean {
  return !rule.paused && !(rule.repeat === "once" && rule.done);
}

/** Where a rule stands at this quote (no cooldown or arming logic). */
export function readRule(rule: AlertRule, quote: AlertQuote | null | undefined, holdings: AlertHoldings, now: Date): AlertReading {
  if (!quote) return unavailable("no_quote");
  if (quote.stale) return unavailable("stale");
  const price = quote.price;
  if (!isPositive(price)) return unavailable("no_price");
  const level = rule.value ?? 0;

  switch (rule.kind) {
    case "above":
    case "below": {
      const up = rule.kind === "above";
      if (up ? price >= level : price <= level) return { ...NO_READING, unavailable: null, met: true, observed: price };
      // Between two checks in one session, a new high (or low) that reached the level counts: polling every few
      // seconds, or less often in a background tab, can miss a brief touch, but the session range records it.
      const sameSession = rule.checkedSession !== null && rule.checkedSession === sessionOf(quote, now);
      const baseline = up ? rule.checkedHigh : rule.checkedLow;
      const extreme = up ? quote.dayHigh : quote.dayLow;
      const touched =
        sameSession && baseline !== null && isPositive(extreme) && (up ? extreme > baseline && extreme >= level : extreme < baseline && extreme <= level);
      return { ...NO_READING, unavailable: null, met: touched, observed: price, extreme: touched ? extreme : null };
    }
    case "day_move": {
      const change = quote.changePercent;
      if (!isFiniteNumber(change)) return unavailable("no_price");
      return { ...NO_READING, unavailable: null, met: Math.abs(change) >= level - EPSILON, observed: change };
    }
    case "pnl_from_cost": {
      const position = holdings[rule.symbol];
      if (!position || !isPositive(position.cost)) return unavailable("no_position");
      const pnl = ((price - position.cost) / position.cost) * 100;
      // A tolerance keeps "at" inclusive despite floating point (a 10% loss must meet a -10% rule).
      return { ...NO_READING, unavailable: null, met: level >= 0 ? pnl >= level - EPSILON : pnl <= level + EPSILON, observed: pnl };
    }
    case "earnings_within": {
      const days = daysUntil(quote.nextEarningsDate, now);
      if (days === null || days < 0) return unavailable("no_earnings_date");
      const estimated = quote.earningsDateEstimated === true;
      return { ...NO_READING, unavailable: null, met: days <= level, observed: days, eventDate: quote.nextEarningsDate, estimated };
    }
    case "cross_ma200": {
      const average = quote.twoHundredDayAverage;
      if (!isPositive(average)) return unavailable("no_average", price);
      const side: MaSide = price >= average ? "above" : "below";
      return { ...NO_READING, unavailable: null, met: rule.side !== null && rule.side !== side, observed: price, reference: average, side };
    }
  }
}

function eventId(rule: AlertRule, session: string): string {
  return rule.repeat === "once" ? `${rule.id}@${rule.armedAt}` : `${rule.id}@${session}`;
}

/** Whether a rule whose condition holds may fire in this session (paused, already fired, cooling down). */
export function canFire(rule: AlertRule, session: string): boolean {
  if (rule.paused) return false;
  return rule.repeat === "once" ? !rule.done : rule.lastTriggeredSession !== session;
}

function triggered(rule: AlertRule, session: string, now: Date): Partial<AlertRule> {
  return {
    lastTriggeredAt: now.toISOString(),
    lastTriggeredSession: session,
    triggerCount: rule.triggerCount + 1,
    done: rule.repeat === "once" ? true : rule.done,
  };
}

function makeEvent(rule: AlertRule, session: string, now: Date, fields: Partial<AlertEvent>): AlertEvent {
  return {
    id: eventId(rule, session),
    ruleId: rule.id,
    symbol: rule.symbol,
    kind: rule.kind,
    value: rule.value,
    observed: null,
    extreme: null,
    reference: null,
    direction: null,
    eventDate: null,
    estimated: false,
    missed: null,
    currency: null,
    note: rule.note,
    at: now.toISOString(),
    seen: false,
    ...fields,
  };
}

function minDefined(...values: Array<number | null | undefined>): number | null {
  const list = values.filter(isPositive);
  return list.length > 0 ? Math.min(...list) : null;
}

function maxDefined(...values: Array<number | null | undefined>): number | null {
  const list = values.filter(isPositive);
  return list.length > 0 ? Math.max(...list) : null;
}

/** The check bookkeeping after looking at a quote: time, session, and the session range seen so far. */
function checkpoint(rule: AlertRule, quote: AlertQuote, session: string, now: Date): Partial<AlertRule> {
  const same = rule.checkedSession === session;
  return {
    lastCheckedAt: now.toISOString(),
    checkedSession: session,
    checkedHigh: maxDefined(quote.dayHigh, quote.price, same ? rule.checkedHigh : null),
    checkedLow: minDefined(quote.dayLow, quote.price, same ? rule.checkedLow : null),
  };
}

/**
 * Checks one rule against a quote. Without a usable quote (missing, stale or without a price) nothing is stored, so
 * the time since the last real check keeps growing and the catch-up covers the gap later.
 */
export function evaluate(rule: AlertRule, quote: AlertQuote | null | undefined, holdings: AlertHoldings, now: Date): AlertCheck {
  const reading = readRule(rule, quote, holdings, now);
  if (!quote || reading.unavailable === "no_quote" || reading.unavailable === "stale" || reading.unavailable === "no_price") {
    return { met: false, fire: false, unavailable: reading.unavailable, observed: reading.observed, patch: {}, event: null };
  }
  const session = sessionOf(quote, now);
  const patch: Partial<AlertRule> = checkpoint(rule, quote, session, now);
  if (reading.side) patch.side = reading.side;
  const fire = reading.unavailable === null && reading.met && canFire(rule, session);
  if (!fire) return { met: reading.met, fire: false, unavailable: reading.unavailable, observed: reading.observed, patch, event: null };
  Object.assign(patch, triggered(rule, session, now));
  const event = makeEvent(rule, session, now, {
    observed: reading.observed,
    extreme: reading.extreme,
    reference: reading.reference,
    direction: rule.kind === "cross_ma200" ? reading.side : null,
    eventDate: reading.eventDate,
    estimated: reading.estimated,
    currency: quote.currency,
  });
  return { met: true, fire: true, unavailable: null, observed: reading.observed, patch, event };
}

// ---------------------------------------------------------------------------
// Catch-up from daily bars
// ---------------------------------------------------------------------------

/** A daily bar: t is UTC midnight of the session date (types/api.ts Bar). */
export interface AlertBar {
  t: number;
  h: number;
  l: number;
}

/** Only price levels can be replayed from daily highs and lows. */
export function canCatchUp(rule: Pick<AlertRule, "kind">): boolean {
  return rule.kind === "above" || rule.kind === "below";
}

function sinceOf(rule: AlertRule): string {
  return rule.lastCheckedAt ?? rule.armedAt;
}

/** An active price rule that went unchecked for longer than CATCH_UP_AFTER_MS. */
export function needsCatchUp(rule: AlertRule, now: Date): boolean {
  return canCatchUp(rule) && isActive(rule) && now.getTime() - Date.parse(sinceOf(rule)) > CATCH_UP_AFTER_MS;
}

/** The chart range whose daily bars cover the time since `since` (a gap longer than a year is replayed for the last year). */
export function catchUpRange(since: string, now: Date): ChartRange {
  const days = (now.getTime() - Date.parse(since)) / DAY_MS;
  if (!Number.isFinite(days) || days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  return days <= 180 ? "6mo" : "1y";
}

/**
 * Replays daily bars for a price rule. Sessions after the last check count in full; in the session of the last check
 * only a new high (or low) beyond the range seen at that check counts, and without such a baseline that session is
 * skipped rather than risk reporting a move from before the rule existed. Several qualifying sessions make one event
 * (the first session, plus the count); a daily rule skips sessions it already reported. The newest bar's range becomes
 * the new baseline, so the next live check picks up where the bars end.
 */
export function catchUp(rule: AlertRule, bars: readonly AlertBar[], now: Date, currency: string | null = null): AlertCheck {
  const nothing: AlertCheck = { met: false, fire: false, unavailable: null, observed: null, patch: {}, event: null };
  if (!canCatchUp(rule) || !isActive(rule) || rule.value === null) return nothing;
  const level = rule.value;
  const up = rule.kind === "above";
  const sinceSession = rule.checkedSession ?? utcDate(sinceOf(rule)) ?? "";
  const sorted = bars.filter((b) => isFiniteNumber(b.t) && isPositive(b.h) && isPositive(b.l)).sort((a, b) => a.t - b.t);

  const hits: Array<{ session: string; extreme: number }> = [];
  for (const bar of sorted) {
    const session = utcDate(bar.t);
    if (!session || session < sinceSession) continue;
    const extreme = up ? bar.h : bar.l;
    if (up ? extreme < level : extreme > level) continue;
    if (session === sinceSession) {
      const baseline = rule.checkedSession === session ? (up ? rule.checkedHigh : rule.checkedLow) : null;
      if (baseline === null || (up ? extreme <= baseline : extreme >= baseline)) continue;
    }
    if (rule.repeat === "daily" && rule.lastTriggeredSession !== null && session <= rule.lastTriggeredSession) continue;
    hits.push({ session, extreme });
  }

  const patch: Partial<AlertRule> = { lastCheckedAt: now.toISOString() };
  const last = sorted[sorted.length - 1];
  const lastSession = last ? utcDate(last.t) : null;
  if (last && lastSession && lastSession >= (rule.checkedSession ?? "")) {
    const same = lastSession === rule.checkedSession;
    patch.checkedSession = lastSession;
    patch.checkedHigh = maxDefined(last.h, same ? rule.checkedHigh : null);
    patch.checkedLow = minDefined(last.l, same ? rule.checkedLow : null);
  }
  if (hits.length === 0) return { ...nothing, patch };

  const first = hits[0];
  const latest = hits[hits.length - 1];
  Object.assign(patch, triggered(rule, latest.session, now));
  const event = makeEvent(rule, latest.session, now, {
    observed: first.extreme,
    extreme: first.extreme,
    missed: { session: first.session, extreme: first.extreme, sessions: hits.length },
    currency,
  });
  return { met: true, fire: true, unavailable: null, observed: first.extreme, patch, event };
}

// ---------------------------------------------------------------------------
// One engine pass
// ---------------------------------------------------------------------------

export interface CheckPlan {
  /** Fields to store per rule id. */
  patches: Map<string, Partial<AlertRule>>;
  events: AlertEvent[];
  /** Symbols whose price rules need a replay from daily bars first, with the range to load. */
  catchUps: Array<{ symbol: string; range: ChartRange }>;
}

export interface PlanOptions {
  /** Symbols whose replay is loading: their price rules wait for it instead of being checked live. */
  catchingUp?: ReadonlySet<string>;
  /** Rule ids whose replay failed for good: checked live from now on. */
  skipCatchUp?: ReadonlySet<string>;
}

/** One pass of the engine over the active rules: live checks, plus the replays to run first. */
export function planChecks(
  rules: readonly AlertRule[],
  quotes: ReadonlyMap<string, AlertQuote>,
  holdings: AlertHoldings,
  now: Date,
  { catchingUp, skipCatchUp }: PlanOptions = {},
): CheckPlan {
  const patches = new Map<string, Partial<AlertRule>>();
  const events: AlertEvent[] = [];
  const replay = new Map<string, string>();
  for (const rule of rules) {
    if (!isActive(rule)) continue;
    if (canCatchUp(rule) && catchingUp?.has(rule.symbol)) continue;
    if (needsCatchUp(rule, now) && !skipCatchUp?.has(rule.id)) {
      const since = sinceOf(rule);
      const earliest = replay.get(rule.symbol);
      if (!earliest || since < earliest) replay.set(rule.symbol, since);
      continue;
    }
    const check = evaluate(rule, quotes.get(rule.symbol), holdings, now);
    if (Object.keys(check.patch).length > 0) patches.set(rule.id, check.patch);
    if (check.event) events.push(check.event);
  }
  const catchUps = [...replay.entries()].map(([symbol, since]) => ({ symbol, range: catchUpRange(since, now) }));
  return { patches, events, catchUps };
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export const alertsStore = createLocalStore<readonly AlertRule[]>({ key: ALERTS_STORAGE_KEY, sanitize: sanitizeRules, empty: EMPTY_RULES });
export const alertLogStore = createLocalStore<readonly AlertEvent[]>({ key: ALERT_LOG_STORAGE_KEY, sanitize: sanitizeLog, empty: EMPTY_LOG });

export interface AlertRuleInput {
  symbol: string;
  kind: AlertKind;
  value: number | null;
  repeat: AlertRepeat;
  note?: string;
}

/** What the editor saw when the rule was saved: the starting point for touch detection, the catch-up and crosses. */
export interface AlertBaseline {
  session: string;
  high: number | null;
  low: number | null;
  side: MaSide | null;
}

/** The baseline from a fresh quote, or null when the quote is missing, stale or has no price. */
export function baselineFromQuote(quote: AlertQuote | null | undefined, now: Date): AlertBaseline | null {
  if (!quote || quote.stale || !isPositive(quote.price)) return null;
  const average = quote.twoHundredDayAverage;
  return {
    session: sessionOf(quote, now),
    high: maxDefined(quote.dayHigh, quote.price),
    low: minDefined(quote.dayLow, quote.price),
    side: isPositive(average) ? (quote.price >= average ? "above" : "below") : null,
  };
}

export type RuleInputError = "symbol" | "value";

/** The first problem with a rule as entered, or null when it can be saved. */
export function validateRuleInput(input: AlertRuleInput): RuleInputError | null {
  if (!normalizeSymbol(input.symbol)) return "symbol";
  if (!isValidRuleValue(input.kind, input.kind === "cross_ma200" ? null : input.value)) return "value";
  return null;
}

/** A random id for a new rule. */
export function newAlertId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return random.slice(0, 24);
}

/** Rule state after creating, editing or re-arming: a fresh watch that starts at the baseline, if there is one. */
function armed(rule: AlertRule, baseline: AlertBaseline | null, now: Date): AlertRule {
  return {
    ...rule,
    armedAt: now.toISOString(),
    done: false,
    lastTriggeredSession: null,
    lastCheckedAt: baseline ? now.toISOString() : null,
    checkedSession: baseline?.session ?? null,
    checkedHigh: baseline?.high ?? null,
    checkedLow: baseline?.low ?? null,
    side: baseline?.side ?? null,
  };
}

function cleanNote(note: string | undefined): string {
  return (note ?? "").trim().slice(0, MAX_ALERT_NOTE_CHARS);
}

/** A new rule from valid input (see validateRuleInput). */
export function createRule(input: AlertRuleInput, now: Date, baseline: AlertBaseline | null = null, id: string = newAlertId()): AlertRule {
  const rule: AlertRule = {
    id,
    symbol: normalizeSymbol(input.symbol) ?? input.symbol,
    kind: input.kind,
    value: input.kind === "cross_ma200" ? null : input.value,
    repeat: input.repeat,
    note: cleanNote(input.note),
    paused: false,
    createdAt: now.toISOString(),
    armedAt: now.toISOString(),
    lastCheckedAt: null,
    checkedSession: null,
    checkedHigh: null,
    checkedLow: null,
    side: null,
    lastTriggeredAt: null,
    lastTriggeredSession: null,
    done: false,
    triggerCount: 0,
  };
  return armed(rule, baseline, now);
}

export type AddRuleResult = { status: "added"; rule: AlertRule } | { status: "full" } | { status: "invalid"; error: RuleInputError };

interface WriteOptions {
  now?: Date;
  baseline?: AlertBaseline | null;
}

/** Adds a rule unless the input is invalid or MAX_ALERT_RULES rules exist. */
export function addAlertRule(input: AlertRuleInput, { now = new Date(), baseline = null, id }: WriteOptions & { id?: string } = {}): AddRuleResult {
  const error = validateRuleInput(input);
  if (error) return { status: "invalid", error };
  let result: AddRuleResult = { status: "full" };
  alertsStore.update((rules) => {
    if (rules.length >= MAX_ALERT_RULES) return rules;
    const rule = createRule(input, now, baseline, id);
    result = { status: "added", rule };
    return [...rules, rule];
  });
  return result;
}

/**
 * Changes a rule. A changed condition (symbol, kind, value or repeat) re-arms it, a fresh watch from now; a changed
 * note alone keeps its state, so saving the editor without touching the condition never makes a rule fire again.
 * Returns the input error, "missing", or null when saved.
 */
export function updateAlertRule(id: string, input: AlertRuleInput, { now = new Date(), baseline = null }: WriteOptions = {}): RuleInputError | "missing" | null {
  const error = validateRuleInput(input);
  if (error) return error;
  let found = false;
  alertsStore.update((rules) =>
    rules.map((rule) => {
      if (rule.id !== id) return rule;
      found = true;
      const changed: AlertRule = {
        ...rule,
        symbol: normalizeSymbol(input.symbol) ?? rule.symbol,
        kind: input.kind,
        value: input.kind === "cross_ma200" ? null : input.value,
        repeat: input.repeat,
        note: cleanNote(input.note),
      };
      const sameCondition = changed.symbol === rule.symbol && changed.kind === rule.kind && changed.value === rule.value && changed.repeat === rule.repeat;
      return sameCondition ? changed : armed(changed, baseline, now);
    }),
  );
  return found ? null : "missing";
}

/** Pauses or resumes a rule. Resuming starts a fresh watch, so nothing from the paused stretch is reported. */
export function setAlertPaused(id: string, paused: boolean, now = new Date()): void {
  alertsStore.update((rules) =>
    rules.map((rule) => {
      if (rule.id !== id || rule.paused === paused) return rule;
      if (paused) return { ...rule, paused: true };
      return { ...rule, paused: false, lastCheckedAt: now.toISOString(), checkedSession: null, checkedHigh: null, checkedLow: null, side: null };
    }),
  );
}

/** Arms a "once" rule that fired, so it can fire again. */
export function rearmAlertRule(id: string, now = new Date(), baseline: AlertBaseline | null = null): void {
  alertsStore.update((rules) => rules.map((rule) => (rule.id === id ? armed(rule, baseline, now) : rule)));
}

/** Removes a rule and returns it with its position, so an Undo can put it back. */
export function removeAlertRule(id: string): { rule: AlertRule; index: number } | null {
  let removed: { rule: AlertRule; index: number } | null = null;
  alertsStore.update((rules) => {
    const index = rules.findIndex((rule) => rule.id === id);
    if (index < 0) return rules;
    removed = { rule: rules[index], index };
    return rules.filter((rule) => rule.id !== id);
  });
  return removed;
}

/** Puts a removed rule back at its old position (the Undo of removeAlertRule). */
export function restoreAlertRule(rule: AlertRule, index: number): void {
  alertsStore.update((rules) => {
    if (rules.some((r) => r.id === rule.id) || rules.length >= MAX_ALERT_RULES) return rules;
    const next = [...rules];
    next.splice(Math.min(Math.max(index, 0), next.length), 0, rule);
    return next;
  });
}

/**
 * Stores the engine's check results. A patch is dropped when its rule was deleted meanwhile, or re-armed (edited)
 * after the check that produced it, when `armedAt` gives the arming time each check saw.
 */
export function applyAlertPatches(patches: ReadonlyMap<string, Partial<AlertRule>>, armedAt?: ReadonlyMap<string, string>): void {
  if (patches.size === 0) return;
  alertsStore.update((rules) =>
    rules.map((rule) => {
      const patch = patches.get(rule.id);
      if (!patch) return rule;
      const seen = armedAt?.get(rule.id);
      if (seen !== undefined && seen !== rule.armedAt) return rule;
      return { ...rule, ...patch, id: rule.id };
    }),
  );
}

/** Adds events to the log, newest first and capped; an id already logged is skipped. Returns the events added. */
export function recordAlertEvents(events: readonly AlertEvent[]): AlertEvent[] {
  if (events.length === 0) return [];
  let added: AlertEvent[] = [];
  alertLogStore.update((log) => {
    const ids = new Set(log.map((event) => event.id));
    added = events.filter((event) => {
      if (ids.has(event.id)) return false;
      ids.add(event.id);
      return true;
    });
    if (added.length === 0) return log;
    return [...added, ...log].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ALERT_EVENTS);
  });
  return added;
}

/** Marks events as seen (all of them without ids). */
export function markAlertEventsSeen(ids?: readonly string[]): void {
  const pick = ids ? new Set(ids) : null;
  alertLogStore.update((log) => {
    let changed = false;
    const next = log.map((event) => {
      if (event.seen || (pick && !pick.has(event.id))) return event;
      changed = true;
      return { ...event, seen: true };
    });
    return changed ? next : log;
  });
}

/** Empties the log and returns what it held, for an Undo. */
export function clearAlertLog(): readonly AlertEvent[] {
  const before = alertLogStore.getSnapshot();
  alertLogStore.write(EMPTY_LOG);
  return before;
}

/** Puts cleared events back (merged with anything logged since). */
export function restoreAlertLog(events: readonly AlertEvent[]): void {
  alertLogStore.update((log) => sanitizeLog([...log, ...events]));
}

export function unseenCount(log: readonly AlertEvent[]): number {
  return log.reduce((n, event) => n + (event.seen ? 0 : 1), 0);
}

// ---------------------------------------------------------------------------
// Status for lists
// ---------------------------------------------------------------------------

export type RuleStatus = "paused" | "triggered" | "unavailable" | "met" | "watching";

/**
 * A rule's state for the rules table: paused, a "once" rule that fired (triggered), a rule that cannot be checked
 * (unavailable, with the reason in `reading`), a condition that holds now (met: it fires or already fired this
 * session), or watching.
 */
export function ruleStatus(rule: AlertRule, quote: AlertQuote | null | undefined, holdings: AlertHoldings, now: Date): { status: RuleStatus; reading: AlertReading | null } {
  if (rule.paused) return { status: "paused", reading: null };
  if (rule.repeat === "once" && rule.done) return { status: "triggered", reading: null };
  if (!quote) return { status: "watching", reading: null };
  const reading = readRule(rule, quote, holdings, now);
  if (reading.unavailable === "no_position" || reading.unavailable === "no_earnings_date" || reading.unavailable === "no_average") return { status: "unavailable", reading };
  return { status: reading.met && reading.extreme === null ? "met" : "watching", reading };
}
