import "server-only";

import { companyFigures, earningsSchedule, lastReportedYear, quarterEndsOf, quarterResult } from "./company";
import { between, round } from "./random";
import { securityOf, type Security } from "./securities";
import { DAY_MS, dayNumber, latestCompletedSession } from "./sessions";

// fundamentalsTimeSeries() of the fixture data: income statement, cash flow and balance sheet rows per fiscal year
// (calendar years) or quarter, consistent with the earnings modules (the same quarterly revenue and EPS). A year, and
// the trailing twelve months, is the sum of its quarters line by line. Each quarter's margins move a little around the
// company's figures (seeded by the quarter, so a reported quarter never changes), and operating income stays between
// pretax income and gross profit. Like Yahoo, the oldest period of a request is a thin "stub" row with only a few fields. Funds, indices and unknown
// symbols get an empty list, which is what the library returns for them.

export interface FixtureFundamentalsOptions {
  period1: Date | string | number;
  period2?: Date | string | number;
  type: string;
  module: string;
}

const TYPES = ["quarterly", "annual", "trailing"];
const MODULES = ["financials", "balance-sheet", "cash-flow", "all"];

function toMs(value: Date | string | number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  return Date.parse(value);
}

interface Quarter {
  /** Calendar quarter end (day number). */
  end: number;
  revenue: number;
  eps: number;
}

interface Period {
  end: number;
  months: 3 | 12;
  /** The quarters the period adds up, oldest first. */
  quarters: Quarter[];
}

/** How much a quarter's line moves around the company's figure, from -1 to 1: the same for a quarter on every day. */
function wiggle(security: Security, line: string, quarter: Quarter): number {
  return between(-1, 1, security.symbol, line, quarter.end);
}

/**
 * The income statement of one quarter. Net income comes from the quarter's EPS; operating income moves with it (at the
 * company's ratio of operating to net margin) and stays above pretax income, so other items cost a little rather than
 * add to earnings; gross profit stays at least five points of revenue above operating income.
 */
function quarterIncome(security: Security, quarter: Quarter): Record<string, number> {
  const figures = companyFigures(security);
  const revenue = Math.round(quarter.revenue);
  const netIncome = Math.round(quarter.eps * figures.sharesOutstanding);
  const pretaxIncome = Math.round(netIncome / 0.82);
  const operatingToNet = figures.profitMargin > 0 ? figures.operatingMargin / figures.profitMargin : 1.3;
  const operatingIncome =
    netIncome > 0
      ? Math.round(Math.max(netIncome * operatingToNet * (1 + 0.03 * wiggle(security, "operating", quarter)), pretaxIncome * 1.03))
      : Math.round(netIncome + revenue * 0.03 * (1 + 0.3 * wiggle(security, "operating", quarter)));
  const grossProfit = Math.round(Math.max(revenue * figures.grossMargin * (1 + 0.02 * wiggle(security, "gross", quarter)), operatingIncome + revenue * 0.05));
  const operatingExpense = grossProfit - operatingIncome;
  const researchAndDevelopment = Math.round(
    Math.min(revenue * between(0.02, 0.15, security.symbol, "rd") * (1 + 0.03 * wiggle(security, "rd", quarter)), operatingExpense * 0.6),
  );
  const depreciation = Math.round(revenue * (figures.ebitdaMargin - figures.operatingMargin) * (1 + 0.05 * wiggle(security, "depreciation", quarter)));
  return {
    totalRevenue: revenue,
    costOfRevenue: revenue - grossProfit,
    grossProfit,
    researchAndDevelopment,
    sellingGeneralAndAdministration: operatingExpense - researchAndDevelopment,
    operatingExpense,
    operatingIncome,
    pretaxIncome,
    taxProvision: pretaxIncome - netIncome,
    netIncome,
    EBITDA: operatingIncome + depreciation,
    depreciationAndAmortization: depreciation,
  };
}

