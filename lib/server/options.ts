import "server-only";

import { eventDayKey, nyDayKey, nyMinuteOfDay, weekdayOf } from "@/lib/events";
import type { EarningsTiming, ImpliedMove } from "@/types/earnings";

import { cached, HOUR, isFresh, MINUTE, peek, put } from "./cache";
import { earningsTiming } from "./calendar";
import { callOptions, mapQuote, num, str, toIso, upstream, yf } from "./yahoo";

// The move the options market prices into the next report: the at-the-money call plus put of the first expiry that
// settles after the report, over the underlying price (an approximate straddle, labelled as such in the UI).
//
// One options() call without a date lists the expiries, carries the underlying quote (price and next report date) and
// the nearest chain; a second call fetches the target expiry when it is not the nearest. Quotes are cached 15 minutes
// during the options session and up to 2 hours otherwise. Off-hours quotes can be crossed or zero (AAPL call bid 2.72
// above ask 2.65 on 2026-11-06), so a leg falls back to its last trade price, and implausible results are dropped.

/** Reports further away get no implied move: the straddle would mostly price ordinary trading days. */
export const MAX_REPORT_DAYS = 30;
/** A straddle worth more than this share of the price comes from placeholder quotes, not a real market. */
const MAX_MOVE = 0.6;
/** Strikes tried, nearest to the price first, when a leg has no usable price. */
const STRIKES_TRIED = 3;
const STALE_MS = 6 * HOUR;
const DAY_MS = 24 * HOUR;

const SESSION_OPEN = 9 * 60 + 30;
/** Equity options trade until 16:00 ET; quotes settle by 16:15. */
const SESSION_CLOSE = 16 * 60 + 15;
const TRADING_TTL_MS = 15 * MINUTE;
const CLOSED_TTL_MS = 2 * HOUR;

type Raw = Record<string, unknown>;

export interface OptionContract {
  strike: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
}

export interface OptionChain {
  /** Expiry (ISO, UTC midnight of the expiry date). */
  expiry: string;
  calls: OptionContract[];
  puts: OptionContract[];
  /** Underlying price when the chain was fetched. */
  price: number | null;
  currency: string | null;
}

/** What the call without a date tells about a symbol. */
export interface OptionsHead {
  /** Listed expiries (ISO), ascending; empty for symbols without listed options. */
  expiries: string[];
  /** Next report from the embedded quote. */
  report: { at: string; estimated: boolean } | null;
  price: number | null;
  currency: string | null;
}

const NO_OPTIONS: OptionsHead = { expiries: [], report: null, price: null, currency: null };

function obj(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter((item): item is Raw => !!item && typeof item === "object") : [];
}

/**
 * How long option quotes stay cached: 15 minutes while equity options trade (weekdays 9:30 to 16:15 ET), otherwise until
 * the next open but at most 2 hours, so the first quotes of a session are never hidden behind an overnight entry.
 * Exchange holidays count as trading days (a shorter cache, never a wrong one).
 */
export function optionsTtlMs(now: number): number {
  const day = nyDayKey(now);
  const weekday = weekdayOf(day);
  const minute = nyMinuteOfDay(now);
  const weekdaySession = weekday >= 1 && weekday <= 5;
  if (weekdaySession && minute >= SESSION_OPEN && minute < SESSION_CLOSE) return TRADING_TTL_MS;
  let minutesToOpen: number;
  if (weekdaySession && minute < SESSION_OPEN) minutesToOpen = SESSION_OPEN - minute;
  else {
    const daysAhead = weekday === 5 ? 3 : weekday === 6 ? 2 : 1;
    minutesToOpen = daysAhead * 24 * 60 - minute + SESSION_OPEN;
  }
  return Math.min(CLOSED_TTL_MS, Math.max(MINUTE, minutesToOpen * MINUTE));
}

/**
 * The first expiry that settles after the report. A report before the open or during the session is priced by that
 * day's expiry; one after the close, or at a time not yet known, needs a later expiry.
 */
export function pickExpiry(expiries: readonly string[], reportAt: string, timing: EarningsTiming | null): string | null {
  const reportDay = eventDayKey(reportAt);
  if (!reportDay) return null;
  const sameDay = timing === "pre" || timing === "intraday";
  return [...expiries].sort().find((iso) => (sameDay ? iso.slice(0, 10) >= reportDay : iso.slice(0, 10) > reportDay)) ?? null;
}

/** A leg's price: the bid/ask mid when both are positive and not crossed, otherwise the last trade; null without either. */
export function legPrice(contract: OptionContract): { price: number; basis: "mid" | "last" } | null {
  const { bid, ask, last } = contract;
  if (bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid) return { price: (bid + ask) / 2, basis: "mid" };
  if (last !== null && last > 0) return { price: last, basis: "last" };
  return null;
}

/** Call and put at the strike nearest the price (trying the next nearest when a leg has no price). */
export function atmStraddle(
  chain: OptionChain,
  price: number,
): { strike: number; callPrice: number; putPrice: number; basis: ImpliedMove["basis"] } | null {
  const puts = new Map(chain.puts.map((put) => [put.strike, put]));
  const pairs = chain.calls
    .filter((call) => puts.has(call.strike))
    .sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price) || a.strike - b.strike)
    .slice(0, STRIKES_TRIED);
  for (const call of pairs) {
    const callLeg = legPrice(call);
    const putLeg = legPrice(puts.get(call.strike)!);
    if (!callLeg || !putLeg) continue;
    return { strike: call.strike, callPrice: callLeg.price, putPrice: putLeg.price, basis: callLeg.basis === putLeg.basis ? callLeg.basis : "mixed" };
  }
  return null;
}

