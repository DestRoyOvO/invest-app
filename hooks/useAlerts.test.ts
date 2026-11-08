import { describe, expect, it } from "vitest";

import type { Quote, QuotesResponse } from "@/types/api";

import { mergeQuoteResponses, quoteRequestUrls } from "./useAlerts";

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
