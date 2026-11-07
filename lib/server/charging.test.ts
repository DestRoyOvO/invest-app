import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyStats, Quote, StockProfile } from "@/types/api";

vi.mock("server-only", () => ({}));

// Counting fakes for every Yahoo getter the loaders use, plus probes that read the same fake cache. The real
// getStockDetail, getCompanyNews and getSignalReport run on top, so the tests compare what charging predicts with the
// calls the loaders actually make.
const fake = vi.hoisted(() => ({
  calls: [] as string[],
  fresh: new Set<string>(),
  quoteKnown: false,
  /** Symbols Yahoo does not know: getQuote answers null, and the quote probe then sees that stored null. */
  unknown: new Set<string>(),
  summaryState: "unknown" as "unknown" | "none" | "known",
}));

const QUOTE = { symbol: "NVDA", name: "NVIDIA Corporation", quoteType: "EQUITY", marketState: "CLOSED", price: 180, stale: false } as Quote;
const SUMMARY: { profile: StockProfile; stats: KeyStats } = {
  profile: {
    symbol: "NVDA",
    name: "NVIDIA",
    longName: "NVIDIA Corporation",
    sector: "Technology",
    industry: "Semiconductors",
    exchange: null,
    currency: "USD",
    country: null,
    website: null,
    employees: null,
    summary: null,
  },
  stats: {} as KeyStats,
};

vi.mock("./yahoo", () => ({
  getQuote: async (symbol: string) => {
    fake.calls.push(`quote:${symbol}`);
    return fake.unknown.has(symbol) ? null : QUOTE;
  },
  getQuotes: async () => new Map(),
  getSummary: async (symbol: string) => {
    fake.calls.push(`summary:${symbol}`);
    return SUMMARY;
  },
  getDailyBars: async (symbol: string, days: number) => {
    fake.calls.push(`bars:${symbol}:${days}`);
    return [];
  },
  searchNews: async (term: string, count = 8) => {
    fake.calls.push(`news:${term}:${count}`);
    return [];
  },
  getChart: async () => ({ symbol: "", range: "1y", interval: "1d", bars: [] }),
  getSparkline: async () => [],
  todayInExchange: () => Date.UTC(2026, 10, 6),
  hasFreshQuote: (symbol: string) => fake.fresh.has(`quote:${symbol}`),
  hasCachedSummary: (symbol: string) => fake.fresh.has(`summary:${symbol}`),
  hasCachedDailyBars: (symbol: string, days: number) => fake.fresh.has(`bars:${symbol}:${days}`),
  hasCachedNewsSearch: (term: string, count = 8) => fake.fresh.has(`news:${term}:${count}`),
  peekQuote: (symbol: string) => (fake.unknown.has(symbol) && fake.calls.includes(`quote:${symbol}`) ? null : fake.quoteKnown ? QUOTE : undefined),
  peekSummary: () => (fake.summaryState === "known" ? SUMMARY : fake.summaryState === "none" ? null : undefined),
}));

import { clearCache } from "./cache";
import { extraUnits, MAX_COMPANY_NEWS_SEARCHES, uncachedSignalCalls, uncachedStockDetailCalls } from "./charging";
import { getStockDetail } from "./market";
import { getSignalReport } from "./signal-service";

const newsCalls = () => fake.calls.filter((call) => call.startsWith("news:"));

