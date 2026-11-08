import "server-only";

import {
  announcedDividend,
  companyFigures,
  dividendSchedule,
  earningsSchedule,
  ratingLabel,
  trailingDividends,
  trailingEps,
  type DividendPayment,
} from "./company";
import { closeBefore, dailyRows, extendedPath, hasExtendedHours, lastDayOfPreviousYear, priceDigits, type DailyRow } from "./prices";
import { round } from "./random";
import type { Security } from "./securities";
import {
  DAY_MS,
  dailyStamp,
  latestCompletedSession,
  localToUtc,
  marketStateAt,
  nextTradingDay,
  sessionClose,
  sessionOpen,
  zoneOffsetMinutes,
  zoneShortName,
} from "./sessions";

// Quotes of the fixture data, shaped like yahoo-finance2's quote() result after validation: numbers as numbers, dates
// as Date objects, percent fields in Yahoo's units (regularMarketChangePercent 1.25 means 1.25%). Prices are those of
// the latest completed session; marketState follows the clock. US stocks and funds also carry the after-hours trade
// of that session (postMarket*, kept until the next pre-market, as Yahoo does) and, while the next session's
// pre-market trades, its latest pre-market trade (preMarket*), both from the same paths as the intraday bars.

export type RawQuote = Record<string, unknown>;

/** Sessions of history a quote looks back over (52 weeks plus the 200-day average). */
const LOOKBACK_DAYS = 400;

