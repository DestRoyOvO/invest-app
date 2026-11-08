import { describe, expect, it } from "vitest";

import type { Quote, QuotesResponse } from "@/types/api";

import { mergeQuoteResponses, quoteFreshness, quoteRequestUrls } from "./useAlerts";

describe("quoteRequestUrls", () => {
  it("dedupes, sorts and splits symbols into requests of 50", () => {
    expect(quoteRequestUrls(["MSFT", "AAPL", "MSFT"])).toEqual(["/api/quotes?symbols=AAPL,MSFT"]);
    expect(quoteRequestUrls(["^GSPC", "BRK-B"])).toEqual(["/api/quotes?symbols=BRK-B,%5EGSPC"]);
    const many = Array.from({ length: 120 }, (_, i) => `S${String(i).padStart(3, "0")}`);
    const urls = quoteRequestUrls(many);
    expect(urls).toHaveLength(3);
    expect(urls[0].split("=")[1].split(",")).toHaveLength(50);
    expect(urls[2].split("=")[1].split(",")).toHaveLength(20);
    expect(quoteRequestUrls(Array.from({ length: 450 }, (_, i) => `X${i}`))).toHaveLength(4);
    expect(quoteRequestUrls([])).toEqual([]);
  });
});

describe("mergeQuoteResponses", () => {
  it("joins quotes and missing symbols and keeps the oldest time", () => {
    const quote = (symbol: string) => ({ symbol }) as Quote;
    const a: QuotesResponse = { asOf: "2026-11-06T20:00:10Z", quotes: [quote("AAPL")], missing: ["NOPE"] };
    const b: QuotesResponse = { asOf: "2026-11-06T20:00:05Z", quotes: [quote("MSFT")], missing: [] };
    expect(mergeQuoteResponses([a, b])).toEqual({ asOf: "2026-11-06T20:00:05Z", quotes: [quote("AAPL"), quote("MSFT")], missing: ["NOPE"] });
  });
});

describe("quoteFreshness", () => {
  const quote = (symbol: string, stale: boolean, fetchedAt: string | null) => ({ symbol, stale, fetchedAt }) as Quote;
  const response = (quotes: Quote[]): QuotesResponse => ({ asOf: "2026-11-06T20:00:10Z", quotes, missing: [] });

  it("is fresh while every quote is fresh and the last refresh worked", () => {
    expect(quoteFreshness(response([quote("AAPL", false, "2026-11-06T20:00:09Z")]), false)).toEqual({ stale: false, since: null });
    expect(quoteFreshness(undefined, true)).toEqual({ stale: false, since: null });
  });

  it("flags quotes the server served stale, as old as the oldest of them", () => {
    const data = response([quote("AAPL", true, "2026-11-06T19:40:00Z"), quote("MSFT", true, "2026-11-06T19:20:00Z"), quote("NVDA", false, "2026-11-06T20:00:09Z")]);
    expect(quoteFreshness(data, false)).toEqual({ stale: true, since: "2026-11-06T19:20:00Z" });
    // Without a fetch time the age is unknown.
    expect(quoteFreshness(response([quote("AAPL", true, null)]), false)).toEqual({ stale: true, since: null });
  });

  it("flags the previous response after a failed refresh", () => {
    expect(quoteFreshness(response([quote("AAPL", false, "2026-11-06T20:00:09Z")]), true)).toEqual({ stale: true, since: "2026-11-06T20:00:10Z" });
    expect(quoteFreshness(response([quote("AAPL", true, "2026-11-06T19:20:00Z")]), true)).toEqual({ stale: true, since: "2026-11-06T19:20:00Z" });
  });
});