/** The cash flow statement of one quarter (its income statement given). */
function quarterCashFlow(security: Security, quarter: Quarter, income: Record<string, number>): Record<string, number> {
  const revenue = quarter.revenue;
  const operatingCashFlow = Math.round(income.operatingIncome + revenue * 0.06 * (1 + 0.15 * wiggle(security, "cash", quarter)));
  const capitalExpenditure = -Math.round(revenue * between(0.03, 0.12, security.symbol, "capex") * (1 + 0.08 * wiggle(security, "capex", quarter)));
  const buybacks = -Math.round(revenue * between(0, 0.15, security.symbol, "buyback") * (1 + 0.15 * wiggle(security, "buyback", quarter)));
  return {
    operatingCashFlow,
    capitalExpenditure,
    freeCashFlow: operatingCashFlow + capitalExpenditure,
    repurchaseOfCapitalStock: buybacks,
    dividends: -Math.round(quarter.eps * companyFigures(security).sharesOutstanding * (security.dividendYield > 0 ? 0.3 : 0)),
    investingCashFlow: Math.round(capitalExpenditure * 1.4),
    stockBasedCompensation: Math.round(revenue * 0.02 * (1 + 0.05 * wiggle(security, "compensation", quarter))),
    depreciationAndAmortization: income.depreciationAndAmortization,
  };
}

/** Line by line sums of a period's quarters. */
function sumOf(rows: ReadonlyArray<Record<string, number>>): Record<string, number> {
  const total: Record<string, number> = {};
  for (const row of rows) for (const [key, value] of Object.entries(row)) total[key] = (total[key] ?? 0) + value;
  return total;
}

function financialRow(security: Security, period: Period): Record<string, number> {
  const shares = companyFigures(security).sharesOutstanding;
  const eps = round(period.quarters.reduce((sum, quarter) => sum + quarter.eps, 0), 2);
  const sum = sumOf(period.quarters.map((quarter) => quarterIncome(security, quarter)));
  return {
    totalRevenue: sum.totalRevenue,
    operatingRevenue: sum.totalRevenue,
    costOfRevenue: sum.costOfRevenue,
    grossProfit: sum.grossProfit,
    researchAndDevelopment: sum.researchAndDevelopment,
    sellingGeneralAndAdministration: sum.sellingGeneralAndAdministration,
    operatingExpense: sum.operatingExpense,
    operatingIncome: sum.operatingIncome,
    pretaxIncome: sum.pretaxIncome,
    taxProvision: sum.taxProvision,
    netIncome: sum.netIncome,
    netIncomeCommonStockholders: sum.netIncome,
    dilutedEPS: eps,
    basicEPS: round(eps * 1.005, 2),
    dilutedAverageShares: shares,
    basicAverageShares: Math.round(shares * 0.995),
    EBIT: sum.operatingIncome,
    EBITDA: sum.EBITDA,
    normalizedEBITDA: sum.EBITDA,
    totalExpenses: sum.totalRevenue - sum.operatingIncome,
  };
}

function cashFlowRow(security: Security, period: Period): Record<string, number> {
  const sum = sumOf(period.quarters.map((quarter) => quarterCashFlow(security, quarter, quarterIncome(security, quarter))));
  const row: Record<string, number> = {
    operatingCashFlow: sum.operatingCashFlow,
    capitalExpenditure: sum.capitalExpenditure,
    freeCashFlow: sum.freeCashFlow,
    repurchaseOfCapitalStock: sum.repurchaseOfCapitalStock,
    investingCashFlow: sum.investingCashFlow,
    financingCashFlow: sum.repurchaseOfCapitalStock + sum.dividends,
    stockBasedCompensation: sum.stockBasedCompensation,
    depreciationAndAmortization: sum.depreciationAndAmortization,
  };
  if (sum.dividends < 0) Object.assign(row, { cashDividendsPaid: sum.dividends, commonStockDividendPaid: sum.dividends });
  return row;
}