describe("charging for /api/stock/[symbol]", () => {
  beforeEach(() => {
    fake.calls = [];
    fake.fresh.clear();
    fake.quoteKnown = false;
    fake.unknown.clear();
    fake.summaryState = "unknown";
    clearCache();
  });

  it("predicts exactly the calls getStockDetail makes once the profile is known", async () => {
    await getStockDetail("NVDA");
    const searches = newsCalls();
    expect(searches.length).toBeGreaterThan(0);
    expect(fake.calls.length).toBe(2 + searches.length);

    fake.quoteKnown = true;
    fake.summaryState = "known";
    expect(uncachedStockDetailCalls("NVDA")).toBe(fake.calls.length);

    // Every search the loader just made is now fresh: only the quote and the summary remain.
    for (const call of searches) fake.fresh.add(call);
    expect(uncachedStockDetailCalls("NVDA")).toBe(2);
    fake.fresh.add("quote:NVDA");
    fake.fresh.add("summary:NVDA");
    expect(uncachedStockDetailCalls("NVDA")).toBe(0);
  });

  it("assumes the largest plan while the profile is unknown, never fewer calls than the loader makes", async () => {
    await getStockDetail("NVDA");
    expect(uncachedStockDetailCalls("NVDA")).toBe(2 + MAX_COMPANY_NEWS_SEARCHES);
    expect(2 + MAX_COMPANY_NEWS_SEARCHES).toBeGreaterThanOrEqual(fake.calls.length);
    // Yahoo has no summary and the quote's name is unknown: still the upper bound.
    fake.summaryState = "none";
    expect(uncachedStockDetailCalls("NVDA")).toBe(2 + MAX_COMPANY_NEWS_SEARCHES);
  });

  it("plans from the quote alone when Yahoo has no summary for the symbol", () => {
    fake.summaryState = "none";
    fake.quoteKnown = true;
    const calls = uncachedStockDetailCalls("NVDA");
    expect(calls).toBeGreaterThan(2);
    expect(calls).toBeLessThan(2 + MAX_COMPANY_NEWS_SEARCHES);
  });

  it("charges no news searches while Yahoo's answer that it does not know the symbol is cached", async () => {
    fake.unknown.add("ZZQXJ");
    // First request: nothing says the symbol is unknown yet, so the largest plan is charged.
    expect(uncachedStockDetailCalls("ZZQXJ")).toBe(2 + MAX_COMPANY_NEWS_SEARCHES);
    expect(await getStockDetail("ZZQXJ")).toBeNull();
    // The loader stops after the quote and the summary: a 404 searches no news.
    expect([...fake.calls].sort()).toEqual(["quote:ZZQXJ", "summary:ZZQXJ"]);

    // Both answers are cached now (the quote as a fresh null), so the next request makes no Yahoo call and pays none.
    fake.summaryState = "none";
    fake.fresh.add("quote:ZZQXJ");
    fake.fresh.add("summary:ZZQXJ");
    expect(uncachedStockDetailCalls("ZZQXJ")).toBe(0);
    fake.fresh.delete("summary:ZZQXJ");
    expect(uncachedStockDetailCalls("ZZQXJ")).toBe(1);

    // Once the null expires, Yahoo is asked again and might know the symbol by then: the largest plan applies again.
    fake.fresh.delete("quote:ZZQXJ");
    expect(uncachedStockDetailCalls("ZZQXJ")).toBe(2 + MAX_COMPANY_NEWS_SEARCHES);
  });
});

describe("charging for /api/stock/[symbol]/signal", () => {
  beforeEach(() => {
    fake.calls = [];
    fake.fresh.clear();
    clearCache();
  });
  afterEach(() => clearCache());

  it("predicts the loads of an uncached report and nothing once the report is cached", async () => {
    expect(uncachedSignalCalls("NVDA")).toBe(4);
    await getSignalReport("NVDA");
    expect(fake.calls).toHaveLength(4);
    expect(fake.calls).toContain("bars:SPY:540");
    // The probes must use the loader's own arguments (the 540-day history), or charging drifts from reality.
    for (const call of fake.calls) fake.fresh.add(call);
    clearCache();
    expect(uncachedSignalCalls("NVDA")).toBe(0);

    fake.fresh.clear();
    await getSignalReport("NVDA");
    expect(uncachedSignalCalls("NVDA")).toBe(0);
  });

  it("does not load the benchmark twice for the benchmark's own report", async () => {
    expect(uncachedSignalCalls("SPY")).toBe(3);
    await getSignalReport("SPY");
    expect(fake.calls).toHaveLength(3);
  });
});

describe("extraUnits", () => {
  it("charges nothing extra for the first call, which the request's own unit covers", () => {
    expect(extraUnits(0)).toBe(0);
    expect(extraUnits(1)).toBe(0);
    expect(extraUnits(7)).toBe(6);
  });
});
