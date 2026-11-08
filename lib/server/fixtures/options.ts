import "server-only";

import { earningsSchedule } from "./company";
import { buildQuote } from "./quote";
import { between, pick, round } from "./random";
import { securityOf, type Security } from "./securities";
import { DAY_MS, isTradingDay, latestCompletedSession, sessionClose, weekdayOf } from "./sessions";

// options() of the fixture data: weekly and monthly expiries priced with Black-Scholes from the security's volatility,
// with extra variance for an expiry that settles after the next earnings report (so the implied move into a report
// looks like one). Stocks and funds have options; other quote types answer with no expiries, and an unknown symbol
// resolves to undefined, as the library does for Yahoo's empty answer.

const RATE = 0.04;
const WEEKLY_EXPIRIES = 6;
const MONTHLY_EXPIRIES = 6;

/** Fridays (Thursdays when Friday is an exchange holiday) after `latest`: six weeklies, then six monthly third Fridays. */
export function expiryDays(security: Security, latest: number): number[] {
  const days = new Set<number>();
  const settle = (friday: number) => (isTradingDay(security.profile, friday) ? friday : friday - 1);
  let friday = latest + ((5 - weekdayOf(latest) + 7) % 7 || 7);
  for (let i = 0; i < WEEKLY_EXPIRIES; i++, friday += 7) days.add(settle(friday));
  const start = new Date(latest * DAY_MS);
  for (let m = 1; days.size < WEEKLY_EXPIRIES + MONTHLY_EXPIRIES && m <= 24; m++) {
    const first = Math.floor(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1) / DAY_MS);
    const third = first + ((5 - weekdayOf(first) + 7) % 7) + 14;
    if (third > latest) days.add(settle(third));
  }
  return [...days].sort((a, b) => a - b);
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function blackScholes(spot: number, strike: number, years: number, vol: number): { call: number; put: number } {
  const sd = vol * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (RATE + 0.5 * vol * vol) * years) / sd;
  const d2 = d1 - sd;
  const discount = Math.exp(-RATE * years);
  return { call: spot * normCdf(d1) - strike * discount * normCdf(d2), put: strike * discount * normCdf(-d2) - spot * normCdf(-d1) };
}

function strikeStep(price: number): number {
  if (price < 25) return 0.5;
  if (price < 100) return 1;
  if (price < 250) return 2.5;
  if (price < 1000) return 5;
  return 10;
}

/** Strikes within about 25% of the price, on the usual grid. */
export function strikesAround(price: number): number[] {
  const step = strikeStep(price);
  const strikes: number[] = [];
  for (let k = Math.ceil((price * 0.75) / step) * step; k <= price * 1.25; k += step) strikes.push(round(k, 2));
  return strikes;
}

function contractSymbol(symbol: string, expiry: number, kind: "C" | "P", strike: number): string {
  const date = new Date(expiry * DAY_MS).toISOString().slice(2, 10).replace(/-/g, "");
  return `${symbol.replace(/[^A-Z]/g, "")}${date}${kind}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

export interface FixtureOptionsQuery {
  date?: Date | number | string;
}

function expiryOf(date: Date | number | string | undefined): number | null {
  if (date === undefined) return null;
  const ms = date instanceof Date ? date.getTime() : typeof date === "number" ? (date < 1e12 ? date * 1000 : date) : Date.parse(date);
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : null;
}

/** options(symbol, { date }) in fixture mode. */
export function buildOptions(symbol: string, query: FixtureOptionsQuery | undefined, now: number): Record<string, unknown> | undefined {
  const security = securityOf(symbol);
  if (!security) return undefined;
  const quote = buildQuote(security, now);
  if (!quote) return undefined;
  const base = { underlyingSymbol: security.symbol, hasMiniOptions: false, quote };
  if (security.type !== "EQUITY" && security.type !== "ETF") return { ...base, expirationDates: [], strikes: [], options: [] };

  const latest = latestCompletedSession(security.profile, now);
  const spot = quote.regularMarketPrice as number;
  const expiries = expiryDays(security, latest);
  const wanted = expiryOf(query?.date);
  const expiry = wanted === null ? expiries[0] : expiries.find((day) => day === wanted);
  const strikes = strikesAround(spot);
  const result = { ...base, expirationDates: expiries.map((day) => new Date(day * DAY_MS)), strikes };
  if (expiry === undefined) return { ...result, options: [] };

  const report = earningsSchedule(security, latest)?.next;
  const years = Math.max(1, expiry - latest) / 365;
  const vol = security.vol * between(0.9, 1.15, security.symbol, "iv");
  // A report before expiry adds one big day of variance: about a 1.6-sigma daily move.
  const eventVariance = report && report.day <= expiry ? (2.5 * security.vol * security.vol) / 252 : 0;
  const iv = Math.sqrt(vol * vol + eventVariance / years);
  const lastTrade = new Date(sessionClose(security.profile, latest) - 60_000);
  const contract = (kind: "C" | "P", strike: number) => {
    const price = blackScholes(spot, strike, years, iv);
    const mid = Math.max(0.01, kind === "C" ? price.call : price.put);
    const spread = Math.max(0.01, mid * 0.03);
    const last = round(mid * between(0.97, 1.03, security.symbol, kind, strike, expiry), 2);
    const volume = pick(5000, security.symbol, kind, strike, "volume");
    return {
      contractSymbol: contractSymbol(security.symbol, expiry, kind, strike),
      strike,
      currency: security.currency,
      lastPrice: Math.max(0.01, last),
      change: round(last * between(-0.15, 0.15, security.symbol, kind, strike, "change"), 2),
      percentChange: round(between(-15, 15, security.symbol, kind, strike, "change"), 2),
      volume,
      openInterest: volume * 3 + pick(20000, security.symbol, kind, strike, "oi"),
      bid: round(Math.max(0.01, mid - spread / 2), 2),
      ask: round(mid + spread / 2, 2),
      contractSize: "REGULAR",
      expiration: new Date(expiry * DAY_MS),
      lastTradeDate: lastTrade,
      impliedVolatility: round(iv, 5),
      inTheMoney: kind === "C" ? strike < spot : strike > spot,
    };
  };
  return {
    ...result,
    options: [
      {
        expirationDate: new Date(expiry * DAY_MS),
        hasMiniOptions: false,
        calls: strikes.map((strike) => contract("C", strike)),
        puts: strikes.map((strike) => contract("P", strike)),
      },
    ],
  };
}