/** Balances at the period's end (the same for a year and its last quarter). */
function balanceSheetRow(security: Security, period: Period): Record<string, number> {
  const figures = companyFigures(security);
  const equity = figures.bookValuePerShare * figures.sharesOutstanding;
  return {
    totalAssets: Math.round(equity + figures.totalDebt * 1.6),
    totalDebt: Math.round(figures.totalDebt),
    stockholdersEquity: Math.round(equity),
    cashAndCashEquivalents: Math.round(figures.totalCash * 0.6),
    ordinarySharesNumber: figures.sharesOutstanding,
    workingCapital: Math.round((period.quarters.at(-1)?.revenue ?? 0) * 0.4),
  };
}

/** A quarter's results: reported ones (up to `lastReported`) at their actuals, later ones at the estimates. */
function quarterOf(security: Security, end: number, lastReported: number): Quarter {
  const result = quarterResult(security, end);
  const reported = end <= lastReported;
  return { end, revenue: reported ? result.revenue : result.revenueEstimate, eps: reported ? result.eps : result.epsEstimate };
}

/**
 * The reported quarters of the earnings history, the trailing four quarters, or the five latest fully reported calendar
 * years, oldest first: the same results as the earnings modules.
 */
function periodsOf(security: Security, latest: number, type: string): Period[] {
  const schedule = earningsSchedule(security, latest);
  if (!schedule) return [];
  const reported: Quarter[] = schedule.history.map((report) => ({ end: report.periodEnd, revenue: report.revenueActual ?? 0, eps: report.epsActual ?? 0 }));
  if (type === "quarterly") return reported.slice(-6).map((quarter) => ({ end: quarter.end, months: 3, quarters: [quarter] }));
  const lastQuarter = reported.at(-1)?.end ?? latest;
  if (type === "trailing") return [{ end: lastQuarter, months: 12, quarters: reported.slice(-4) }];
  const lastYear = lastReportedYear(schedule);
  return [4, 3, 2, 1, 0].map((back) => ({
    end: dayNumber(lastYear - back, 12, 31),
    months: 12 as const,
    quarters: quarterEndsOf(lastYear - back).map((end) => quarterOf(security, end, lastQuarter)),
  }));
}

/** fundamentalsTimeSeries(symbol, options) in fixture mode. */
export function buildFundamentals(symbol: string, options: FixtureFundamentalsOptions, now: number): Array<Record<string, unknown>> {
  if (!TYPES.includes(options.type)) throw new Error("yahooFinance.fundamentalsTimeSeries() option type invalid.");
  if (!MODULES.includes(options.module)) throw new Error("yahooFinance.fundamentalsTimeSeries() option module invalid.");
  const security = securityOf(symbol);
  if (!security || security.type !== "EQUITY") return [];
  const latest = latestCompletedSession(security.profile, now);
  const from = toMs(options.period1, 0);
  const to = toMs(options.period2, now);
  const periods = periodsOf(security, latest, options.type).filter((period) => period.end * DAY_MS >= from && period.end * DAY_MS <= to);
  const typeName = options.module === "all" ? "ALL" : options.module.toUpperCase().replace("-", "_");
  return periods.map((period, index) => {
    let fields: Record<string, number> = {};
    if (options.module === "financials" || options.module === "all") fields = { ...fields, ...financialRow(security, period) };
    if (options.module === "cash-flow" || options.module === "all") fields = { ...fields, ...cashFlowRow(security, period) };
    if (options.module === "balance-sheet" || options.module === "all") fields = { ...fields, ...balanceSheetRow(security, period) };
    // Yahoo's oldest period carries only a handful of values.
    if (index === 0 && periods.length > 2) fields = Object.fromEntries(Object.entries(fields).slice(0, 3));
    return { TYPE: typeName, date: new Date(period.end * DAY_MS), periodType: period.months === 3 ? "3M" : "12M", ...fields };
  });
}
