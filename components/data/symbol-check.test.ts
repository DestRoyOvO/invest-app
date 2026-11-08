import { describe, expect, it } from "vitest";

import type { Quote, QuotesResponse, SearchResponse } from "@/types/api";

import { checkSymbols, fetchQuoteInfo, suggestSymbols, type Fetcher } from "./symbol-check";

function quote(symbol: string, price = 100): Quote {
  return { symbol, name: `${symbol} Inc.`, currency: "USD", price, change: 1, changePercent: 1, quoteType: "EQUITY" } as Quote;
}

/** A fake API: known symbols get quotes, everything else is missing; searches answer from a table. */
function fakeApi(known: string[], searches: Record<string, string[]> = {}, options: { failQuotes?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher: Fetcher = async <T,>(url: string): Promise<T> => {
    calls.push(url);
    const parsed = new URL(url, "http://local");
    if (parsed.pathname === "/api/quotes") {
      if (options.failQuotes) throw new Error("upstream");
      const symbols = (parsed.searchParams.get("symbols") ?? "").split(",").map(decodeURIComponent);
      const body: QuotesResponse = { asOf: "", quotes: symbols.filter((s) => known.includes(s)).map((s) => quote(s)), missing: symbols.filter((s) => !known.includes(s)) };
      return body as T;
    }
    if (parsed.pathname === "/api/search") {
      const q = parsed.searchParams.get("q") ?? "";
      if (q === "boom") throw new Error("search down");
      const body: SearchResponse = { results: (searches[q] ?? []).map((symbol) => ({ symbol, name: symbol, exchange: null, type: "EQUITY" })) };
      return body as T;
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetcher, calls };
}

describe("fetchQuoteInfo", () => {
  it("asks for 50 symbols at a time and merges the answers", async () => {
    const symbols = Array.from({ length: 120 }, (_, i) => `S${i}`);
    const { fetcher, calls } = fakeApi(symbols.filter((_, i) => i % 2 === 0));
    const { found, missing } = await fetchQuoteInfo([...symbols, "S0"], fetcher);
    expect(calls).toHaveLength(3);
    expect(found.size).toBe(60);
    expect(missing).toHaveLength(60);
    expect(found.get("S0")).toEqual({ name: "S0 Inc.", currency: "USD", price: 100, change: 1, changePercent: 1, quoteType: "EQUITY" });
  });

  it("encodes symbols such as ^GSPC and BRK-B", async () => {
    const { fetcher, calls } = fakeApi(["^GSPC"]);
    await fetchQuoteInfo(["^GSPC"], fetcher);
    expect(calls[0]).toBe("/api/quotes?symbols=%5EGSPC");
  });
});

describe("suggestSymbols", () => {
  it("collects up to three matches from the queries in order, without the symbol itself", async () => {
    const { fetcher } = fakeApi([], { BRKB: ["BRKB", "BRK-B"], "Berkshire Hathaway": ["BRK-A", "BRK-B", "BH", "BRK.L"] });
    expect(await suggestSymbols(["BRKB", "Berkshire Hathaway"], "BRKB", fetcher)).toEqual(["BRK-B", "BRK-A", "BH"]);
  });

  it("matches Chinese names locally and survives a failed search", async () => {
    const { fetcher, calls } = fakeApi([]);
    expect(await suggestSymbols(["腾讯"], "TENCENT", fetcher)).toContain("0700.HK");
    expect(calls).toEqual([]);
    expect(await suggestSymbols(["boom", ""], "X", fetcher)).toEqual([]);
  });
});

describe("checkSymbols", () => {
  it("marks symbols found or missing, with suggestions for the missing ones", async () => {
    const { fetcher } = fakeApi(["AAPL", "0700.HK"], { TENCENT: ["0700.HK", "TCEHY"] });
    const result = await checkSymbols(["AAPL", "TENCENT", "0700.HK"], (symbol) => [symbol], fetcher);
    expect(result.get("AAPL")).toMatchObject({ status: "found", info: { name: "AAPL Inc." } });
    expect(result.get("TENCENT")).toEqual({ status: "missing", suggestions: ["0700.HK", "TCEHY"] });
    expect(result.get("0700.HK")?.status).toBe("found");
  });

  it("marks every symbol failed when quotes cannot be loaded", async () => {
    const { fetcher } = fakeApi([], {}, { failQuotes: true });
    const result = await checkSymbols(["AAPL", "MSFT"], (symbol) => [symbol], fetcher);
    expect([...result.values()]).toEqual([{ status: "failed" }, { status: "failed" }]);
  });

  it("looks up suggestions for at most eight unknown symbols", async () => {
    const { fetcher, calls } = fakeApi([]);
    const unknown = Array.from({ length: 12 }, (_, i) => `ZZ${i}`);
    const result = await checkSymbols(unknown, (symbol) => [symbol], fetcher);
    expect(calls.filter((url) => url.startsWith("/api/search"))).toHaveLength(8);
    expect(result.size).toBe(12);
    expect(result.get("ZZ11")).toEqual({ status: "missing", suggestions: [] });
  });
});
