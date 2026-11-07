import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiErrorBody } from "@/types/api";
import type { AnalystActivity, EarningsDetail } from "@/types/earnings";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ quoteSummary: vi.fn() }));
vi.mock("./yahoo", async (importOriginal) => {
  const original = await importOriginal<typeof import("./yahoo")>();
  return { ...original, yf: { quoteSummary: mocks.quoteSummary } };
});

import { GET as analystsRoute } from "@/app/api/stock/[symbol]/analysts/route";
import { GET as earningsRoute } from "@/app/api/stock/[symbol]/earnings/route";

import { clearCache } from "./cache";
import {
  getAnalystActivity,
  getEarningsDetail,
  mapAnalystActivity,
  mapEarningsDetail,
  mapQuarters,
  monthEndAfter,
  pickNextReport,
  quarterLabel,
  uncachedAnalystCalls,
  uncachedEarningsCalls,
} from "./earnings";
import { resetRateLimits } from "./rate-limit";

// Fixtures: real quoteSummary payloads recorded on 2026-11-07 (validateResult false, dates already converted), trimmed
// to the fields the mapper reads. NVDA is the plain case; AAPL shows the lagging "0q" label five days after its report;
// PLTR shows a stale calendarEvents consensus and a stale "0q" row; 0700.HK reports in CNY on a Hong Kong listing.

const NOW = Date.parse("2026-11-07T15:00:00Z");
const DAY = 86_400_000;

type Row = Record<string, unknown>;

const history = (quarter: string, epsActual: number, epsEstimate: number, surprisePercent: number, currency = "USD"): Row => ({
  epsActual,
  epsEstimate,
  surprisePercent,
  quarter: `${quarter}T00:00:00.000Z`,
  currency,
});

const chart = (date: string, fiscalQuarter: string, end: string, actual: number, estimate: number, surprisePct: string, reportedDate: string): Row => ({
  date,
  fiscalQuarter,
  actual,
  estimate,
  surprisePct,
  periodEndDate: `${end}T00:00:00.000Z`,
  reportedDate,
});

const trend = (
  period: string,
  end: string,
  eps: [avg: number, low: number, high: number, yearAgoEps: number, analysts: number],
  revenue: [avg: number, low: number, high: number, analysts: number],
  epsTrend: [current: number, d7: number, d30: number, d60: number, d90: number],
  revisions: [up7: number, up30: number, down7: number, down30: number],
  currency = "USD",
): Row => ({
  period,
  endDate: `${end}T00:00:00.000Z`,
  earningsEstimate: { avg: eps[0], low: eps[1], high: eps[2], yearAgoEps: eps[3], numberOfAnalysts: eps[4], earningsCurrency: currency },
  revenueEstimate: { avg: revenue[0], low: revenue[1], high: revenue[2], numberOfAnalysts: revenue[3] },
  epsTrend: { current: epsTrend[0], "7daysAgo": epsTrend[1], "30daysAgo": epsTrend[2], "60daysAgo": epsTrend[3], "90daysAgo": epsTrend[4] },
  epsRevisions: { upLast7days: revisions[0], upLast30days: revisions[1], downLast7Days: revisions[2], downLast30days: revisions[3], downLast90days: null },
});

const calendar = (date: string[], estimate: boolean, eps: [number, number, number], revenue: [number, number, number]): Row => ({
  earnings: {
    earningsDate: date,
    isEarningsDateEstimate: estimate,
    earningsAverage: eps[0],
    earningsLow: eps[1],
    earningsHigh: eps[2],
    revenueAverage: revenue[0],
    revenueLow: revenue[1],
    revenueHigh: revenue[2],
  },
});

