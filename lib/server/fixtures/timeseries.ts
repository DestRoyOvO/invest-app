import "server-only";

import { companyFigures, earningsSchedule, lastReportedYear, trailingEps, yearResult } from "./company";
import { between, round } from "./random";
import { securityOf, type Security } from "./securities";
import { DAY_MS, dayNumber, latestCompletedSession } from "./sessions";

// fundamentalsTimeSeries() of the fixture data: income statement, cash flow and balance sheet rows per fiscal year
// (calendar years) or quarter, consistent with the earnings modules (the same quarterly revenue and EPS). Like Yahoo,
// the oldest period of a request is a thin "stub" row with only a few fields. Funds, indices and unknown symbols get an
// empty list, which is what the library returns for them.

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

interface Period {
  end: number;
  revenue: number;
  eps: number;
  months: 3 | 12;
}

function financialRow(security: Security, period: Period): Record<string, number> {
  const figures = companyFigures(security);
  const shares = figures.sharesOutstanding;
  const revenue = Math.round(period.revenue);
  const netIncome = Math.round(period.eps * shares);
  const operatingIncome = Math.round(revenue * figures.operatingMargin);
  const grossProfit = Math.round(revenue * figures.grossMargin);
  const ebitda = Math.round(revenue * figures.ebitdaMargin);
  const researchAndDevelopment = Math.round(revenue * between(0.02, 0.15, security.symbol, "rd"));
  const pretaxIncome = Math.round(netIncome / 0.82);
  return {
    totalRevenue: revenue,
    operatingRevenue: revenue,
    costOfRevenue: revenue - grossProfit,
    grossProfit,
    researchAndDevelopment,
    sellingGeneralAndAdministration: Math.max(0, grossProfit - operatingIncome - researchAndDevelopment),
    operatingExpense: grossProfit - operatingIncome,
    operatingIncome,
    pretaxIncome,
    taxProvision: pretaxIncome - netIncome,
    netIncome,
    netIncomeCommonStockholders: netIncome,
    dilutedEPS: round(period.eps, 2),
    basicEPS: round(period.eps * 1.005, 2),
    dilutedAverageShares: shares,
    basicAverageShares: Math.round(shares * 0.995),
    EBIT: operatingIncome,
    EBITDA: ebitda,
    normalizedEBITDA: ebitda,
    totalExpenses: revenue - operatingIncome,
  };
}

function cashFlowRow(security: Security, period: Period): Record<string, number> {
  const figures = companyFigures(security);
  const revenue = period.revenue;
  const operatingCashFlow = Math.round(revenue * (figures.operatingMargin + 0.06));
  const capitalExpenditure = -Math.round(revenue * between(0.03, 0.12, security.symbol, "capex"));
  const dividends = -Math.round(period.eps * figures.sharesOutstanding * (security.dividendYield > 0 ? 0.3 : 0));
  const buybacks = -Math.round(revenue * between(0, 0.15, security.symbol, "buyback"));
  const row: Record<string, number> = {
    operatingCashFlow,
    capitalExpenditure,
    freeCashFlow: operatingCashFlow + capitalExpenditure,
    repurchaseOfCapitalStock: buybacks,
    investingCashFlow: Math.round(capitalExpenditure * 1.4),
    financingCashFlow: buybacks + dividends,
    stockBasedCompensation: Math.round(revenue * 0.02),
    depreciationAndAmortization: Math.round(revenue * (figures.ebitdaMargin - figures.operatingMargin)),
  };
  if (dividends < 0) Object.assign(row, { cashDividendsPaid: dividends, commonStockDividendPaid: dividends });
  return row;
}

function balanceSheetRow(security: Security, period: Period): Record<string, number> {
  const figures = companyFigures(security);
  const equity = figures.bookValuePerShare * figures.sharesOutstanding;
  return {
    totalAssets: Math.round(equity + figures.totalDebt * 1.6),
    totalDebt: Math.round(figures.totalDebt),
    stockholdersEquity: Math.round(equity),
    cashAndCashEquivalents: Math.round(figures.totalCash * 0.6),
    ordinarySharesNumber: figures.sharesOutstanding,
    workingCapital: Math.round(period.revenue * 0.1),
  };
}

/**
 * Quarterly periods from the earnings history, the trailing four quarters, or the five latest fully reported calendar
 * years as the sums of their quarters, oldest first: the same results as the earnings modules.
 */
function periodsOf(security: Security, latest: number, type: string): Period[] {
  const schedule = earningsSchedule(security, latest);
  if (!schedule) return [];
  const quarters: Period[] = schedule.history.map((report) => ({ end: report.periodEnd, revenue: report.revenueActual ?? 0, eps: report.epsActual ?? 0, months: 3 }));
  if (type === "quarterly") return quarters.slice(-6);
  const lastQuarter = quarters.at(-1)?.end ?? latest;
  if (type === "trailing") {
    const recent = quarters.slice(-4);
    return [{ end: lastQuarter, revenue: recent.reduce((s, q) => s + q.revenue, 0), eps: trailingEps(schedule), months: 12 }];
  }
  const lastYear = lastReportedYear(schedule);
  return [4, 3, 2, 1, 0].map((back) => ({ end: dayNumber(lastYear - back, 12, 31), ...yearResult(security, lastYear - back, lastQuarter), months: 12 as const }));
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
