import "server-only";

import { between, pick, round } from "./random";
import type { Security } from "./securities";
import { addTradingDays, DAY_MS, dayNumber, localToUtc, tradingDayOnOrBefore, yearOf } from "./sessions";

// Company figures and event schedules of the fixture data. Fundamentals are fixed per symbol (seeded by it); earnings
// reports and dividends are scheduled relative to the latest completed session, so the calendar, My day and the week
// ahead always have entries in the coming days. The default watchlist gets fixed near-term dates: NVDA reports two
// sessions ahead, MSFT four, AAPL six, GOOGL eight and AMZN nine; AAPL goes ex-dividend in three sessions.

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
  const operatingMargin = profitable ? profitMargin * between(1.1, 1.45, s, "op") : profitMargin + 0.03;
  const grossMargin = Math.max(operatingMargin + 0.08, between(0.3, 0.75, s, "gross"));
  const earningsGrowth = between(-0.08, 0.35, s, "eg");
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
    revenueGrowth: between(-0.04, 0.3, s, "rg"),
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
  /** Reported quarters, oldest first. */
  history: EarningsReport[];
}

/** The latest calendar quarter end at least three weeks before a report. */
function quarterEndBefore(day: number): number {
  const date = new Date((day - 21) * DAY_MS);
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3);
  // The end of the previous quarter: day 0 of the quarter's first month.
  return dayNumber(year, quarter * 3 + 1, 0);
}

/** The earnings calendar of a stock relative to the latest completed session; null for funds, indices and others. */
export function earningsSchedule(security: Security, latest: number): EarningsSchedule | null {
  if (security.type !== "EQUITY") return null;
  const s = security.symbol;
  const profile = security.profile;
  const figures = companyFigures(security);
  const offset = NEAR_TERM[s]?.earnings ?? 1 + pick(62, s, "earnings-offset");
  const timing = pick(2, s, "timing") === 0 ? "pre" : "post";
  const at = (day: number) => localToUtc(profile.timeZone, day, timing === "pre" ? 7 * 60 : 16 * 60 + 5);
  const quarterlyEps = figures.epsTtm / 4;
  const quarterlyRevenue = figures.revenueTtm / 4;
  const growth = (quartersBack: number, rate: number) => (1 + rate) ** (-quartersBack / 4);

  const nextDay = addTradingDays(profile, latest, offset);
  const report = (day: number, quartersBack: number, reported: boolean): EarningsReport => {
    const epsActual = quarterlyEps * growth(quartersBack, figures.earningsGrowth) * (1 + 0.04 * Math.sin(quartersBack * 1.7 + s.length));
    const surprise = between(-0.04, 0.1, s, "surprise", quartersBack);
    const revenueActual = quarterlyRevenue * growth(quartersBack, figures.revenueGrowth);
    return {
      day,
      at: at(day),
      periodEnd: quarterEndBefore(day),
      epsEstimate: round(epsActual / (1 + surprise), 2),
      epsActual: reported ? round(epsActual, 2) : null,
      revenueEstimate: Math.round(revenueActual / (1 + surprise / 3)),
      revenueActual: reported ? Math.round(revenueActual) : null,
    };
  };
  const history: EarningsReport[] = [];
  for (let k = 8; k >= 1; k--) history.push(report(tradingDayOnOrBefore(profile, nextDay - 91 * k), k, true));
  return { next: report(nextDay, 0, false), nextEstimated: offset > ESTIMATED_AFTER_SESSIONS, timing, history };
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
  /** Past payments, oldest first (ex-dates every 91 days, growing about 6% a year). */
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
    const exDay = tradingDayOnOrBefore(profile, nextEx - 91 * k);
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