const NVDA: Row = {
  earnings: {
    earningsChart: {
      quarterly: [
        chart("3Q2025", "3Q2026", "2025-10-31", 1.3, 1.25647, "3.46", "2025-11-19T21:20:00.000Z"),
        chart("4Q2025", "4Q2026", "2026-01-31", 1.62, 1.53812, "5.32", "2026-02-25T21:31:25.000Z"),
        chart("1Q2026", "1Q2027", "2026-04-30", 1.87, 1.77191, "5.54", "2026-05-20T20:20:00.000Z"),
        chart("2Q2026", "2Q2027", "2026-07-31", 2.22, 2.09113, "6.16", "2026-08-26T20:20:00.000Z"),
      ],
      earningsDate: ["2026-11-17T21:00:00.000Z"],
      isEarningsDateEstimate: false,
    },
    financialCurrency: "USD",
  },
  earningsHistory: {
    history: [
      history("2025-10-31", 1.3, 1.25647, 0.0346),
      history("2026-01-31", 1.62, 1.53812, 0.053200003),
      history("2026-04-30", 1.87, 1.77191, 0.0554),
      history("2026-07-31", 2.22, 2.09113, 0.0616),
    ],
  },
  earningsTrend: {
    trend: [
      trend("0q", "2026-10-31", [2.47325, 2.34, 2.7, 1.3, 44], [108976833310, 104937000000, 116251000000, 45], [2.47325, 2.47325, 2.47356, 2.46864, 2.34245], [0, 0, 1, 1]),
      trend("+1q", "2027-01-31", [2.74622, 2.56, 3.117, 1.62, 42], [124482690590, 117290260810, 138490000000, 42], [2.74622, 2.74622, 2.74295, 2.74157, 2.65454], [0, 0, 1, 1]),
      trend("0y", "2027-01-31", [9.31242, 9.01, 10.1, 4.77, 51], [411653417250, 403206319550, 426885000000, 54], [9.31242, 9.31242, 9.30713, 9.28024, 8.95389], [2, 2, 0, 0]),
      trend("+1y", "2028-01-31", [15.9146, 12.84835, 18.746, 9.31242, 52], [692206374410, 506483000000, 778471000000, 57], [15.9146, 15.9146, 15.68263, 15.23752, 12.81483], [3, 7, 0, 0]),
    ],
  },
  calendarEvents: calendar(["2026-11-17T21:00:00.000Z"], false, [2.47325, 2.34, 2.7], [108976833310, 104937000000, 116251000000]),
  financialData: { financialCurrency: "USD" },
};

const AAPL: Row = {
  earnings: {
    earningsChart: {
      quarterly: [
        chart("3Q2025", "4Q2025", "2025-09-30", 1.85, 1.77112, "4.45", "2025-10-30T20:30:00.000Z"),
        chart("4Q2025", "1Q2026", "2025-12-31", 2.84, 2.6708, "6.34", "2026-01-29T21:30:00.000Z"),
        chart("1Q2026", "2Q2026", "2026-03-31", 2.01, 1.94275, "3.46", "2026-04-30T20:30:00.000Z"),
        chart("2Q2026", "3Q2026", "2026-06-30", 2.02, 1.89243, "6.74", "2026-07-30T20:30:28.000Z"),
        chart("3Q2026", "4Q2026", "2026-09-30", 2.1, 1.9852, "5.78", "2026-11-02T21:30:00.000Z"),
      ],
      earningsDate: ["2027-01-28T21:00:00.000Z"],
      isEarningsDateEstimate: true,
    },
    financialCurrency: "USD",
  },
  earningsHistory: {
    history: [
      history("2025-09-30", 1.85, 1.77112, 0.044499997),
      history("2025-12-31", 2.84, 2.6708, 0.0634),
      history("2026-03-31", 2.01, 1.94275, 0.0346),
      history("2026-06-30", 2.02, 1.89243, 0.0674),
      history("2026-09-30", 2.1, 1.9852, 0.057800002),
    ],
  },
  earningsTrend: {
    trend: [
      // Labelled with the reported September quarter, but the numbers are the December quarter's.
      trend("0q", "2026-09-30", [2.91805, 2.83, 3.18, 1.85, 27], [156459329920, 154257600000, 158132000000, 22], [2.91805, 2.91107, 2.90586, 2.9109, 2.90495], [2, 3, 1, 3]),
      trend("+1q", "2027-03-31", [2.15211, 1.87, 2.48998, 2.01, 23], [124000404410, 110769700000, 142811158840, 21], [2.15211, 2.22348, 2.23415, 2.2432, 2.20533], [1, 3, 2, 5]),
      trend("0y", "2027-09-30", [9.40577, 8.34, 10.05989, 7.46, 38], [477692148210, 476002000000, 484000000000, 37], [8.84498, 8.84138, 8.8342, 8.82452, 8.79768], [1, 3, 2, 5]),
      // Same year end as the 0y row.
      trend("+1y", "2027-09-30", [10.53146, 8.57, 11.61414, 8.83844, 34], [569273412390, 492192400000, 637905000000, 34], [10.53146, 10.8295, 10.82781, 10.80139, 10.73383], [2, 4, 0, 2]),
    ],
  },
  calendarEvents: calendar(["2027-01-28T21:00:00.000Z"], true, [2.91742, 2.83, 3.18], [156459329920, 154257600000, 158132000000]),
  financialData: { financialCurrency: "USD" },
};

