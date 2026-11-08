import "server-only";

import { yieldOn } from "./curve";
import { gaussian, normalFrom, prng, seedOf } from "./random";
import { securityOf, type Security } from "./securities";
import {
  DAY_MS,
  dailyStamp,
  dayNumber,
  isTradingDay,
  localToUtc,
  localToUtcExact,
  nextTradingDay,
  parseDayKey,
  previousTradingDay,
  tradingDaysBetween,
  weekdayOf,
  yearOf,
} from "./sessions";

// Price series of the fixture data. A walk's close on a day is its anchor price (the level on 2026-01-02) times the
// compounded daily returns between the anchor and that day (before the anchor, without the volatility drag and kept
// within 20 times the anchor price either way, so volatile histories stay plausible); each return mixes a market
// factor (seeded by the date), a sector factor (seeded by sector and date) and the security's own noise (seeded by
// symbol and date). So a bar for a given session is the same on every run and every day, stocks move together with
// their sector and the index, and a fund that tracks an index moves exactly like it. ^VIX mean-reverts around its
// level, Treasury yields come from the curve model (curve.ts). Intraday bars are drawn inside their daily bar: they
// open at its open, close at its close and touch its high and low.

/** The day whose close equals each security's anchor price. A trading day on every calendar. */
export const ANCHOR_DAY = parseDayKey("2026-01-02");

export interface DailyRow {
  day: number;
  /** Yahoo's timestamp of the bar (the session open for exchanges, local midnight for round-the-clock markets). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface IntradayRow {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// ---------------------------------------------------------------------------
// Factors and returns
// ---------------------------------------------------------------------------

const marketFactors = new Map<number, number>();
const sectorFactors = new Map<string, number>();

/** Seed of the market factor, picked once among a few for an ordinary-looking 2026 (no 30% swings in the index). */
const MARKET_FACTOR_KEY = "market-c";

function marketZ(day: number): number {
  let z = marketFactors.get(day);
  if (z === undefined) {
    z = gaussian("factor", MARKET_FACTOR_KEY, day);
    marketFactors.set(day, z);
  }
  return z;
}

function sectorZ(sector: string, day: number): number {
  const key = `${sector}|${day}`;
  let z = sectorFactors.get(key);
  if (z === undefined) {
    z = gaussian("factor", sector, day);
    sectorFactors.set(key, z);
  }
  return z;
}

export function dailyVol(security: Security): number {
  return security.vol / Math.sqrt(security.profile.periodsPerYear);
}

/** The standardized move of a day: the factor mix, unit variance. */
function dailyShock(security: Security, day: number): number {
  const market = security.marketLoading;
  const sector = security.sectorKey ? security.sectorLoading : 0;
  const own = Math.sqrt(Math.max(0, 1 - market * market - sector * sector));
  return market * marketZ(day) + (sector && security.sectorKey ? sector * sectorZ(security.sectorKey, day) : 0) + own * gaussian(security.seedKey, day);
}

/** A day's log return after the anchor: drift, the volatility drag of a geometric walk and the day's shock. */
function walkReturn(security: Security, day: number): number {
  const sd = dailyVol(security);
  return security.drift / security.profile.periodsPerYear - 0.5 * sd * sd + sd * dailyShock(security, day);
}

/**
 * A day's log return up to the anchor, which the walk takes back in time. Without the volatility drag: subtracting
 * it on the way back would make a volatile stock's history grow exponentially (a 0.8 volatility adds 32% a year).
 */
function backwardReturn(security: Security, day: number): number {
  return security.drift / security.profile.periodsPerYear + dailyVol(security) * dailyShock(security, day);
}

/** How far before the anchor a walk may stray from its anchor price: 20 times up or down, approached smoothly. */
const MAX_LOG_DEVIATION = Math.log(20);

/** Maps a log deviation from the anchor into ±MAX_LOG_DEVIATION, unchanged near zero (tanh). */
function squash(deviation: number): number {
  return MAX_LOG_DEVIATION * Math.tanh(deviation / MAX_LOG_DEVIATION);
}

/** Unbounded log deviation from the anchor at the end of a day before it: minus the returns after it, up to the anchor. */
function backwardDeviation(security: Security, day: number): number {
  let sum = 0;
  for (let d = day + 1; d <= ANCHOR_DAY; d++) if (isTradingDay(security.profile, d)) sum -= backwardReturn(security, d);
  return sum;
}

/** Log close of a walk at the end of `day` (any day: before the first bar it is the level the first bar starts from). */
function walkLogClose(security: Security, day: number): number {
  const anchor = Math.log(security.anchorPrice);
  if (day < ANCHOR_DAY) return anchor + squash(backwardDeviation(security, day));
  let sum = 0;
  for (let d = ANCHOR_DAY + 1; d <= day; d++) if (isTradingDay(security.profile, d)) sum += walkReturn(security, d);
  return anchor + sum;
}

/** Per-session pull of ^VIX towards its level. */
const VIX_REVERSION = 0.06;

const vixSeries = new Map<string, { days: number[]; logs: number[] }>();

/** Log level of a mean-reverting series on the latest trading day on or before `day`. */
function vixLog(security: Security, day: number): number {
  const mean = Math.log(security.anchorPrice);
  if (day < security.profile.epoch) return mean;
  let memo = vixSeries.get(security.symbol);
  if (!memo) {
    memo = { days: [], logs: [] };
    vixSeries.set(security.symbol, memo);
  }
  const last = memo.days.at(-1) ?? security.profile.epoch - 1;
  if (last < day) {
    let x = memo.logs.at(-1) ?? mean;
    const sd = dailyVol(security);
    for (let d = last + 1; d <= day; d++) {
      if (!isTradingDay(security.profile, d)) continue;
      x += VIX_REVERSION * (mean - x) + sd * dailyShock(security, d);
      memo.days.push(d);
      memo.logs.push(x);
    }
  }
  let lo = 0;
  let hi = memo.days.length - 1;
  if (hi < 0 || memo.days[0] > day) return mean;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (memo.days[mid] <= day) lo = mid;
    else hi = mid - 1;
  }
  return memo.logs[lo];
}

