import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyStats, StockProfile } from "@/types/api";

import { getProfiles, mapLimited, uncachedProfileCalls } from "./profiles";
import { getSummary, hasCachedSummary } from "./yahoo";

vi.mock("server-only", () => ({}));
vi.mock("./yahoo", () => ({ getSummary: vi.fn(), hasCachedSummary: vi.fn() }));

function summary(symbol: string, patch: Partial<StockProfile> = {}): { profile: StockProfile; stats: KeyStats } {
  const profile: StockProfile = {
    symbol,
    name: `${symbol} Inc.`,
    longName: `${symbol} Incorporated`,
    sector: "Technology",
    industry: "Software",
    exchange: "NasdaqGS",
    currency: "USD",
    country: "United States",
    website: null,
    employees: null,
    summary: null,
    ...patch,
  };
  return { profile, stats: {} as KeyStats };
}

describe("getProfiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps the summary profile fields used for exposure", async () => {
    vi.mocked(getSummary).mockImplementation(async (symbol) => summary(symbol, symbol === "SHOP" ? { sector: "Technology", country: "Canada" } : {}));
    const result = await getProfiles(["PLTR", "SHOP"]);
    expect(result.profiles.SHOP).toEqual({
      symbol: "SHOP",
      name: "SHOP Incorporated",
      sector: "Technology",
      industry: "Software",
      country: "Canada",
      currency: "USD",
    });
    expect(Object.keys(result.profiles)).toEqual(["PLTR", "SHOP"]);
    expect(result.missing).toEqual([]);
    expect(result.degraded).toBe(false);
    expect(Number.isNaN(Date.parse(result.asOf))).toBe(false);
  });

  it("lists unknown symbols as missing and failed lookups as degraded", async () => {
    vi.mocked(getSummary).mockImplementation(async (symbol) => {
      if (symbol === "GONE") return null;
      if (symbol === "FAIL") throw new Error("HTTPError 503");
      return summary(symbol, { longName: null, sector: null });
    });
    const result = await getProfiles(["GONE", "FAIL", "SPY"]);
    expect(result.missing).toEqual(["GONE", "FAIL"]);
    expect(result.degraded).toBe(true);
    expect(result.profiles.SPY).toMatchObject({ name: "SPY Inc.", sector: null });
  });

  it("counts the summaries that would need a Yahoo call", () => {
    vi.mocked(hasCachedSummary).mockImplementation((symbol) => symbol === "AAPL");
    expect(uncachedProfileCalls(["AAPL", "PLTR", "SHOP"])).toBe(2);
    expect(uncachedProfileCalls([])).toBe(0);
  });
});

describe("mapLimited", () => {
  it("keeps at most `limit` calls in flight and results in input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapLimited([5, 1, 4, 2, 3, 6, 7], 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, n));
      inFlight--;
      if (n === 4) throw new Error("four");
      return n * 10;
    });
    expect(peak).toBe(4);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual([50, 10, "x", 20, 30, 60, 70]);
    expect(await mapLimited([], 4, async () => 1)).toEqual([]);
  });
});