const PLTR: Row = {
  earnings: {
    earningsChart: {
      quarterly: [
        chart("3Q2025", "3Q2025", "2025-09-30", 0.21, 0.16738, "25.46", "2025-11-03T21:05:00.000Z"),
        chart("4Q2025", "4Q2025", "2025-12-31", 0.25, 0.2302, "8.6", "2026-02-02T21:05:00.000Z"),
        chart("1Q2026", "1Q2026", "2026-03-31", 0.33, 0.27946, "18.08", "2026-05-04T20:05:00.000Z"),
        chart("3Q2026", "3Q2026", "2026-09-30", 0.44, 0.40585, "8.41", "2026-11-02T21:05:00.000Z"),
      ],
      earningsDate: ["2027-02-01T21:00:00.000Z"],
      isEarningsDateEstimate: true,
    },
    financialCurrency: "USD",
  },
  earningsHistory: {
    history: [
      history("2025-09-30", 0.21, 0.16738, 0.2546),
      history("2025-12-31", 0.25, 0.2302, 0.086),
      history("2026-03-31", 0.33, 0.27946, 0.1808),
      history("2026-09-30", 0.44, 0.40585, 0.0841),
    ],
  },
  earningsTrend: {
    trend: [
      // Still the reported quarter's estimate.
      trend("0q", "2026-09-30", [0.40585, 0.38, 0.45, 0.21, 25], [2670136910, 2650100000, 2771399940, 23], [0.52023, 0.4634, 0.46381, 0.4645, 0.46015], [0, 0, 3, 6]),
      trend("+1q", "2026-12-31", [0.52023, 0.5, 0.59, 0.25, 24], [2716509160, 2478300000, 2924000000, 18], [0.51941, 0.48042, 0.47592, 0.47838, 0.47485], [1, 1, 0, 1]),
      trend("0y", "2026-12-31", [1.70205, 1.64, 1.75063, 0.75, 29], [8550516260, 8531600000, 8652857940, 27], [1.70205, 1.6144, 1.62012, 1.60272, 1.59479], [0, 0, 3, 5]),
      trend("+1y", "2027-12-31", [2.53522, 2.11, 2.90574, 1.70205, 31], [13112152240, 12000000000, 14667032850, 30], [2.53522, 2.33671, 2.34416, 2.31424, 2.29976], [1, 3, 1, 2]),
    ],
  },
  // The next report date with the consensus of the quarter just reported.
  calendarEvents: calendar(["2027-02-01T21:00:00.000Z"], true, [0.40585, 0.38, 0.45], [2670136910, 2650100000, 2771399940]),
  financialData: { financialCurrency: "USD" },
};

const TENCENT: Row = {
  earnings: { earningsChart: { quarterly: [chart("2Q2026", "2Q2026", "2026-06-30", 7.433, 7.23544, "2.73", "2026-08-12T08:31:36.000Z")] }, financialCurrency: "CNY" },
  earningsHistory: { history: [history("2026-06-30", 7.433, 7.23544, 0.0273, "CNY")] },
  earningsTrend: {
    trend: [trend("0q", "2026-09-30", [7.21612, 6.61, 7.82, 7.575, 12], [210364772310, 206627133500, 213679000000, 21], [7.21612, 7.23279, 7.30612, 7.26949, 7.52026], [0, 0, 1, 6], "CNY")],
  },
  calendarEvents: calendar(["2026-11-18T08:10:00.000Z"], false, [7.21612, 6.61, 7.82], [210364772310, 206627133500, 213679000000]),
  financialData: { financialCurrency: "CNY" },
};