/**
 * The ICE US Dollar Index: 50.14348112 × EURUSD^-0.576 × USDJPY^0.136 × GBPUSD^-0.119 × USDCAD^0.091 × USDSEK^0.042 ×
 * USDCHF^0.036, with Yahoo's symbols of the six currencies.
 */
export const DOLLAR_INDEX: { factor: number; weights: ReadonlyArray<readonly [symbol: string, weight: number]> } = {
  factor: 50.14348112,
  weights: [
    ["EURUSD=X", -0.576],
    ["USDJPY=X", 0.136],
    ["GBPUSD=X", -0.119],
    ["CAD=X", 0.091],
    ["SEK=X", 0.042],
    ["CHF=X", 0.036],
  ],
};

/** Raw closes of `security` on each of `days` (ascending): the close of its latest trading day on or before the day. */
function closesOn(security: Security, days: readonly number[]): number[] {
  const own = tradingDaysBetween(security.profile, days[0], days[days.length - 1]);
  if (own.length === 0) own.push(nextTradingDay(security.profile, Math.max(days[days.length - 1], security.profile.epoch - 1)));
  const { previous, closes } = rawCloses(security, own);
  let at = -1;
  return days.map((day) => {
    while (at + 1 < own.length && own[at + 1] <= day) at++;
    return at < 0 ? previous : closes[at];
  });
}

/**
 * Raw closes of the dollar index (DOLLAR_INDEX) for consecutive trading days, and the close of the trading day before
 * the first, from the currency walks' closes of the same days: the index follows its currencies.
 */
function dollarIndexCloses(security: Security, days: readonly number[]): { previous: number; closes: number[] } {
  const wanted = [previousTradingDay(security.profile, days[0]), ...days];
  const logs = wanted.map(() => Math.log(DOLLAR_INDEX.factor));
  for (const [symbol, weight] of DOLLAR_INDEX.weights) {
    const currency = securityOf(symbol);
    if (!currency) throw new Error(`The fixture data has no ${symbol}.`);
    closesOn(currency, wanted).forEach((close, i) => (logs[i] += weight * Math.log(close)));
  }
  const [previous, ...closes] = logs.map(Math.exp);
  return { previous, closes };
}

/** Raw (unrounded) closes for consecutive trading days, and the close of the trading day before the first. */
function rawCloses(security: Security, days: readonly number[]): { previous: number; closes: number[] } {
  const before = previousTradingDay(security.profile, days[0]);
  if (security.model === "rate") {
    const years = security.tenorYears ?? 10;
    return { previous: yieldOn(before, years), closes: days.map((day) => yieldOn(day, years)) };
  }
  if (security.model === "vix") {
    return { previous: Math.exp(vixLog(security, before)), closes: days.map((day) => Math.exp(vixLog(security, day))) };
  }
  if (security.model === "dollar-index") return dollarIndexCloses(security, days);
  // Up to the anchor the walk runs on its (squashed) deviation from the anchor price, after it on compounded returns.
  const anchor = Math.log(security.anchorPrice);
  let deviation = before < ANCHOR_DAY ? backwardDeviation(security, before) : 0;
  let log = before < ANCHOR_DAY ? anchor : walkLogClose(security, before);
  const previous = Math.exp(before < ANCHOR_DAY ? anchor + squash(deviation) : log);
  const closes = days.map((day) => {
    if (day <= ANCHOR_DAY) {
      deviation += backwardReturn(security, day);
      return Math.exp(anchor + squash(deviation));
    }
    log += walkReturn(security, day);
    return Math.exp(log);
  });
  return { previous, closes };
}

