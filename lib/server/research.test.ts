import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyStats, Quote, StockProfile } from "@/types/api";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  fundamentalsTimeSeries: vi.fn<(symbol: string, options: { type: string; module: string }) => Promise<unknown>>(),
  chart: vi.fn<(symbol: string, options: Record<string, unknown>) => Promise<unknown>>(),
  quoteSummary: vi.fn<(symbol: string, options: { modules: string[] }) => Promise<unknown>>(),
  getQuote: vi.fn<(symbol: string) => Promise<Quote | null>>(),
  getSummary: vi.fn<(symbol: string) => Promise<{ profile: StockProfile; stats: KeyStats } | null>>(),
}));

vi.mock("./yahoo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./yahoo")>()),
  yf: { fundamentalsTimeSeries: fake.fundamentalsTimeSeries, chart: fake.chart, quoteSummary: fake.quoteSummary },
  upstream: <T>(call: () => Promise<T>) => call(),
  callOptions: () => ({}),
  getQuote: fake.getQuote,
  getSummary: fake.getSummary,
}));

import { clearCache } from "./cache";
import {
  buildDividendHistory,
  buildPeriod,
  buildPeriods,
  dividendFrequency,
  fullRows,
  getDividends,
  getFinancials,
  getOwnership,
  insiderKind,
  insiderPrice,
  mapOwnership,
  summarizeDividends,
} from "./research";

const NOW = Date.UTC(2026, 10, 7, 12);