const action = (date: string, firm: string, fromGrade: string, toGrade: string, act: string, targetAction: string, current: number, prior: number): Row => ({
  epochGradeDate: new Date(date),
  firm,
  fromGrade,
  toGrade,
  action: act,
  priceTargetAction: targetAction,
  currentPriceTarget: current,
  priorPriceTarget: prior,
});

const NVDA_ANALYSTS: Row = {
  recommendationTrend: {
    trend: [
      { period: "-3m", strongBuy: 9, buy: 48, hold: 2, sell: 1, strongSell: 0 },
      { period: "0m", strongBuy: 10, buy: 49, hold: 2, sell: 1, strongSell: 0 },
      { period: "-1m", strongBuy: 10, buy: 49, hold: 2, sell: 1, strongSell: 0 },
      { period: "-2m", strongBuy: 10, buy: 49, hold: 2, sell: 1, strongSell: 0 },
    ],
  },
  upgradeDowngradeHistory: {
    history: [
      action("2026-11-02T12:29:14.000Z", "Melius Research", "Buy", "Buy", "main", "Lowers", 315, 420),
      action("2026-10-22T09:50:43.000Z", "Needham", "Buy", "Buy", "reit", "Maintains", 300, 300),
      action("2026-09-10T14:02:40.000Z", "Piper Sandler", "", "Overweight", "init", "Announces", 300, 0),
      action("2026-08-27T19:31:05.000Z", "Citigroup", "Buy", "Buy", "main", "Raises", 315, 300),
      // Older than 90 days: dropped before caching.
      action("2026-07-14T11:17:59.000Z", "Keybanc", "Overweight", "Overweight", "main", "Raises", 330, 310),
    ],
  },
  financialData: {
    currentPrice: 186.64,
    targetHighPrice: 515,
    targetLowPrice: 180,
    targetMeanPrice: 327.1431,
    targetMedianPrice: 315,
    recommendationMean: 1.29032,
    recommendationKey: "strong_buy",
    numberOfAnalystOpinions: 58,
    financialCurrency: "USD",
  },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearCache();
  resetRateLimits();
  mocks.quoteSummary.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("date helpers", () => {
  it("steps to month ends and labels quarters the way Yahoo does", () => {
    expect(monthEndAfter("2026-09-30", 3)).toBe("2026-12-31");
    expect(monthEndAfter("2025-11-30", 3)).toBe("2026-02-28");
    expect(monthEndAfter("2026-12-31", -12)).toBe("2025-12-31");
    expect(quarterLabel("2026-09-30")).toBe("3Q2026");
    expect(quarterLabel("2025-10-31")).toBe("3Q2025");
    expect(quarterLabel("2026-01-31")).toBe("4Q2025");
  });
});

describe("mapEarningsDetail", () => {
  it("maps a plain payload: next report, calendar consensus with analyst counts, history oldest first", () => {
    const detail = mapEarningsDetail("NVDA", NVDA, NOW)!;
    expect(detail).toMatchObject({
      symbol: "NVDA",
      financialCurrency: "USD",
      epsCurrency: "USD",
      nextDate: "2026-11-17T21:00:00.000Z",
      nextDateEstimated: false,
      nextTiming: "post",
    });
    expect(detail.consensus).toEqual({
      epsAvg: 2.47325,
      epsLow: 2.34,
      epsHigh: 2.7,
      revenueAvg: 108976833310,
      revenueLow: 104937000000,
      revenueHigh: 116251000000,
      analysts: 44,
      revenueAnalysts: 45,
      periodEnd: "2026-10-31T00:00:00.000Z",
      source: "calendar",
    });
    expect(detail.history.map((q) => [q.period, q.fiscalPeriod, q.periodEnd?.slice(0, 10), q.epsActual])).toEqual([
      ["3Q2025", "3Q2026", "2025-10-31", 1.3],
      ["4Q2025", "4Q2026", "2026-01-31", 1.62],
      ["1Q2026", "1Q2027", "2026-04-30", 1.87],
      ["2Q2026", "2Q2027", "2026-07-31", 2.22],
    ]);
    expect(detail.history[3].surprise).toBeCloseTo((2.22 - 2.09113) / 2.09113, 10);
    expect(detail.history[3].reportedAt).toBe("2026-08-26T20:20:00.000Z");
    expect(detail.estimates.map((e) => [e.period, e.periodEnd?.slice(0, 10), e.relabeled ?? false])).toEqual([
      ["0q", "2026-10-31", false],
      ["+1q", "2027-01-31", false],
      ["0y", "2027-01-31", false],
      ["+1y", "2028-01-31", false],
    ]);
    expect(detail.estimates[0]).toMatchObject({
      analysts: 44,
      revenueAnalysts: 45,
      epsTrend: { current: 2.47325, d7: 2.47325, d30: 2.47356, d60: 2.46864, d90: 2.34245 },
      revisions: { up7: 0, up30: 0, down7: 1, down30: 1 },
    });
  });

  it("relabels the lagging 0q row after a report and fills its year-ago EPS from history (AAPL)", () => {
    const detail = mapEarningsDetail("AAPL", AAPL, NOW)!;
    const quarterly = detail.estimates.filter((e) => e.period === "0q" || e.period === "+1q");
    expect(quarterly.map((e) => [e.period, e.periodEnd?.slice(0, 10), e.relabeled ?? false, e.epsAvg, e.yearAgoEps])).toEqual([
      ["0q", "2026-12-31", true, 2.91805, 2.84],
      ["+1q", "2027-03-31", false, 2.15211, 2.01],
    ]);
    // The +1y row shared the 0y year end; it moves a year.
    expect(detail.estimates.filter((e) => e.period.endsWith("y")).map((e) => [e.period, e.periodEnd?.slice(0, 10)])).toEqual([
      ["0y", "2027-09-30"],
      ["+1y", "2028-09-30"],
    ]);
    expect(detail.consensus).toMatchObject({ epsAvg: 2.91742, analysts: 27, revenueAnalysts: 22, periodEnd: "2026-12-31T00:00:00.000Z", source: "calendar" });
    expect(detail).toMatchObject({ nextDate: "2027-01-28T21:00:00.000Z", nextDateEstimated: true, nextTiming: null });
    expect(detail.history).toHaveLength(5);
    expect(detail.history.at(-1)).toMatchObject({ period: "3Q2026", fiscalPeriod: "4Q2026", epsActual: 2.1 });
  });

  it("rejects a stale calendarEvents consensus and a stale 0q row, using the upcoming quarter instead (PLTR)", () => {
    const detail = mapEarningsDetail("PLTR", PLTR, NOW)!;
    expect(detail.estimates.map((e) => e.period)).toEqual(["+1q", "0y", "+1y"]);
    expect(detail.consensus).toEqual({
      epsAvg: 0.52023,
      epsLow: 0.5,
      epsHigh: 0.59,
      revenueAvg: 2716509160,
      revenueLow: 2478300000,
      revenueHigh: 2924000000,
      analysts: 24,
      revenueAnalysts: 18,
      periodEnd: "2026-12-31T00:00:00.000Z",
      source: "trend",
    });
    expect(detail.nextDate).toBe("2027-02-01T21:00:00.000Z");
  });

  it("keeps the financial currency and gives no session timing to a listing outside the US (0700.HK)", () => {
    const detail = mapEarningsDetail("0700.HK", TENCENT, NOW)!;
    expect(detail).toMatchObject({ financialCurrency: "CNY", epsCurrency: "CNY", nextDate: "2026-11-18T08:10:00.000Z", nextDateEstimated: false, nextTiming: null });
    expect(detail.consensus).toMatchObject({ epsAvg: 7.21612, analysts: 12, source: "calendar" });
  });

  it("treats two listed dates as an estimated window and skips dates before the last report", () => {
    const raw = {
      ...NVDA,
      calendarEvents: calendar(["2026-08-26T20:20:00.000Z", "2026-11-17T21:00:00.000Z", "2026-11-19T21:00:00.000Z"], false, [2.47325, 2.34, 2.7], [1, 1, 1]),
    };
    const detail = mapEarningsDetail("NVDA", raw, NOW)!;
    expect(detail.nextDate).toBe("2026-11-17T21:00:00.000Z");
    expect(detail.nextDateEstimated).toBe(true);
    expect(detail.nextTiming).toBeNull();
  });

  it("returns null for a payload without earnings data", () => {
    expect(mapEarningsDetail("SPY", { financialData: {} }, NOW)).toBeNull();
  });
});

describe("mapQuarters", () => {
  it("recomputes surprises, falls back to the percent string, and keeps the last five quarters", () => {
    const rows = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].map((end, i) => history(end, 1 + i / 10, 1, 0));
    const quarters = mapQuarters(rows, [chart("2Q2026", "2Q2026", "2026-06-30", 1.5, Number.NaN, "5.78", "2026-07-30T20:30:00.000Z")]);
    expect(quarters).toHaveLength(5);
    expect(quarters[0].periodEnd).toBe("2025-06-30T00:00:00.000Z");
    expect(quarters[0].surprise).toBeCloseTo(0.1, 10);
    // History has the estimate (1): the surprise is computed from it, not taken from either module's percent.
    expect(quarters[4].surprise).toBeCloseTo(0.5, 10);
    const chartOnly = mapQuarters([], [{ ...chart("2Q2026", "2Q2026", "2026-06-30", 1.5, 0, "5.78", "2026-07-30T20:30:00.000Z"), estimate: null }]);
    expect(chartOnly[0].surprise).toBeCloseTo(0.0578, 10);
    expect(chartOnly[0].period).toBe("2Q2026");
  });
});