// ---------------------------------------------------------------------------
// Daily bars
// ---------------------------------------------------------------------------

/** Decimals Yahoo prints for a price (its priceHint). */
export function priceDigits(security: Security, price: number): number {
  if (security.type === "CURRENCY") return price > 20 ? 3 : 4;
  if (security.model === "rate") return 3;
  if (price < 1) return 4;
  if (security.type === "FUTURE" && price < 10) return 4;
  return 2;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Markets that trade around the clock open where they closed: no overnight gap. */
function continuous(security: Security): boolean {
  return security.profile.close - security.profile.open >= 23 * 60;
}

function dailyBar(security: Security, day: number, previous: number, close: number): DailyRow {
  const sd = dailyVol(security);
  const gap = continuous(security) ? 0 : sd * 0.3 * gaussian(security.symbol, day, "gap");
  const open = previous * Math.exp(gap);
  const up = sd * (0.12 + 0.45 * Math.abs(gaussian(security.symbol, day, "high")));
  const down = sd * (0.12 + 0.45 * Math.abs(gaussian(security.symbol, day, "low")));
  const digits = priceDigits(security, close);
  const o = roundTo(open, digits);
  const c = roundTo(close, digits);
  const h = Math.max(roundTo(Math.max(open, close) * Math.exp(up), digits), o, c);
  const l = Math.min(roundTo(Math.min(open, close) * Math.exp(-down), digits), o, c);
  const move = Math.abs(Math.log(close / previous)) / (sd || 1);
  const v = security.baseVolume > 0 ? Math.round(security.baseVolume * Math.exp(0.3 * gaussian(security.symbol, day, "volume")) * (0.75 + 0.3 * Math.min(move, 4))) : 0;
  return { day, t: dailyStamp(security.profile, day), o, h, l, c, v };
}

const rowCache = new Map<string, readonly DailyRow[]>();
let cachedRows = 0;
/**
 * The cache keeps at most this many rows in all (about 90 bytes each, so some 20 MB) and this many windows: a client
 * asking for the full history of many synthetic symbols evicts old windows instead of growing the process.
 */
const MAX_CACHED_ROWS = 250_000;
const MAX_CACHED_WINDOWS = 2_000;

function cacheRows(key: string, rows: readonly DailyRow[]): void {
  rowCache.set(key, rows);
  cachedRows += rows.length;
  while ((cachedRows > MAX_CACHED_ROWS || rowCache.size > MAX_CACHED_WINDOWS) && rowCache.size > 1) {
    const oldest = rowCache.keys().next().value as string;
    cachedRows -= rowCache.get(oldest)?.length ?? 0;
    rowCache.delete(oldest);
  }
}

/**
 * Daily bars of the trading days in [from, to] (day numbers). Callers pass `to` no later than the latest completed
 * session; before the security's first trading day there are no bars.
 */
export function dailyRows(security: Security, from: number, to: number): readonly DailyRow[] {
  const key = `${security.symbol}|${from}|${to}`;
  const hit = rowCache.get(key);
  if (hit) return hit;
  const days = tradingDaysBetween(security.profile, from, to);
  let rows: DailyRow[] = [];
  if (days.length > 0) {
    const { previous, closes } = rawCloses(security, days);
    rows = days.map((day, i) => dailyBar(security, day, i === 0 ? previous : closes[i - 1], closes[i]));
  }
  cacheRows(key, rows);
  return rows;
}

/** The close of the trading day before `day`, rounded like a bar's close (the baseline of the first bar). */
export function closeBefore(security: Security, day: number): number | null {
  const before = previousTradingDay(security.profile, day);
  if (before < security.profile.epoch) return null;
  const rows = dailyRows(security, before, before);
  return rows[0]?.c ?? null;
}

export type Period = "1wk" | "1mo" | "3mo" | "5d";

function periodStart(day: number, period: Period): number {
  if (period === "1wk") return day - ((weekdayOf(day) + 6) % 7);
  const date = new Date(day * DAY_MS);
  const month = period === "3mo" ? Math.floor(date.getUTCMonth() / 3) * 3 : date.getUTCMonth();
  return dayNumber(date.getUTCFullYear(), month + 1, 1);
}

/**
 * Weekly, monthly or quarterly bars from daily ones: first open, highest high, lowest low, last close and the summed
 * volume, stamped at local midnight of the period's first day (Monday, the 1st), as Yahoo stamps them. "5d" groups
 * five sessions at a time.
 */
export function aggregateRows(security: Security, rows: readonly DailyRow[], period: Period): DailyRow[] {
  const out: DailyRow[] = [];
  let currentKey: number | null = null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const key = period === "5d" ? Math.floor(index / 5) : periodStart(row.day, period);
    const current = out.at(-1);
    if (current && key === currentKey) {
      current.h = Math.max(current.h, row.h);
      current.l = Math.min(current.l, row.l);
      current.c = row.c;
      current.v += row.v;
      continue;
    }
    const start = period === "5d" ? row.day : key;
    out.push({ day: start, t: period === "5d" ? row.t : localToUtcExact(security.profile.timeZone, start, 0), o: row.o, h: row.h, l: row.l, c: row.c, v: row.v });
    currentKey = key;
  }
  return out;
}