/** The recent bars behind a quote: the latest completed session and about a year and a month before it. */
export function recentRows(security: Security, now: number): { latest: number; rows: readonly DailyRow[] } {
  const latest = latestCompletedSession(security.profile, now);
  return { latest, rows: dailyRows(security, latest - LOOKBACK_DAYS, latest) };
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function corporateAction(security: Security, payment: DividendPayment): Record<string, unknown> {
  const amount = payment.amount.toFixed(payment.amount < 0.1 ? 4 : 2);
  const exDate = SHORT_DATE.format(new Date(payment.exDay * DAY_MS)).replace(/^(\w{3})/, "$1.");
  return {
    header: "Dividend",
    message: `${security.symbol} announced a cash dividend of ${amount} with an ex-date of ${exDate}`,
    meta: { eventType: "DIVIDEND", dateEpochMs: localToUtc("America/New_York", payment.exDay, 0), amount },
  };
}

function quoteTypeDisplay(type: Security["type"]): string {
  switch (type) {
    case "EQUITY":
      return "Equity";
    case "ETF":
      return "ETF";
    case "INDEX":
      return "Index";
    case "FUTURE":
      return "Futures";
    case "CURRENCY":
      return "Currency";
    case "CRYPTOCURRENCY":
      return "Cryptocurrency";
    case "MUTUALFUND":
      return "Fund";
  }
}

/** The quote of one security at `now`; null when it has no bars yet (before its first trading day). */
export function buildQuote(security: Security, now: number): RawQuote | null {
  const { latest, rows } = recentRows(security, now);
  const last = rows.at(-1);
  if (!last) return null;
  const profile = security.profile;
  const previous = rows.at(-2)?.c ?? closeBefore(security, last.day) ?? last.o;
  const price = last.c;
  const digits = priceDigits(security, price);
  const change = round(price - previous, digits + 2);
  const changePercent = previous ? ((price - previous) / previous) * 100 : 0;
  const year = rows.filter((row) => row.day > latest - 365);
  const high52 = Math.max(...year.map((row) => row.h));
  const low52 = Math.min(...year.map((row) => row.l));
  const yearAgo = year[0]?.c ?? price;
  const closes = rows.map((row) => row.c);
  const avg50 = mean(closes.slice(-50)) ?? price;
  const avg200 = mean(closes.slice(-200)) ?? price;
  const volumes = rows.map((row) => row.v);
  const regularMarketTime = new Date(sessionClose(profile, last.day));
  const offsetMs = zoneOffsetMinutes(profile.timeZone, now) * 60_000;

  const quote: RawQuote = {
    language: "en-US",
    region: "US",
    quoteType: security.type,
    typeDisp: quoteTypeDisplay(security.type),
    quoteSourceName: security.market === "us_market" ? "Nasdaq Real Time Price" : "Delayed Quote",
    triggerable: security.market === "us_market",
    customPriceAlertConfidence: "HIGH",
    currency: security.currency,
    marketState: marketStateAt(profile, now),
    tradeable: false,
    cryptoTradeable: security.type === "CRYPTOCURRENCY",
    corporateActions: [],
    exchange: security.exchange,
    shortName: security.shortName,
    longName: security.name,
    messageBoardId: `finmb_fixture_${security.symbol.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    exchangeTimezoneName: profile.timeZone,
    exchangeTimezoneShortName: zoneShortName(profile.timeZone, now),
    gmtOffSetMilliseconds: offsetMs,
    market: security.market,
    esgPopulated: false,
    fiftyTwoWeekLowChange: round(price - low52, digits + 2),
    fiftyTwoWeekLowChangePercent: low52 ? (price - low52) / low52 : 0,
    fiftyTwoWeekRange: { low: low52, high: high52 },
    fiftyTwoWeekHighChange: round(price - high52, digits + 2),
    fiftyTwoWeekHighChangePercent: high52 ? (price - high52) / high52 : 0,
    fiftyTwoWeekLow: low52,
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekChangePercent: yearAgo ? (price / yearAgo - 1) * 100 : 0,
    fiftyDayAverage: round(avg50, digits + 1),
    fiftyDayAverageChange: round(price - avg50, digits + 2),
    fiftyDayAverageChangePercent: (price - avg50) / avg50,
    twoHundredDayAverage: round(avg200, digits + 1),
    twoHundredDayAverageChange: round(price - avg200, digits + 2),
    twoHundredDayAverageChangePercent: (price - avg200) / avg200,
    sourceInterval: 15,
    exchangeDataDelayedBy: security.market === "us_market" ? 0 : 15,
    firstTradeDateMilliseconds: new Date(dailyStamp(profile, profile.epoch)),
    priceHint: digits,
    hasPrePostMarketData: hasExtendedHours(security),
    regularMarketChange: change,
    regularMarketChangePercent: changePercent,
    regularMarketTime,
    regularMarketPrice: price,
    fulldayPrice: price,
    fulldayChange: change,
    fulldayChangePercent: changePercent,
    regularMarketDayHigh: last.h,
    regularMarketDayRange: { low: last.l, high: last.h },
    regularMarketDayLow: last.l,
    regularMarketVolume: last.v,
    regularMarketPreviousClose: previous,
    regularMarketOpen: last.o,
    bid: round(price * 0.9998, digits),
    ask: round(price * 1.0002, digits),
    bidSize: 3,
    askSize: 4,
    fullExchangeName: security.fullExchangeName,
    averageDailyVolume3Month: Math.round(mean(volumes.slice(-63)) ?? 0),
    averageDailyVolume10Day: Math.round(mean(volumes.slice(-10)) ?? 0),
    displayName: security.shortName.replace(/,? (Inc\.|Corporation|Corp\.|Incorporated|plc|Limited|N\.V\.)$/, ""),
    symbol: security.symbol,
  };

  if (security.type === "EQUITY") addCompanyFields(quote, security, latest, price);
  if (security.type === "ETF" || security.type === "MUTUALFUND") addFundFields(quote, security, latest, price, rows);
  addDividendFields(quote, security, latest, price);
  addExtendedHours(quote, security, last, digits, now);
  if (security.type === "CRYPTOCURRENCY") {
    const supply = (security.sizeAtAnchor ?? 0) / security.anchorPrice;
    Object.assign(quote, {
      marketCap: Math.round(supply * price),
      circulatingSupply: Math.round(supply),
      fromCurrency: security.symbol.split("-")[0],
      toCurrency: `${security.currency}=X`,
      lastMarket: "CoinMarketCap",
      volume24Hr: last.v,
      volumeAllCurrencies: last.v,
      startDate: new Date(dailyStamp(profile, profile.epoch)),
      coinMarketCapLink: `https://example.com/fixtures/crypto/${security.symbol.toLowerCase()}`,
    });
  }
  if (security.type === "FUTURE") {
    const root = security.symbol.replace(/=F$/, "");
    const expiry = latest + 45;
    Object.assign(quote, {
      contractSymbol: false,
      underlyingSymbol: `${root}Z${String(new Date(expiry * DAY_MS).getUTCFullYear()).slice(-2)}.${security.exchange}`,
      headSymbolAsString: security.symbol,
      underlyingExchangeSymbol: `${root}Z.${security.exchange}`,
      expireDate: new Date(expiry * DAY_MS),
      expireIsoDate: new Date(expiry * DAY_MS),
      openInterest: Math.round(security.baseVolume * 3.2),
    });
  }
  return quote;
}