describe("pickNextReport", () => {
  const quarters = mapQuarters([history("2026-09-30", 2.1, 1.9852, 0.0578)], [chart("3Q2026", "4Q2026", "2026-09-30", 2.1, 1.9852, "5.78", "2026-11-02T21:30:00.000Z")]);

  it("keeps a report from the last three days while its result is not in yet", () => {
    expect(pickNextReport(["2026-11-05T21:00:00.000Z"], [], NOW)).toBe("2026-11-05T21:00:00.000Z");
    expect(pickNextReport(["2026-11-01T21:00:00.000Z"], [], NOW)).toBeNull();
  });

  it("ignores the report that history already holds", () => {
    expect(pickNextReport(["2026-11-02T21:30:00.000Z"], quarters, NOW)).toBeNull();
    expect(pickNextReport(["2027-01-28T21:00:00.000Z", "2026-11-02T21:30:00.000Z"], quarters, NOW)).toBe("2027-01-28T21:00:00.000Z");
  });
});

describe("mapAnalystActivity", () => {
  it("orders months newest first, keeps 90 days of actions newest first and blanks missing grades and targets", () => {
    const activity = mapAnalystActivity("NVDA", NVDA_ANALYSTS, NOW)!;
    expect(activity.trend.map((t) => t.period)).toEqual(["0m", "-1m", "-2m", "-3m"]);
    expect(activity.trend[0]).toEqual({ period: "0m", strongBuy: 10, buy: 49, hold: 2, sell: 1, strongSell: 0 });
    expect(activity.actions.map((a) => a.firm)).toEqual(["Melius Research", "Needham", "Piper Sandler", "Citigroup"]);
    expect(activity.actions[0]).toEqual({
      date: "2026-11-02T12:29:14.000Z",
      firm: "Melius Research",
      fromGrade: "Buy",
      toGrade: "Buy",
      action: "main",
      priceTargetAction: "Lowers",
      currentTarget: 315,
      priorTarget: 420,
    });
    expect(activity.actions[2]).toMatchObject({ fromGrade: null, toGrade: "Overweight", priorTarget: null });
    expect(activity).toMatchObject({
      targetMean: 327.1431,
      targetHigh: 515,
      targetLow: 180,
      targetMedian: 315,
      numberOfAnalysts: 58,
      recommendationMean: 1.29032,
      recommendationKey: "strong_buy",
      currentPrice: 186.64,
    });
  });

  it("caps the actions at 30", () => {
    const many = Array.from({ length: 45 }, (_, i) => action(new Date(NOW - i * DAY).toISOString(), `Firm ${i}`, "Buy", "Buy", "main", "Maintains", 100, 100));
    const activity = mapAnalystActivity("X", { upgradeDowngradeHistory: { history: many } }, NOW)!;
    expect(activity.actions).toHaveLength(30);
    expect(activity.actions[0].firm).toBe("Firm 0");
  });

  it("returns null without ratings, actions or targets", () => {
    expect(mapAnalystActivity("SPY", { financialData: {} }, NOW)).toBeNull();
  });
});

