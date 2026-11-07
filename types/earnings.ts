// Contract for earnings and analyst data (quoteSummary earnings, earningsHistory, earningsTrend, calendarEvents,
// recommendationTrend, upgradeDowngradeHistory). Served by lib/server/earnings.ts to the quote page panels, the events
// calendar and the AI context. Conventions follow types/api.ts: raw numbers, null when missing, ratios as decimals.

export interface EarningsQuarter {
  /** Fiscal period label as Yahoo gives it, e.g. "3Q2026". */
  period: string;
  /** Quarter end date (ISO). */
  periodEnd: string | null;
  /** When the result was reported (ISO), when known. */
  reportedAt: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  /** (actual - estimate) / |estimate| as a decimal. */
  surprise: number | null;
}

export type EstimatePeriod = "0q" | "+1q" | "0y" | "+1y";

export interface EarningsEstimate {
  period: EstimatePeriod;
  /** Period end date (ISO); Yahoo can lag a quarter right after a report, so prefer calendar-based labels. */
  periodEnd: string | null;
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  /** EPS of the same period a year earlier. */
  yearAgoEps: number | null;
  revenueAvg: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  analysts: number | null;
  /** Consensus EPS now and 7, 30, 60 and 90 days ago. */
  epsTrend: { current: number | null; d7: number | null; d30: number | null; d60: number | null; d90: number | null };
  /** Number of upward and downward EPS revisions. */
  revisions: { up7: number | null; up30: number | null; down7: number | null; down30: number | null };
}

export interface EarningsDetail {
  symbol: string;
  asOf: string;
  /** Currency of the financial figures (can differ from the trading currency, e.g. CNY for 0700.HK). */
  financialCurrency: string | null;
  nextDate: string | null;
  nextDateEstimated: boolean | null;
  /** Next-quarter consensus from calendarEvents, when it refers to the upcoming report. */
  consensus: { epsAvg: number | null; epsLow: number | null; epsHigh: number | null; revenueAvg: number | null; revenueLow: number | null; revenueHigh: number | null } | null;
  /** Up to the last five reported quarters, oldest first. */
  history: EarningsQuarter[];
  estimates: EarningsEstimate[];
}

export interface RatingCounts {
  /** "0m" = current month, "-1m" = a month ago, ... */
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface AnalystAction {
  date: string;
  firm: string;
  fromGrade: string | null;
  toGrade: string | null;
  /** Yahoo's action code: up | down | main | init | reit ... */
  action: string | null;
  /** Raises | Lowers | Maintains | Announces | Removes ... */
  priceTargetAction: string | null;
  currentTarget: number | null;
  priorTarget: number | null;
}

export interface AnalystActivity {
  symbol: string;
  asOf: string;
  /** Monthly rating counts, newest first (up to four months). */
  trend: RatingCounts[];
  /** Rating and price-target actions from the last 90 days, newest first (at most 30). */
  actions: AnalystAction[];
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  numberOfAnalysts: number | null;
}
