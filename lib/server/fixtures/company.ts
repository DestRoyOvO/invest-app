import "server-only";

import { between, pick, round } from "./random";
import type { Security } from "./securities";
import { addTradingDays, DAY_MS, dayNumber, isTradingDay, localToUtc, nextTradingDay, previousTradingDay, tradingDayOnOrBefore, yearOf } from "./sessions";

// Company figures and event schedules of the fixture data. Fundamentals are fixed per symbol (seeded by it); earnings
// reports and dividends are scheduled relative to the latest completed session, so the calendar, My day and the week
// ahead always have entries in the coming days. The default watchlist gets fixed near-term dates: NVDA reports two
// sessions ahead, MSFT four, AAPL six, GOOGL eight and AMZN nine; AAPL goes ex-dividend in three sessions.
//
// A quarter's results depend only on the calendar quarter (quarterResult), so a reported quarter shows the same
// figures on every day, and the trailing EPS of the quote and of quoteSummary is the sum of the same four quarters.

export interface CompanyFigures {
  /** Trailing twelve-month EPS at the anchor date (negative for companies without a P/E). */
  epsTtm: number;
  forwardEps: number;
  sharesOutstanding: number;
  revenueTtm: number;
  netIncomeTtm: number;
  grossMargin: number;
  operatingMargin: number;
  ebitdaMargin: number;
  profitMargin: number;
  revenueGrowth: number;
  earningsGrowth: number;
  /** Debt to equity in percent, as Yahoo reports it (150 is 1.5x). */
  debtToEquityPercent: number;
  totalCash: number;
  totalDebt: number;
  returnOnEquity: number;
  returnOnAssets: number;
  beta: number;
  bookValuePerShare: number;
  employees: number;
  /** Analyst consensus: mean target over the anchor price, 1 (strong buy) to 5 (sell), and the number of analysts. */
  targetRatio: number;
  recommendationMean: number;
  analysts: number;
  shortPercentOfFloat: number;
  insidersPercentHeld: number;
  institutionsPercentHeld: number;
}

const figuresCache = new Map<string, CompanyFigures>();

export function companyFigures(security: Security): CompanyFigures {
  const known = figuresCache.get(security.symbol);
  if (known) return known;
  const s = security.symbol;
  const cap = security.sizeAtAnchor ?? security.anchorPrice * 1e8;
  const shares = cap / security.anchorPrice;
  const pe = security.trailingPE;
  const profitable = pe !== null && pe > 0;
  const epsTtm = profitable ? security.anchorPrice / pe : -security.anchorPrice * between(0.01, 0.05, s, "loss");
  const netIncomeTtm = epsTtm * shares;
  const priceToSales = between(1.5, 9, s, "ps");
  const profitMargin = profitable ? Math.min(0.45, Math.max(0.03, netIncomeTtm / (cap / priceToSales))) : netIncomeTtm / (cap / priceToSales);
  const revenueTtm = Math.abs(netIncomeTtm / profitMargin);
  // Operating income is pretax income (net income / 0.82) plus a little, so the operating margin is at least about 1.26
  // times the net margin; the statements (timeseries.ts) keep that in every quarter.
  const operatingMargin = profitable ? profitMargin * between(1.3, 1.6, s, "op") : profitMargin + 0.03;
  const grossMargin = Math.max(operatingMargin + 0.08, between(0.3, 0.75, s, "gross"));
  // Earnings grow close to revenue, so margins drift slowly instead of tripling over a few years.
  const revenueGrowth = between(-0.04, 0.3, s, "rg");
  const earningsGrowth = revenueGrowth + between(-0.04, 0.06, s, "eg");
  const equity = (shares * security.anchorPrice) / between(2, 18, s, "pb");
  const figures: CompanyFigures = {
    epsTtm,
    forwardEps: profitable ? epsTtm * (1 + Math.max(0.02, earningsGrowth)) : epsTtm * 0.5,
    sharesOutstanding: Math.round(shares),
    revenueTtm,
    netIncomeTtm,
    grossMargin,
    operatingMargin,
    ebitdaMargin: operatingMargin + between(0.02, 0.08, s, "ebitda"),
    profitMargin,
    revenueGrowth,
    earningsGrowth,
    debtToEquityPercent: between(10, 180, s, "de"),
    totalCash: revenueTtm * between(0.05, 0.4, s, "cash"),
    totalDebt: equity * between(0.1, 1.8, s, "debt"),
    returnOnEquity: profitable ? Math.min(0.9, netIncomeTtm / equity) : netIncomeTtm / equity,
    returnOnAssets: between(0.02, 0.2, s, "roa") * (profitable ? 1 : -0.5),
    beta: between(0.6, 1.8, s, "beta"),
    bookValuePerShare: equity / shares,
    employees: Math.round(Math.max(800, revenueTtm / between(300_000, 1_500_000, s, "staff")) / 10) * 10,
    targetRatio: between(1.04, 1.22, s, "target"),
    recommendationMean: round(between(1.5, 2.9, s, "rating"), 1),
    analysts: 12 + pick(40, s, "analysts"),
    shortPercentOfFloat: between(0.005, 0.12, s, "short"),
    insidersPercentHeld: between(0.001, 0.12, s, "insiders"),
    institutionsPercentHeld: between(0.45, 0.85, s, "institutions"),
  };
  // Any well-formed symbol is valid, so the memo is bounded (the figures are cheap to recompute).
  if (figuresCache.size >= 5000) figuresCache.clear();
  figuresCache.set(s, figures);
  return figures;
}