describe("getEarningsDetail and getAnalystActivity", () => {
  it("makes one quoteSummary call with the earnings modules and caches the result", async () => {
    mocks.quoteSummary.mockResolvedValue(NVDA);
    expect(uncachedEarningsCalls("NVDA")).toBe(1);
    const first = await getEarningsDetail("NVDA");
    const second = await getEarningsDetail("NVDA");
    expect(first?.symbol).toBe("NVDA");
    expect(second).toBe(first);
    expect(mocks.quoteSummary).toHaveBeenCalledTimes(1);
    expect(mocks.quoteSummary.mock.calls[0][0]).toBe("NVDA");
    expect(mocks.quoteSummary.mock.calls[0][1]).toEqual({ modules: ["earnings", "earningsHistory", "earningsTrend", "calendarEvents", "financialData"] });
    expect(mocks.quoteSummary.mock.calls[0][2]).toMatchObject({ validateResult: false });
    expect(uncachedEarningsCalls("NVDA")).toBe(0);
  });

  it("returns null for funds and unknown symbols and rethrows outages", async () => {
    mocks.quoteSummary.mockRejectedValueOnce(new Error("No fundamentals data found for symbol: SPY"));
    expect(await getEarningsDetail("SPY")).toBeNull();
    mocks.quoteSummary.mockRejectedValueOnce(new Error("Quote not found for symbol: ZZZZQX"));
    expect(await getEarningsDetail("ZZZZQX")).toBeNull();
    mocks.quoteSummary.mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { name: "TypeError" }));
    await expect(getEarningsDetail("MSFT")).rejects.toThrow("fetch failed");
  });

  it("loads analyst activity with its own modules", async () => {
    mocks.quoteSummary.mockResolvedValue(NVDA_ANALYSTS);
    expect(uncachedAnalystCalls("NVDA")).toBe(1);
    const activity = await getAnalystActivity("NVDA");
    expect(activity?.numberOfAnalysts).toBe(58);
    expect(mocks.quoteSummary.mock.calls[0][1]).toEqual({ modules: ["recommendationTrend", "upgradeDowngradeHistory", "financialData"] });
    expect(uncachedAnalystCalls("NVDA")).toBe(0);
  });
});