beforeEach(() => {
  clearCache();
  for (const mock of Object.values(fake)) mock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

/** Rows in the shape fundamentalsTimeSeries returns with validation off (dates coerced to Date objects). */
function incomeRow(date: string, values: Record<string, number>) {
  return { TYPE: "FINANCIALS", date: new Date(`${date}T00:00:00Z`), periodType: "12M", ...values };
}

const AAPL_INCOME = [
  // Yahoo's oldest annual row is a stub with a handful of fields.
  incomeRow("2022-09-30", { interestExpense: 2_931e6, interestIncome: 2_825e6 }),
  incomeRow("2023-09-30", { totalRevenue: 383_285e6, grossProfit: 169_148e6, operatingIncome: 114_301e6, netIncome: 96_995e6, dilutedEPS: 6.13, EBITDA: 125_820e6 }),
  incomeRow("2024-09-30", { totalRevenue: 391_035e6, grossProfit: 180_683e6, operatingIncome: 123_216e6, netIncome: 93_736e6, dilutedEPS: 6.08, EBITDA: 134_661e6 }),
  incomeRow("2025-09-30", { totalRevenue: 428_000e6, grossProfit: 200_000e6, operatingIncome: 140_000e6, netIncome: 115_000e6, dilutedEPS: 7.6, EBITDA: 152_000e6 }),
  incomeRow("2026-09-30", { totalRevenue: 478_834e6, grossProfit: 233_602e6, operatingIncome: 158_063e6, netIncome: 132_175e6, dilutedEPS: 8.98, EBITDA: 171_486e6 }),
];

const AAPL_CASH = [
  { TYPE: "CASH_FLOW", date: new Date("2023-09-30T00:00:00Z"), operatingCashFlow: 110_543e6, capitalExpenditure: -10_959e6, repurchaseOfCapitalStock: -77_550e6, cashDividendsPaid: -15_025e6 },
  { TYPE: "CASH_FLOW", date: new Date("2024-09-30T00:00:00Z"), operatingCashFlow: 118_254e6, capitalExpenditure: -9_447e6, repurchaseOfCapitalStock: -94_949e6, cashDividendsPaid: -15_234e6 },
  { TYPE: "CASH_FLOW", date: new Date("2025-09-30T00:00:00Z"), operatingCashFlow: 108_000e6, capitalExpenditure: -9_200e6, repurchaseOfCapitalStock: -90_000e6, cashDividendsPaid: -15_400e6 },
  { TYPE: "CASH_FLOW", date: new Date("2026-09-30T00:00:00Z"), operatingCashFlow: 145_097e6, capitalExpenditure: -9_041e6, repurchaseOfCapitalStock: -86_390e6, cashDividendsPaid: -15_721e6 },
];

describe("financial statements", () => {
  it("drops stub rows that carry less than half the fields of the fullest row", () => {
    const rows = fullRows(AAPL_INCOME);
    expect([...rows.keys()]).toEqual(["2023-09-30", "2024-09-30", "2025-09-30", "2026-09-30"]);
  });

  it("computes margins and free cash flow as operating cash flow minus capital spending", () => {
    const period = buildPeriod("2026-09-30", AAPL_INCOME[4], AAPL_CASH[3]);
    expect(period.revenue).toBe(478_834e6);
    expect(period.grossMargin).toBeCloseTo(0.4879, 4);
    expect(period.operatingMargin).toBeCloseTo(0.3301, 4);
    expect(period.netMargin).toBeCloseTo(0.276, 3);
    expect(period.freeCashFlow).toBe(145_097e6 - 9_041e6);
    expect(period).toMatchObject({ dilutedEps: 8.98, ebitda: 171_486e6, buybacks: -86_390e6, dividendsPaid: -15_721e6 });
  });

  it("leaves a bank's gross margin and free cash flow empty instead of inventing them", () => {
    const bank = buildPeriod("2025-12-31", { totalRevenue: 181_847e6, netIncome: 57_048e6, dilutedEPS: 20.02, normalizedEBITDA: 1e9 }, { operatingCashFlow: -147_782e6 });
    expect(bank.grossMargin).toBeNull();
    expect(bank.operatingMargin).toBeNull();
    expect(bank.netMargin).toBeCloseTo(0.3137, 4);
    expect(bank.freeCashFlow).toBeNull();
    expect(bank.ebitda).toBe(1e9);
  });

  it("merges statements by period end, oldest first, keeping the latest periods", () => {
    const periods = buildPeriods(AAPL_INCOME, AAPL_CASH, 3);
    expect(periods.map((p) => p.end)).toEqual(["2024-09-30", "2025-09-30", "2026-09-30"]);
    expect(periods.every((p) => p.freeCashFlow !== null)).toBe(true);
    expect(buildPeriods([], [], 4)).toEqual([]);
  });

  it("loads four statements, takes the currency from the summary and caches the result", async () => {
    fake.fundamentalsTimeSeries.mockImplementation(async (_symbol, { type, module }) => {
      if (module === "financials") return type === "annual" ? AAPL_INCOME : AAPL_INCOME.slice(2).map((row) => ({ ...row, periodType: "3M" }));
      return type === "annual" ? AAPL_CASH : AAPL_CASH.slice(1);
    });
    fake.getSummary.mockResolvedValue({ profile: { currency: "HKD" } as StockProfile, stats: { financialCurrency: "CNY" } as KeyStats });

    const data = await getFinancials("0700.HK");
    expect(data?.currency).toBe("CNY");
    expect(data?.annual).toHaveLength(4);
    expect(data?.quarterly.map((p) => p.end)).toEqual(["2024-09-30", "2025-09-30", "2026-09-30"]);
    expect(fake.fundamentalsTimeSeries).toHaveBeenCalledTimes(4);

    await getFinancials("0700.HK");
    expect(fake.fundamentalsTimeSeries).toHaveBeenCalledTimes(4);
  });

  it("returns null without statements, tolerates a partial failure and throws when everything fails", async () => {
    fake.fundamentalsTimeSeries.mockResolvedValue([]);
    fake.getSummary.mockResolvedValue(null);
    expect(await getFinancials("SPY")).toBeNull();

    clearCache();
    fake.fundamentalsTimeSeries.mockImplementation(async (_symbol, { type, module }) => {
      if (type === "quarterly") throw new Error("HTTP 500");
      return module === "financials" ? AAPL_INCOME : AAPL_CASH;
    });
    const partial = await getFinancials("AAPL");
    expect(partial?.annual).toHaveLength(4);
    expect(partial?.quarterly).toEqual([]);

    clearCache();
    fake.fundamentalsTimeSeries.mockRejectedValue(new Error("HTTP 503"));
    await expect(getFinancials("AAPL")).rejects.toThrow("HTTP 503");
  });
});

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

/** Quarterly dividends (ex-dates in February, May, August, November) at a stepped yearly rate. */
function quarterlyDividends(fromYear: number, toYear: number, perShare: (year: number) => number) {
  const events: Array<{ amount: number; date: Date }> = [];
  for (let year = fromYear; year <= toYear; year++) {
    for (const month of [1, 4, 7, 10]) {
      const date = new Date(Date.UTC(year, month, 12, 14, 30));
      if (date.getTime() <= NOW) events.push({ amount: perShare(year), date });
    }
  }
  return events;
}

function quote(overrides: Partial<Quote>): Quote {
  return { symbol: "KO", currency: "USD", price: 70, dividendRate: 2.04, dividendYield: 0.029, exDividendDate: null, dividendAmount: null, dividendDate: null, ...overrides } as Quote;
}

describe("dividends", () => {
  it("names the payment frequency from the median gap between ex-dates", () => {
    expect(dividendFrequency(["2026-02-12", "2026-05-12", "2026-08-12", "2026-11-03"])).toBe("quarterly");
    expect(dividendFrequency(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"])).toBe("monthly");
    expect(dividendFrequency(["2025-05-01", "2025-11-01", "2026-05-01"])).toBe("semiannual");
    expect(dividendFrequency(["2024-05-01", "2025-05-02", "2026-05-01"])).toBe("annual");
    expect(dividendFrequency(["2026-01-01", "2026-05-11"])).toBe("irregular");
    expect(dividendFrequency(["2026-01-01"])).toBeNull();
  });

  it("totals calendar years, the trailing year and five-year growth", () => {
    const payments = quarterlyDividends(2019, 2026, (year) => 0.4 + (year - 2019) * 0.02).map((e) => ({ exDate: e.date.toISOString().slice(0, 10), amount: e.amount }));
    const summary = summarizeDividends(payments, NOW);
    // November 2026 is still ahead of NOW, so the current year has three payments so far.
    expect(summary.years.at(-1)).toMatchObject({ year: 2026, payments: 3, partial: true });
    expect(summary.years.find((y) => y.year === 2025)).toMatchObject({ total: 2.08, payments: 4, partial: false });
    expect(summary.trailingAnnual).toBeCloseTo(0.52 + 0.54 * 3, 6);
    // 2025 total 2.08 vs 2020 total 1.68: (2.08 / 1.68)^(1/5) - 1.
    expect(summary.growth5y).toBeCloseTo((2.08 / 1.68) ** 0.2 - 1, 5);
    expect(summary.frequency).toBe("quarterly");
  });

  it("has no growth rate when either end of the five years paid nothing", () => {
    const payments = quarterlyDividends(2023, 2026, () => 0.5).map((e) => ({ exDate: e.date.toISOString().slice(0, 10), amount: e.amount }));
    expect(summarizeDividends(payments, NOW).growth5y).toBeNull();
    expect(summarizeDividends([], NOW)).toEqual({ years: [], trailingAnnual: null, growth5y: null, frequency: null });
  });

  it("builds the history with the forward yield and the announced next ex-date", () => {
    const chart = { meta: { gmtoffset: -18_000 }, events: { dividends: quarterlyDividends(2016, 2026, () => 0.51) } };
    const history = buildDividendHistory("KO", chart, quote({ exDividendDate: "2026-11-28T05:00:00.000Z", dividendAmount: 0.51, dividendDate: "2026-12-15T00:00:00.000Z" }), NOW);
    expect(history.payments[0].exDate >= "2016-11-07").toBe(true);
    // The ten-year window starts in November 2016, so 2016 has one payment: its bar is left out, the payment is not.
    expect(history.payments[0].exDate.startsWith("2016")).toBe(true);
    expect(history.years[0].year).toBe(2017);
    expect(history.payments.at(-1)).toEqual({ exDate: "2026-08-12", amount: 0.51 });
    expect(history.yield).toBeCloseTo(2.04 / 70, 6);
    expect(history.yieldBasis).toBe("forward");
    expect(history.next).toEqual({ exDate: "2026-11-28", amount: 0.51 });
    expect(history.nextPayDate).toBe("2026-12-15");

    const past = buildDividendHistory("KO", chart, quote({ dividendRate: null, dividendYield: null, exDividendDate: "2026-09-12T04:00:00.000Z", dividendDate: "2026-10-01T00:00:00.000Z" }), NOW);
    expect(past.next).toBeNull();
    expect(past.nextPayDate).toBeNull();
    expect(past.yield).toBeCloseTo((0.51 * 4) / 70, 6);
    expect(past.yieldBasis).toBe("trailing");

    // Without a price, Yahoo's own figure is used and labelled as such.
    const reported = buildDividendHistory("KO", chart, quote({ price: null, dividendYield: 0.029 }), NOW);
    expect(reported.yield).toBe(0.029);
    expect(reported.yieldBasis).toBe("reported");
  });

  it("returns an empty history for a stock that pays nothing and null for an unknown symbol", async () => {
    fake.chart.mockResolvedValue({ meta: {}, quotes: [] });
    fake.getQuote.mockResolvedValue(quote({ symbol: "BRK-B", dividendRate: null, dividendYield: null }));
    const none = await getDividends("BRK-B");
    expect(none?.payments).toEqual([]);
    expect(none?.yield).toBeNull();
    expect(none?.yieldBasis).toBeNull();

    fake.chart.mockRejectedValue(new Error("No data found, symbol may be delisted"));
    fake.getQuote.mockResolvedValue(null);
    expect(await getDividends("ZZQXJ")).toBeNull();

    fake.chart.mockRejectedValue(new Error("HTTP 503"));
    await expect(getDividends("KO")).rejects.toThrow("HTTP 503");
  });
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe("insider transactions", () => {
  it("classifies Yahoo's transaction texts", () => {
    expect(insiderKind("Sale at price 325.75 per share.")).toBe("sale");
    expect(insiderKind("Purchase at price 41.20 per share.")).toBe("buy");
    expect(insiderKind("Stock Award(Grant) at price 0.00 per share.")).toBe("award");
    expect(insiderKind("Stock Gift at price 0.00 per share.")).toBe("gift");
    expect(insiderKind("Conversion of Exercise of derivative security at price 12.00 per share.")).toBe("option");
    expect(insiderKind("")).toBe("other");
    expect(insiderKind(null)).toBe("other");
  });

  it("parses the price from the text, averaging a range from value and shares", () => {
    expect(insiderPrice("Sale at price 325.75 per share.", 2399, 781_474)).toBe(325.75);
    expect(insiderPrice("Sale at price 222.19 - 223.75 per share.", 30_460, 6_786_533)).toBeCloseTo(222.8, 1);
    expect(insiderPrice("Sale at price 222.19 - 223.75 per share.", null, null)).toBeCloseTo(222.97, 2);
    expect(insiderPrice("Sale at price 1,022.50 per share.", null, null)).toBe(1022.5);
    expect(insiderPrice("Stock Award(Grant) at price 0.00 per share.", 1000, 0)).toBeNull();
    expect(insiderPrice(null, 10, 100)).toBeNull();
  });
});

describe("ownership", () => {
  const raw = {
    majorHoldersBreakdown: { insidersPercentHeld: 0.0165, institutionsPercentHeld: 0.666, institutionsFloatPercentHeld: 0.677, institutionsCount: 7748 },
    netSharePurchaseActivity: { period: "6m", buyInfoCount: 12, buyInfoShares: 843_588, sellInfoCount: 20, sellInfoShares: 588_243, netInfoShares: 255_345, netPercentInsiderShares: 0.001, totalInsiderShares: 240_507_600 },
    insiderTransactions: {
      transactions: [
        { shares: 4130, value: 945_233, transactionText: "Sale at price 228.87 per share.", filerName: "KONDO CHRISTOPHER", filerRelation: "Officer", startDate: new Date("2024-11-18T00:00:00Z"), ownership: "D" },
        { shares: 2399, value: 781_474, transactionText: "Sale at price 325.75 per share.", filerName: "NEWSTEAD JENNIFER", filerRelation: "Officer", startDate: new Date("2026-11-03T00:00:00Z"), ownership: "D" },
        { shares: 100, value: 0, transactionText: "", filerName: "", startDate: new Date("2026-10-01T00:00:00Z") },
      ],
    },
    institutionOwnership: {
      ownershipList: [
        { reportDate: new Date("2026-06-30T00:00:00Z"), organization: "NORGES BANK", pctHeld: 0.0131, position: 190_726_866, value: 65_299_156_181, pctChange: -0.0079 },
        { reportDate: new Date("2026-06-30T00:00:00Z"), organization: "Blackrock Inc.", pctHeld: 0.08, position: 1_162_996_939, value: 398_175_256_326, pctChange: 0.016 },
      ],
    },
  };

  it("maps the four modules, newest trades first and the largest holders first", () => {
    const data = mapOwnership("AAPL", raw, NOW);
    expect(data?.breakdown).toEqual({ insiders: 0.0165, institutions: 0.666, institutionsFloat: 0.677, institutionsCount: 7748 });
    expect(data?.insiderSummary).toMatchObject({ period: "6m", buyShares: 843_588, sellShares: 588_243, netShares: 255_345 });
    expect(data?.insiderTrades.map((t) => t.name)).toEqual(["NEWSTEAD JENNIFER", "KONDO CHRISTOPHER"]);
    expect(data?.insiderTrades[0]).toMatchObject({ date: "2026-11-03", kind: "sale", price: 325.75, shares: 2399, ownership: "D" });
    expect(data?.institutions.map((i) => i.name)).toEqual(["Blackrock Inc.", "NORGES BANK"]);
    expect(data?.institutions[0]).toMatchObject({ reportDate: "2026-06-30", pctHeld: 0.08, shares: 1_162_996_939 });
  });

  it("returns null when Yahoo sends none of the modules", () => {
    expect(mapOwnership("SPY", {}, NOW)).toBeNull();
    expect(mapOwnership("SPY", null, NOW)).toBeNull();
  });

  it("asks for the four modules once, and treats an unknown symbol as no data", async () => {
    fake.quoteSummary.mockResolvedValue(raw);
    expect((await getOwnership("AAPL"))?.insiderTrades).toHaveLength(2);
    await getOwnership("AAPL");
    expect(fake.quoteSummary).toHaveBeenCalledTimes(1);
    expect(fake.quoteSummary.mock.calls[0][1].modules).toEqual(["insiderTransactions", "netSharePurchaseActivity", "majorHoldersBreakdown", "institutionOwnership"]);

    fake.quoteSummary.mockRejectedValue(new Error("Quote not found for symbol: ZZQXJ"));
    expect(await getOwnership("ZZQXJ")).toBeNull();
    fake.quoteSummary.mockRejectedValue(new Error("HTTP 503"));
    await expect(getOwnership("MSFT")).rejects.toThrow("HTTP 503");
  });
});