/** Yahoo's recommendation key for a mean rating. */
export function recommendationKey(mean: number): string {
  if (mean <= 1.5) return "strong_buy";
  if (mean <= 2.5) return "buy";
  if (mean <= 3.5) return "hold";
  if (mean <= 4.5) return "underperform";
  return "sell";
}

export function ratingLabel(mean: number): string {
  if (mean <= 1.5) return "Strong Buy";
  if (mean <= 2.5) return "Buy";
  if (mean <= 3.5) return "Hold";
  if (mean <= 4.5) return "Underperform";
  return "Sell";
}

// ---------------------------------------------------------------------------
// Quarters
// ---------------------------------------------------------------------------

/** The calendar quarter end `months` months after (negative: before) a quarter end, e.g. 2026-09-30 - 3 = 2026-06-30. */
export function shiftQuarterEnd(periodEnd: number, months: number): number {
  const date = new Date(periodEnd * DAY_MS);
  return dayNumber(date.getUTCFullYear(), date.getUTCMonth() + 2 + months, 0);
}

/** The latest calendar quarter end on or before a day. */
export function quarterEndOnOrBefore(day: number): number {
  const date = new Date(day * DAY_MS);
  const end = dayNumber(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3 + 4, 0);
  return end <= day ? end : shiftQuarterEnd(end, -3);
}

/** The four calendar quarter ends of a year, oldest first. */
export function quarterEndsOf(year: number): number[] {
  return [3, 6, 9, 12].map((month) => dayNumber(year, month + 1, 0));
}

/** A running number per calendar quarter (seeds the quarter's surprise and wiggle). */
function quarterIndex(periodEnd: number): number {
  const date = new Date(periodEnd * DAY_MS);
  return date.getUTCFullYear() * 4 + Math.floor(date.getUTCMonth() / 3);
}

/** The middle of the four quarters that end with 2025: their results add up to about the anchor-date TTM figures. */
const FIGURES_MIDPOINT = dayNumber(2025, 8, 15);

export interface QuarterResult {
  eps: number;
  revenue: number;
  epsEstimate: number;
  revenueEstimate: number;
}

/**
 * A calendar quarter's results: a quarter of the anchor-date TTM figures, grown at the company's rates to the
 * quarter's end, with a small seasonal wiggle, and the consensus the result beat or missed. The same quarter has the
 * same figures whenever it is asked for.
 */