function addCompanyFields(quote: RawQuote, security: Security, latest: number, price: number): void {
  const figures = companyFigures(security);
  const schedule = earningsSchedule(security, latest);
  // The same trailing EPS as quoteSummary's summaryDetail and defaultKeyStatistics, so every P/E the app shows agrees.
  const epsTtm = schedule ? trailingEps(schedule) : round(figures.epsTtm, 2);
  const shares = figures.sharesOutstanding;
  Object.assign(quote, {
    marketCap: Math.round(shares * price),
    sharesOutstanding: shares,
    impliedSharesOutstanding: shares,
    epsTrailingTwelveMonths: epsTtm,
    epsForward: round(figures.forwardEps, 2),
    epsCurrentYear: round(epsTtm * 1.05, 2),
    priceEpsCurrentYear: epsTtm > 0 ? price / (epsTtm * 1.05) : undefined,
    trailingPE: epsTtm > 0 ? price / epsTtm : undefined,
    forwardPE: figures.forwardEps > 0 ? price / figures.forwardEps : undefined,
    bookValue: round(figures.bookValuePerShare, 3),
    priceToBook: price / figures.bookValuePerShare,
    averageAnalystRating: `${figures.recommendationMean.toFixed(1)} - ${ratingLabel(figures.recommendationMean)}`,
    financialCurrency: security.currency,
  });
  if (schedule) {
    const last = schedule.history.at(-1);
    const nextAt = schedule.next.at;
    Object.assign(quote, {
      earningsTimestamp: last ? new Date(last.at) : undefined,
      earningsTimestampStart: new Date(nextAt),
      earningsTimestampEnd: new Date(schedule.nextEstimated ? nextAt + 4 * DAY_MS : nextAt),
      earningsCallTimestampStart: new Date(nextAt + 60 * 60_000),
      earningsCallTimestampEnd: new Date(nextAt + 2 * 60 * 60_000),
      isEarningsDateEstimate: schedule.nextEstimated,
    });
  }
  for (const key of Object.keys(quote)) if (quote[key] === undefined) delete quote[key];
}

const MINUTE_MS = 60_000;

/**
 * The latest extended-hours trades at `now` for US stocks and funds: the after-hours session of the latest completed
 * session (from its close on, up to now) and the pre-market of the next session while it trades. Each price is the
 * close of the last completed one-minute bar of the path the intraday chart draws, its time the end of that minute.
 */