function contracts(value: unknown): OptionContract[] {
  return list(value)
    .filter((c) => c.contractSize === undefined || c.contractSize === "REGULAR")
    .map((c) => ({ strike: num(c.strike) ?? 0, bid: num(c.bid), ask: num(c.ask), last: num(c.lastPrice) }))
    .filter((c) => c.strike > 0);
}

/** Splits one options() payload into the head (expiries, quote) and the chain it carries; null for an empty answer. */
export function mapOptionsPayload(raw: unknown): { head: OptionsHead; chain: OptionChain | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Raw;
  const expiries = [...new Set((Array.isArray(payload.expirationDates) ? payload.expirationDates : []).map(toIso).filter((iso): iso is string => iso !== null))].sort();
  const quoteRaw = obj(payload.quote);
  const quote = str(quoteRaw.symbol) ? mapQuote(quoteRaw) : null;
  const price = quote?.price ?? null;
  const currency = quote?.currency ?? null;
  const report = quote?.nextEarningsDate ? { at: quote.nextEarningsDate, estimated: quote.earningsDateEstimated === true } : null;
  const first = list(payload.options)[0];
  const expiry = first ? toIso(first.expirationDate) : null;
  const chain = first && expiry ? { expiry, calls: contracts(first.calls), puts: contracts(first.puts), price, currency } : null;
  return { head: { expiries, report, price, currency }, chain };
}

export interface ExpiryTarget {
  expiry: string;
  report: { at: string; estimated: boolean };
  timing: EarningsTiming | null;
}

/** The expiry to price for the next report; null without options, without a report, or for a report over 30 days out. */
export function targetExpiry(symbol: string, head: OptionsHead, now: number): ExpiryTarget | null {
  if (!head.report || head.expiries.length === 0) return null;
  const at = Date.parse(head.report.at);
  if (!Number.isFinite(at) || at < now - DAY_MS || at > now + MAX_REPORT_DAYS * DAY_MS) return null;
  const timing = earningsTiming(head.report.at, head.report.estimated, symbol);
  const expiry = pickExpiry(head.expiries, head.report.at, timing);
  return expiry ? { expiry, report: head.report, timing } : null;
}

/** The implied move from a chain; null when the straddle has no usable prices or an implausible size. */
export function impliedMoveFrom(symbol: string, target: ExpiryTarget, chain: OptionChain, head: OptionsHead, now: number): ImpliedMove | null {
  const price = chain.price ?? head.price;
  if (price === null || !(price > 0)) return null;
  const straddle = atmStraddle(chain, price);
  if (!straddle) return null;
  const total = straddle.callPrice + straddle.putPrice;
  const move = total / price;
  if (!(move > 0) || move > MAX_MOVE) return null;
  const daysToExpiry = Math.max(0, Math.round((Date.parse(`${target.expiry.slice(0, 10)}T00:00:00Z`) - Date.parse(`${nyDayKey(now)}T00:00:00Z`)) / DAY_MS));
  return {
    symbol,
    asOf: new Date(now).toISOString(),
    report: { at: target.report.at, estimated: target.report.estimated, timing: target.timing },
    expiry: target.expiry,
    daysToExpiry,
    strike: straddle.strike,
    price,
    callPrice: straddle.callPrice,
    putPrice: straddle.putPrice,
    straddle: total,
    move,
    basis: straddle.basis,
    currency: chain.currency ?? head.currency,
  };
}

function headKey(symbol: string): string {
  return `options-head:${symbol}`;
}

function chainKey(symbol: string, expiry: string): string {
  return `options-chain:${symbol}:${expiry.slice(0, 10)}`;
}

async function fetchOptions(symbol: string, expiry?: string): Promise<unknown> {
  try {
    return await upstream(() => yf.options(symbol, expiry ? { date: new Date(expiry) } : {}, callOptions()));
  } catch (error) {
    // Unknown symbols: no options, not an outage.
    if (/not found|No data found|404/i.test(String(error))) return null;
    throw error;
  }
}

/**
 * Uncached Yahoo calls behind getImpliedMove(symbol), for charging the public route: none while the head and the target
 * chain are cached (or the symbol has no options or no report soon), one for a missing chain, and two (the head and,
 * when the nearest expiry does not qualify, the target chain) while the head is unknown.
 */
export function uncachedImpliedMoveCalls(symbol: string, now = Date.now()): number {
  if (!isFresh(headKey(symbol))) return 2;
  const head = peek<OptionsHead>(headKey(symbol));
  if (head === undefined) return 1;
  const target = targetExpiry(symbol, head, now);
  if (!target) return 0;
  return isFresh(chainKey(symbol, target.expiry)) ? 0 : 1;
}

/** Implied move into the next report; null for symbols without listed options or without a report within 30 days. */
export async function getImpliedMove(symbol: string): Promise<ImpliedMove | null> {
  const now = Date.now();
  const options = { ttlMs: optionsTtlMs(now), staleMs: STALE_MS };
  const head = await cached(headKey(symbol), options, async () => {
    const parsed = mapOptionsPayload(await fetchOptions(symbol));
    if (!parsed) return NO_OPTIONS;
    if (parsed.chain) put(chainKey(symbol, parsed.chain.expiry), parsed.chain, options);
    return parsed.head;
  });
  const target = targetExpiry(symbol, head, now);
  if (!target) return null;
  const chain = await cached(chainKey(symbol, target.expiry), options, async () => {
    const parsed = mapOptionsPayload(await fetchOptions(symbol, target.expiry));
    return parsed?.chain && parsed.chain.expiry.slice(0, 10) === target.expiry.slice(0, 10) ? parsed.chain : null;
  });
  return chain ? impliedMoveFrom(symbol, target, chain, head, now) : null;
}
