import { describe, expect, it } from "vitest";

import type { Quote, QuotesResponse } from "@/types/api";

import { mergeQuoteResponses, quoteRequestUrls, staleQuoteSince } from "./usePortfolio";

function quote(symbol: string, patch: Partial<Quote> = {}): Quote {
  return { symbol, stale: false, fetchedAt: null, ...patch } as Quote;
}

describe("quoteRequestUrls", () => {
  it("requests each symbol once, in a stable order", () => {
    expect(quoteRequestUrls(["NVDA", "AAPL", "NVDA", "MSFT"])).toEqual(["/api/quotes?symbols=AAPL,MSFT,NVDA"]);
    // Reordering the watchlist keeps the same request, so SWR does not refetch.
    expect(quoteRequestUrls(["MSFT", "NVDA", "AAPL"])).toEqual(quoteRequestUrls(["AAPL", "MSFT", "NVDA"]));
  });

  it("chunks long lists by the route limit and encodes symbols", () => {
    const symbols = Array.from({ length: 120 }, (_, i) => "S" + String(i).padStart(3, "0"));
    const urls = quoteRequestUrls(symbols);
    expect(urls).toHaveLength(3);
    expect(urls[0].split("=")[1].split(",")).toHaveLength(50);
    expect(urls[2].split("=")[1].split(",")).toHaveLength(20);
    expect(quoteRequestUrls(["^GSPC", "BRK-B"])).toEqual(["/api/quotes?symbols=BRK-B,%5EGSPC"]);
    expect(quoteRequestUrls([])).toEqual([]);
    expect(quoteRequestUrls(["A", "B", "C"], 2)).toEqual(["/api/quotes?symbols=A,B", "/api/quotes?symbols=C"]);
  });
});

describe("mergeQuoteResponses", () => {
  it("joins chunks and keeps the oldest time", () => {
    const a: QuotesResponse = { asOf: "2026-11-07T15:00:05.000Z", quotes: [quote("AAPL")], missing: ["ZZZZ"] };
    const b: QuotesResponse = { asOf: "2026-11-07T15:00:01.000Z", quotes: [quote("MSFT")], missing: [] };
    expect(mergeQuoteResponses([a, b])).toEqual({ asOf: b.asOf, quotes: [a.quotes[0], b.quotes[0]], missing: ["ZZZZ"] });
    expect(mergeQuoteResponses([a])).toBe(a);
  });
});

describe("staleQuoteSince", () => {
  it("returns the oldest fetch time among stale quotes", () => {
    expect(staleQuoteSince([quote("A"), quote("B")])).toBeNull();
    expect(
      staleQuoteSince([
        quote("A", { stale: true, fetchedAt: "2026-11-07T14:00:00.000Z" }),
        quote("B", { stale: true, fetchedAt: "2026-11-07T13:05:00.000Z" }),
        quote("C", { fetchedAt: "2026-11-07T12:00:00.000Z" }),
      ]),
    ).toBe("2026-11-07T13:05:00.000Z");
  });

  it("still reports staleness when the time is unknown", () => {
    expect(staleQuoteSince([quote("A", { stale: true })])).toBe("");
    expect(staleQuoteSince([quote("A", { stale: true }), quote("B", { stale: true, fetchedAt: "2026-11-07T13:05:00.000Z" })])).toBe("2026-11-07T13:05:00.000Z");
  });
});