function addExtendedHours(quote: RawQuote, security: Security, last: DailyRow, digits: number, now: number): void {
  const profile = security.profile;
  if (!hasExtendedHours(security) || profile.pre === null || profile.post === null) return;
  const fields = (prefix: "preMarket" | "postMarket", path: Float64Array, start: number) => {
    const minute = Math.min(path.length - 1, Math.floor((now - start) / MINUTE_MS));
    if (minute < 1) return;
    const price = round(path[minute], digits);
    Object.assign(quote, {
      [`${prefix}ChangePercent`]: ((price - last.c) / last.c) * 100,
      [`${prefix}Price`]: price,
      [`${prefix}Change`]: round(price - last.c, digits + 2),
      [`${prefix}Time`]: new Date(start + minute * MINUTE_MS),
    });
  };
  fields("postMarket", extendedPath(security, last, "post", last.c), sessionClose(profile, last.day));
  const next = nextTradingDay(profile, last.day);
  const preStart = localToUtc(profile.timeZone, next, profile.pre);
  if (now >= preStart && now < sessionOpen(profile, next)) {
    const [bar] = dailyRows(security, next, next);
    if (bar) fields("preMarket", extendedPath(security, bar, "pre", last.c), preStart);
  }
}

function addFundFields(quote: RawQuote, security: Security, latest: number, price: number, rows: readonly DailyRow[]): void {
  const base = lastDayOfPreviousYear(security, latest);
  const yearStart = rows.find((row) => row.day >= base)?.c ?? rows[0]?.c ?? price;
  const quarterAgo = rows.find((row) => row.day >= latest - 91)?.c ?? price;
  Object.assign(quote, {
    netAssets: Math.round((security.sizeAtAnchor ?? 0) * (price / security.anchorPrice)),
    netExpenseRatio: round((security.fund?.expenseRatio ?? 0) * 100, 4),
    ytdReturn: round((price / yearStart - 1) * 100, 4),
    trailingThreeMonthReturns: round((price / quarterAgo - 1) * 100, 4),
    trailingThreeMonthNavReturns: round((price / quarterAgo - 1) * 100, 4),
  });
}

function addDividendFields(quote: RawQuote, security: Security, latest: number, price: number): void {
  const schedule = dividendSchedule(security, latest);
  if (!schedule) {
    if (security.type === "EQUITY") Object.assign(quote, { trailingAnnualDividendRate: 0, trailingAnnualDividendYield: 0 });
    return;
  }
  const trailing = trailingDividends(schedule, latest);
  const announced = announcedDividend(schedule, latest);
  Object.assign(quote, {
    dividendRate: schedule.annualRate,
    dividendYield: round((schedule.annualRate / price) * 100, 2),
    trailingAnnualDividendRate: trailing,
    trailingAnnualDividendYield: trailing / price,
    dividendDate: new Date(localToUtc("America/New_York", (announced ?? schedule.next).payDay, 0)),
    corporateActions: announced ? [corporateAction(security, announced)] : [],
  });
}

/**
 * The same quote in the screener's shape: Yahoo's predefined screens send times as epoch seconds and the ranges as
 * "low - high" strings (yahoo-finance2 validates them that way).
 */
export function toScreenerQuote(quote: RawQuote): RawQuote {
  const seconds = (value: unknown) => (value instanceof Date ? Math.floor(value.getTime() / 1000) : value);
  const range = (value: unknown) => {
    const r = value as { low?: number; high?: number } | undefined;
    return r && typeof r.low === "number" && typeof r.high === "number" ? `${r.low} - ${r.high}` : value;
  };
  const out: RawQuote = { ...quote };
  for (const key of ["regularMarketTime", "postMarketTime", "preMarketTime", "earningsTimestamp", "earningsTimestampStart", "earningsTimestampEnd", "dividendDate"]) {
    if (key in out) out[key] = seconds(out[key]);
  }
  const firstTrade = out.firstTradeDateMilliseconds;
  if (firstTrade instanceof Date) out.firstTradeDateMilliseconds = firstTrade.getTime();
  out.fiftyTwoWeekRange = range(out.fiftyTwoWeekRange);
  out.regularMarketDayRange = range(out.regularMarketDayRange);
  return out;
}
