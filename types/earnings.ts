// Contract for earnings and analyst data (quoteSummary earnings, earningsHistory, earningsTrend, calendarEvents,
// recommendationTrend, upgradeDowngradeHistory) and for the options-implied move into a report. Served by
// lib/server/earnings.ts and lib/server/options.ts to the quote page panels, the events calendar and the AI context.
// Conventions follow types/api.ts: raw numbers, null when missing, ratios as decimals.
//
// Endpoints
//   GET /api/stock/[symbol]/earnings      -> EarningsDetail   (404 not_found for funds, indices and unknown symbols)
//   GET /api/stock/[symbol]/analysts      -> AnalystActivity  (404 not_found without analyst coverage)
//   GET /api/stock/[symbol]/implied-move  -> ImpliedMoveResponse (the move, or why there is none; 404 not_found only for
//                                            symbols Yahoo does not know)
//
// Fields marked optional were added after the first version of this contract; the server always sends them.

/** Session timing of a report in New York time: before the open, after the close, or during the session. */
export type EarningsTiming = "pre" | "post" | "intraday";

export interface EarningsQuarter {
  /** Calendar quarter label as Yahoo gives it, e.g. "3Q2026" (derived from periodEnd when Yahoo has none). */
  period: string;
  /** The company's own fiscal quarter label, e.g. "4Q2026" for Apple's September quarter, when Yahoo gives one. */
  fiscalPeriod?: string | null;
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
  /**
   * Period end date (ISO). For a few days after a report Yahoo keeps the "0q" row labelled with the quarter just
   * reported while its numbers already describe the next quarter: the server relabels such rows from earningsHistory
   * (see `relabeled`) and drops rows whose numbers are still the reported quarter's.
   */
  periodEnd: string | null;
  /** True when periodEnd (and yearAgoEps) were corrected from Yahoo's lagging label. */
  relabeled?: boolean;
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  /** EPS of the same period a year earlier. */
  yearAgoEps: number | null;
  revenueAvg: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  /** Number of analysts behind the EPS estimate. */
  analysts: number | null;
  /** Number of analysts behind the revenue estimate. */
  revenueAnalysts?: number | null;
  /** Consensus EPS now and 7, 30, 60 and 90 days ago. */
  epsTrend: { current: number | null; d7: number | null; d30: number | null; d60: number | null; d90: number | null };
  /** Number of upward and downward EPS revisions. */
  revisions: { up7: number | null; up30: number | null; down7: number | null; down30: number | null };
}

/** Consensus for the upcoming report. */
export interface EarningsConsensus {
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueAvg: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  /** Analysts behind the EPS figures, when known. */
  analysts?: number | null;
  /** Analysts behind the revenue figures, when known. */
  revenueAnalysts?: number | null;
  /** End of the fiscal quarter the consensus refers to, when known. */
  periodEnd?: string | null;
  /** calendarEvents, or the earningsTrend row of the upcoming quarter when calendarEvents still holds the last one. */
  source?: "calendar" | "trend";
}

export interface EarningsDetail {
  symbol: string;
  asOf: string;
  /** Currency of the financial figures (can differ from the trading currency, e.g. CNY for 0700.HK). */
  financialCurrency: string | null;
  /** Currency of the EPS figures (history and estimates), when Yahoo gives one. */
  epsCurrency?: string | null;
  /**
   * Currency of the revenue figures (consensus and estimates): Yahoo's revenueCurrency, else financialCurrency. It can
   * differ from epsCurrency: TSM gives EPS per ADR in USD and revenue in TWD.
   */
  revenueCurrency?: string | null;
  nextDate: string | null;
  nextDateEstimated: boolean | null;
  /** Session timing of the next report; null when the date is an estimate, has no time, or the listing is not in the US. */
  nextTiming?: EarningsTiming | null;
  /**
   * Next-quarter consensus, only when it refers to the upcoming report: calendarEvents when its date is after the last
   * report and its figures are not the reported quarter's, otherwise the earningsTrend row of the upcoming quarter.
   */
  consensus: EarningsConsensus | null;
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
  targetMedian?: number | null;
  numberOfAnalysts: number | null;
  /** Mean rating, 1 = strong buy ... 5 = sell. */
  recommendationMean?: number | null;
  /** strong_buy | buy | hold | underperform | sell | none. */
  recommendationKey?: string | null;
  /** Price Yahoo compared the targets with (financialData.currentPrice). */
  currentPrice?: number | null;
}

/**
 * The move the options market prices through the first expiry after a report: the at-the-money call plus put (an
 * approximate straddle) over the underlying price. It includes the normal moves of every day up to the expiry, so it is
 * labelled "approx., ATM straddle" with the expiry date.
 */
export interface ImpliedMove {
  symbol: string;
  asOf: string;
  /** The report the move refers to (from the quote). */
  report: { at: string; estimated: boolean; timing: EarningsTiming | null };
  /** Option expiry used (ISO, UTC midnight of the expiry date as Yahoo lists it). */
  expiry: string;
  /** Calendar days from asOf to the expiry date, at least 0. */
  daysToExpiry: number;
  strike: number;
  /** Underlying price the move is measured against. */
  price: number;
  callPrice: number;
  putPrice: number;
  /** callPrice + putPrice. */
  straddle: number;
  /** straddle / price as a decimal: 0.072 means about ±7.2%. */
  move: number;
  /** "mid" when both legs are bid/ask mids, "last" when both fell back to the last trade, "mixed" otherwise. */
  basis: "mid" | "last" | "mixed";
  currency: string | null;
}

/**
 * Why a symbol Yahoo knows has no implied move. no_options: no listed options; no_report: no upcoming report on file
 * (funds, or a company that has just reported); report_far: the next report is more than 30 days away; no_expiry: no
 * listed expiry settles after the report; no_quotes: the at-the-money options have no usable bid, ask or last trade, or
 * price an implausible move.
 */
export type ImpliedMoveReason = "no_options" | "no_report" | "report_far" | "no_expiry" | "no_quotes";

/** No implied move for a known symbol: a normal answer (200), with the reason the UI shows instead of a number. */
export interface ImpliedMoveUnavailable {
  symbol: string;
  asOf: string;
  available: false;
  reason: ImpliedMoveReason;
}

/** GET /api/stock/[symbol]/implied-move. */
export type ImpliedMoveResponse = (ImpliedMove & { available: true }) | ImpliedMoveUnavailable;