/** The last trading day of the year before `day`'s year (the base of year-to-date returns). */
export function lastDayOfPreviousYear(security: Security, day: number): number {
  return previousTradingDay(security.profile, dayNumber(yearOf(day), 1, 1));
}

// ---------------------------------------------------------------------------
// Intraday bars
// ---------------------------------------------------------------------------

interface MinuteBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** A Brownian bridge from v0 to v1 over `steps` minutes, written into path[from..from+steps]. */
function bridge(path: Float64Array, from: number, steps: number, v0: number, v1: number, scale: number, next: () => number): void {
  const walk = [0];
  for (let j = 1; j <= steps; j++) walk.push(walk[j - 1] + normalFrom(next));
  const end = walk[steps];
  for (let j = 0; j <= steps; j++) path[from + j] = v0 + ((v1 - v0) * j) / steps + scale * (walk[j] - (end * j) / steps);
}

/** One-minute bars of a regular session inside the daily bar: open, close, high and low match it exactly. */
function regularMinutes(security: Security, bar: DailyRow, minutes: number): MinuteBar[] {
  const next = prng(seedOf(security.symbol, bar.day, "intraday"));
  let highAt = 1 + Math.floor(next() * (minutes - 1));
  let lowAt = 1 + Math.floor(next() * (minutes - 1));
  if (lowAt === highAt) lowAt = highAt + (highAt < minutes / 2 ? Math.floor(minutes / 3) : -Math.floor(minutes / 3));
  highAt = Math.min(Math.max(highAt, 1), minutes - 1);
  lowAt = Math.min(Math.max(lowAt, 1), minutes - 1);
  const anchors: Array<[number, number]> = [
    [0, bar.o],
    [highAt, bar.h],
    [lowAt, bar.l],
    [minutes, bar.c],
  ];
  anchors.sort((a, b) => a[0] - b[0]);
  const path = new Float64Array(minutes + 1);
  const scale = (bar.c * dailyVol(security) * 0.8) / Math.sqrt(minutes);
  for (let i = 0; i + 1 < anchors.length; i++) {
    const [from, v0] = anchors[i];
    const [to, v1] = anchors[i + 1];
    if (to > from) bridge(path, from, to - from, v0, v1, scale, next);
  }
  for (let k = 1; k < minutes; k++) path[k] = Math.min(bar.h, Math.max(bar.l, path[k]));
  for (const [at, value] of anchors) path[at] = value;

  const flat = continuous(security);
  const weights: number[] = [];
  for (let k = 0; k < minutes; k++) {
    const x = (k - minutes / 2) / (minutes / 2);
    weights.push((flat ? 1 : 1 + 1.6 * x * x) * (0.6 + 0.8 * next()));
  }
  const total = weights.reduce((sum, w) => sum + w, 0);
  const bars: MinuteBar[] = [];
  for (let k = 0; k < minutes; k++) {
    const o = path[k];
    const c = path[k + 1];
    const wick = scale * 0.3;
    bars.push({
      o,
      c,
      h: Math.min(bar.h, Math.max(o, c) + wick * Math.abs(normalFrom(next))),
      l: Math.max(bar.l, Math.min(o, c) - wick * Math.abs(normalFrom(next))),
      v: (bar.v * weights[k]) / total,
    });
  }
  return bars;
}

export type ExtendedSession = "pre" | "post";