describe("routes", () => {
  const params = (symbol: string) => ({ params: Promise.resolve({ symbol }) });

  it("serves earnings, 404 for funds and 400 for invalid symbols", async () => {
    mocks.quoteSummary.mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") throw new Error("No fundamentals data found for symbol: SPY");
      return NVDA;
    });
    const ok = await earningsRoute(new Request("http://localhost/api/stock/NVDA/earnings"), params("NVDA"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as EarningsDetail).nextDate).toBe("2026-11-17T21:00:00.000Z");
    const fund = await earningsRoute(new Request("http://localhost/api/stock/SPY/earnings"), params("SPY"));
    expect(fund.status).toBe(404);
    expect(((await fund.json()) as ApiErrorBody).error.code).toBe("not_found");
    const bad = await earningsRoute(new Request("http://localhost/api/stock/%20/earnings"), params("%20"));
    expect(bad.status).toBe(400);
  });

  it("serves analyst activity and answers 502 when Yahoo fails", async () => {
    mocks.quoteSummary.mockResolvedValueOnce(NVDA_ANALYSTS);
    const ok = await analystsRoute(new Request("http://localhost/api/stock/NVDA/analysts"), params("NVDA"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as AnalystActivity).actions.length).toBeGreaterThan(0);
    mocks.quoteSummary.mockRejectedValueOnce(new Error("socket hang up"));
    const failed = await analystsRoute(new Request("http://localhost/api/stock/AAPL/analysts"), params("AAPL"));
    expect(failed.status).toBe(502);
  });
});