export function quarterResult(security: Security, periodEnd: number): QuarterResult {
  const figures = companyFigures(security);
  const s = security.symbol;
  const index = quarterIndex(periodEnd);
  const years = (periodEnd - FIGURES_MIDPOINT) / 365.25;
  const eps = (figures.epsTtm / 4) * (1 + figures.earningsGrowth) ** years * (1 + 0.04 * Math.sin(index * 1.7 + s.length));
  const revenue = (figures.revenueTtm / 4) * (1 + figures.revenueGrowth) ** years;
  const surprise = between(-0.04, 0.1, s, "surprise", index);
  return {
    eps: round(eps, 2),
    revenue: Math.round(revenue),
    epsEstimate: round(eps / (1 + surprise), 2),
    revenueEstimate: Math.round(revenue / (1 + surprise / 3)),
  };
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

/** Fixed near-term events for the default watchlist, in sessions after the latest completed session. */
const NEAR_TERM: Readonly<Record<string, { earnings?: number; dividend?: number }>> = {
  NVDA: { earnings: 2, dividend: 7 },
  MSFT: { earnings: 4, dividend: 5 },
  AAPL: { earnings: 6, dividend: 3 },
  GOOGL: { earnings: 8, dividend: 8 },
  AMZN: { earnings: 9 },
};

/** Reports more than this many sessions away are listed as estimates. */
const ESTIMATED_AFTER_SESSIONS = 30;

/**
 * The next report of other stocks is 2 to this many sessions away (about two months). Further out, the quarter
 * before the next one would have to be reported within days of its end, before the latest session.
 */
const MAX_EARNINGS_OFFSET = 45;

/** Reported quarters in a schedule (two years). */
const HISTORY_QUARTERS = 8;

/** A report comes at least this long after its quarter ends, and the history keeps the next report's lag up to the maximum. */
const MIN_REPORT_LAG_DAYS = 15;
const MAX_REPORT_LAG_DAYS = 60;

export interface EarningsReport {
  /** Report date (a trading day). */
  day: number;
  /** Release time: before the open (07:00 local) or after the close (16:05 local). */
  at: number;
  /** Fiscal quarter end (calendar quarters). */
  periodEnd: number;
  epsEstimate: number;
  /** Null for the upcoming report. */
  epsActual: number | null;
  revenueEstimate: number;
  revenueActual: number | null;
}

export interface EarningsSchedule {
  next: EarningsReport;
  nextEstimated: boolean;
  timing: "pre" | "post";
  /** Reported quarters, oldest first: consecutive calendar quarters that end three months before the next report's. */
  history: EarningsReport[];
}

/**
 * The earnings calendar of a stock relative to the latest completed session; null for funds, indices and others.
 *
 * The next report is a fixed number of sessions ahead (at least two, so a report released before the open is still
 * ahead while the next session trades) and covers the latest quarter that ended at least 15 days before it. The
 * reported quarters are the eight before that one, each reported on the first session at least as many days after
 * its quarter end as the next one (15 to 60 days), and never later than the session before the latest: even a release
 * after that session's close lies before any moment at which `latest` is the latest completed session.
 */
export function earningsSchedule(security: Security, latest: number): EarningsSchedule | null {
  if (security.type !== "EQUITY") return null;
  const s = security.symbol;
  const profile = security.profile;
  const offset = NEAR_TERM[s]?.earnings ?? 2 + pick(MAX_EARNINGS_OFFSET - 1, s, "earnings-offset");
  const timing = pick(2, s, "timing") === 0 ? "pre" : "post";
  const at = (day: number) => localToUtc(profile.timeZone, day, timing === "pre" ? 7 * 60 : 16 * 60 + 5);

  const nextDay = addTradingDays(profile, latest, offset);
  const nextEnd = quarterEndOnOrBefore(nextDay - MIN_REPORT_LAG_DAYS);
  const lag = Math.min(MAX_REPORT_LAG_DAYS, Math.max(MIN_REPORT_LAG_DAYS, nextDay - nextEnd));
  const lastReportDay = previousTradingDay(profile, latest);
  const report = (day: number, periodEnd: number, reported: boolean): EarningsReport => {
    const result = quarterResult(security, periodEnd);
    return {
      day,
      at: at(day),
      periodEnd,
      epsEstimate: result.epsEstimate,
      epsActual: reported ? result.eps : null,
      revenueEstimate: result.revenueEstimate,
      revenueActual: reported ? result.revenue : null,
    };
  };
  const history: EarningsReport[] = [];
  for (let k = HISTORY_QUARTERS; k >= 1; k--) {
    const periodEnd = shiftQuarterEnd(nextEnd, -3 * k);
    const due = periodEnd + lag;
    history.push(report(Math.min(isTradingDay(profile, due) ? due : nextTradingDay(profile, due), lastReportDay), periodEnd, true));
  }
  return { next: report(nextDay, nextEnd, false), nextEstimated: offset > ESTIMATED_AFTER_SESSIONS, timing, history };
}

/** A calendar year's EPS and revenue: reported quarters (up to `lastReported`) at their results, later ones at the estimates. */
export function yearResult(security: Security, year: number, lastReported: number): { eps: number; revenue: number } {
  let eps = 0;
  let revenue = 0;
  for (const end of quarterEndsOf(year)) {
    const result = quarterResult(security, end);
    const reported = end <= lastReported;
    eps += reported ? result.eps : result.epsEstimate;
    revenue += reported ? result.revenue : result.revenueEstimate;
  }
  return { eps: round(eps, 2), revenue };
}

/** The latest calendar year whose four quarters are all reported (the fiscal years the annual statements show). */
export function lastReportedYear(schedule: EarningsSchedule): number {
  const last = schedule.history.at(-1)?.periodEnd ?? shiftQuarterEnd(schedule.next.periodEnd, -3);
  return yearOf(last) - (new Date(last * DAY_MS).getUTCMonth() === 11 ? 0 : 1);
}

/** Trailing twelve-month EPS: the four latest reported quarters. The quote and every quoteSummary module use it. */
export function trailingEps(schedule: EarningsSchedule): number {
  return round(
    schedule.history.slice(-4).reduce((sum, report) => sum + (report.epsActual ?? 0), 0),
    2,
  );
}

/** The trailing EPS of a stock at the latest completed session; null for other quote types. */
export function trailingEpsOf(security: Security, latest: number): number | null {
  const schedule = earningsSchedule(security, latest);
  return schedule ? trailingEps(schedule) : null;
}

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

export interface DividendPayment {
  /** Ex-dividend date (a trading day). */
  exDay: number;
  /** Payment date, two weeks after the ex-date. */
  payDay: number;
  amount: number;
}

export interface DividendSchedule {
  /** Forward annual dividend per share (four times the next payment). */
  annualRate: number;
  next: DividendPayment;
  /** Past payments, oldest first (ex-dates every 91 days and never after the latest session, growing about 6% a year). */
  history: DividendPayment[];
}

/** Quarterly dividends of a payer (stocks and funds with a yield), scheduled relative to the latest session. */
export function dividendSchedule(security: Security, latest: number): DividendSchedule | null {
  if (security.dividendYield <= 0 || (security.type !== "EQUITY" && security.type !== "ETF" && security.type !== "MUTUALFUND")) return null;
  const s = security.symbol;
  const profile = security.profile;
  const offset = NEAR_TERM[s]?.dividend ?? 1 + pick(62, s, "dividend-offset");
  const quarterly = (security.anchorPrice * security.dividendYield) / 4;
  const nextEx = addTradingDays(profile, latest, offset);
  const payment = (exDay: number, quartersBack: number): DividendPayment => ({
    exDay,
    payDay: exDay + 14,
    amount: round(quarterly * 1.06 ** (-quartersBack / 4), 4),
  });
  const history: DividendPayment[] = [];
  const first = Math.max(profile.epoch, dayNumber(yearOf(latest) - 12, 1, 1));
  for (let k = 60; k >= 1; k--) {
    // Ninety-one days before an ex-date up to 62 sessions away can still be after the latest session.
    const exDay = Math.min(tradingDayOnOrBefore(profile, nextEx - 91 * k), latest);
    if (exDay >= first) history.push(payment(exDay, k));
  }
  const next = payment(nextEx, 0);
  return { annualRate: round(next.amount * 4, 4), next, history };
}

/** The four latest payments before `latest` (Yahoo's trailing annual dividend). */
export function trailingDividends(schedule: DividendSchedule, latest: number): number {
  return round(
    schedule.history
      .filter((payment) => payment.exDay <= latest)
      .slice(-4)
      .reduce((sum, payment) => sum + payment.amount, 0),
    4,
  );
}

/**
 * The dividend Yahoo shows as announced: the next one when its ex-date is within five weeks, otherwise the latest
 * past one for three weeks after it went ex, otherwise none.
 */
export function announcedDividend(schedule: DividendSchedule | null, latest: number): DividendPayment | null {
  if (!schedule) return null;
  if (schedule.next.exDay - latest <= 35) return schedule.next;
  const last = schedule.history.at(-1);
  return last && latest - last.exDay <= 21 ? last : null;
}