/**
 * True for listings that trade before and after the session: US stocks and funds. Indices, yields and the VIX follow
 * the US calendar but have no extended-hours prices, as on Yahoo (hasPrePostMarketData false).
 */
export function hasExtendedHours(security: Security): boolean {
  return security.profile.pre !== null && security.profile.post !== null && (security.type === "EQUITY" || security.type === "ETF");
}

/**
 * Thin extended-hours trading of a US listing on the day of `bar`: a quiet bridge from the previous close to the open
 * (pre-market) or a quiet walk from the close (after hours), one point per minute, plus the generator that continues
 * with the minutes' volumes.
 */
function extendedWalk(security: Security, bar: DailyRow, session: ExtendedSession, previousClose: number): { path: Float64Array; next: () => number } | null {
  const profile = security.profile;
  if (profile.pre === null || profile.post === null) return null;
  const minutes = session === "pre" ? profile.open - profile.pre : profile.post - profile.close;
  const next = prng(seedOf(security.symbol, bar.day, session));
  const path = new Float64Array(minutes + 1);
  const scale = (bar.c * dailyVol(security) * 0.25) / Math.sqrt(minutes);
  if (session === "pre") bridge(path, 0, minutes, previousClose, bar.o, scale, next);
  else {
    path[0] = bar.c;
    for (let k = 1; k <= minutes; k++) path[k] = path[k - 1] + scale * normalFrom(next);
  }
  return { path, next };
}

/**
 * The unrounded price `k` minutes into the pre-market (from `previousClose` to the open of `bar`) or the after-hours
 * session (from the close of `bar`) of a US listing, for k from 0 to the session's length: the path the intraday bars
 * are cut from, so the quote's extended-hours trade matches the chart. Empty for markets without extended hours.
 */
export function extendedPath(security: Security, bar: DailyRow, session: ExtendedSession, previousClose: number): Float64Array {
  return extendedWalk(security, bar, session, previousClose)?.path ?? new Float64Array(0);
}

/** One-minute bars of an extended session, carrying `volume` in total. */
function extendedMinutes(security: Security, bar: DailyRow, session: ExtendedSession, previousClose: number, volume: number): MinuteBar[] {
  const walk = extendedWalk(security, bar, session, previousClose);
  if (!walk) return [];
  const { path, next } = walk;
  const minutes = path.length - 1;
  return Array.from({ length: minutes }, (_, k) => {
    const o = path[k];
    const c = path[k + 1];
    return { o, c, h: Math.max(o, c), l: Math.min(o, c), v: (volume / minutes) * (0.3 + 1.4 * next()) };
  });
}

function aggregateMinutes(security: Security, minutes: readonly MinuteBar[], stepMinutes: number, startInstant: number, digits: number): IntradayRow[] {
  const rows: IntradayRow[] = [];
  for (let from = 0; from < minutes.length; from += stepMinutes) {
    const slice = minutes.slice(from, from + stepMinutes);
    rows.push({
      t: startInstant + from * 60_000,
      o: roundTo(slice[0].o, digits),
      h: roundTo(Math.max(...slice.map((m) => m.h)), digits),
      l: roundTo(Math.min(...slice.map((m) => m.l)), digits),
      c: roundTo(slice[slice.length - 1].c, digits),
      v: Math.round(slice.reduce((sum, m) => sum + m.v, 0)),
    });
  }
  return rows;
}

/**
 * Intraday bars of one session at `stepMinutes`, stamped at their start: the regular session (consistent with the
 * daily bar) and, for US stocks and funds with `includePrePost`, the pre-market from the previous close to the open and
 * the after-hours session.
 */
export function intradayRows(security: Security, bar: DailyRow, previousClose: number, stepMinutes: number, includePrePost: boolean): IntradayRow[] {
  const profile = security.profile;
  const tz = profile.timeZone;
  const digits = priceDigits(security, bar.c);
  const length = profile.close - profile.open;
  const regular = aggregateMinutes(security, regularMinutes(security, bar, length), stepMinutes, localToUtc(tz, bar.day, profile.open), digits);
  if (!includePrePost || !hasExtendedHours(security) || profile.pre === null || profile.post === null) return regular;
  const pre = extendedMinutes(security, bar, "pre", previousClose, bar.v * 0.04);
  const post = extendedMinutes(security, bar, "post", previousClose, bar.v * 0.03);
  return [
    ...aggregateMinutes(security, pre, stepMinutes, localToUtc(tz, bar.day, profile.pre), digits),
    ...regular,
    ...aggregateMinutes(security, post, stepMinutes, localToUtc(tz, bar.day, profile.close), digits),
  ];
}
