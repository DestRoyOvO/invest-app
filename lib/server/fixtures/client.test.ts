import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isYahooAnswer } from "../yahoo";

import { DISPATCHED_METHODS, fixtureClient, withMarketDataSource } from "./client";
import { isNotFoundSymbol, RESERVED_SCENARIO_SYMBOLS, securityOf } from "./securities";

const DAY = 86_400_000;

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

describe("the not-found prefix behaves like a symbol Yahoo does not know", () => {
  it("is the only unknown: every other well-formed symbol is known", () => {
    expect(isNotFoundSymbol("ZZZZ")).toBe(true);
    expect(isNotFoundSymbol("zz1")).toBe(true);
    expect(securityOf("ZZZZ")).toBeNull();
    for (const symbol of ["AAPL", "QWERT", "^XYZ", "ABC=X", "XYZ=F", "FOO-USD", "1234.HK", "ABCDX", ...RESERVED_SCENARIO_SYMBOLS]) {
      expect(securityOf(symbol), symbol).not.toBeNull();
    }
  });

  it("quote leaves it out (and resolves to undefined for a single symbol)", async () => {
    expect(await fixtureClient.quote(["ZZZZ", "AAPL"], { return: "array" })).toMatchObject([{ symbol: "AAPL" }]);
    expect(await fixtureClient.quote(["ZZZZ"], { return: "array" })).toEqual([]);
    expect(await fixtureClient.quote("ZZZZ")).toBeUndefined();
  });

  it("chart fails with Yahoo's message, which the app treats as no bars", async () => {
    const error = await rejection(fixtureClient.chart("ZZZZ", { period1: new Date(Date.now() - 30 * DAY) }));
    expect(error.message).toBe("No data found, symbol may be delisted");
    expect(isYahooAnswer(error)).toBe(true);
  });

  it("quoteSummary fails with Yahoo's message", async () => {
    const error = await rejection(fixtureClient.quoteSummary("ZZZZ", { modules: ["price"] }));
    expect(error.message).toBe("Quote not found for symbol: ZZZZ");
    expect(error.name).toBe("Error");
    expect(isYahooAnswer(error)).toBe(true);
  });

  it("search finds nothing, options resolve to undefined and fundamentals to an empty list", async () => {
    expect(await fixtureClient.search("ZZZZ", { quotesCount: 5, newsCount: 5 })).toMatchObject({ quotes: [], news: [] });
    expect(await fixtureClient.options("ZZZZ", {})).toBeUndefined();
    expect(await fixtureClient.fundamentalsTimeSeries("ZZZZ", { period1: new Date(Date.now() - 800 * DAY), type: "annual", module: "financials" })).toEqual([]);
  });
});

describe("quoteSummary modules follow the quote type", () => {
  it("answers a fund's request for earnings modules like Yahoo does", async () => {
    const error = await rejection(fixtureClient.quoteSummary("SPY", { modules: ["earnings", "earningsHistory", "earningsTrend", "calendarEvents", "financialData"] }));
    expect(error.message).toBe("No fundamentals data found for symbol: SPY");
    expect(isYahooAnswer(error)).toBe(true);
  });

  it("returns only the modules a symbol has", async () => {
    const modules = ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "calendarEvents", "assetProfile"];
    expect(Object.keys((await fixtureClient.quoteSummary("^GSPC", { modules })) as object).sort()).toEqual(["defaultKeyStatistics", "price", "summaryDetail"]);
    expect(Object.keys((await fixtureClient.quoteSummary("SPY", { modules })) as object).sort()).toEqual(["assetProfile", "defaultKeyStatistics", "price", "summaryDetail"]);
    expect(Object.keys((await fixtureClient.quoteSummary("AAPL", { modules })) as object).sort()).toEqual([...modules].sort());
    expect(Object.keys((await fixtureClient.quoteSummary("AAPL")) as object).sort()).toEqual(["price", "summaryDetail"]);
  });
});

describe("withMarketDataSource", () => {
  afterEach(() => vi.unstubAllEnvs());

  function fakeClient() {
    const calls: string[] = [];
    const real = Object.fromEntries(DISPATCHED_METHODS.map((name) => [name, async () => calls.push(name) && `real ${name}`]));
    return { calls, real: { ...real, version: "real" } };
  }

  it("decides at call time, from MARKET_DATA_SOURCE, which client answers", async () => {
    const { calls, real } = fakeClient();
    const client = withMarketDataSource(real as never) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    vi.stubEnv("MARKET_DATA_SOURCE", "yahoo");
    expect(await client.quote(["AAPL"])).toBe("real quote");
    expect(calls).toEqual(["quote"]);

    vi.stubEnv("MARKET_DATA_SOURCE", "fixtures");
    expect(await client.quote(["AAPL"], { return: "array" })).toMatchObject([{ symbol: "AAPL", quoteType: "EQUITY" }]);
    expect(calls).toEqual(["quote"]);

    vi.stubEnv("MARKET_DATA_SOURCE", "");
    expect(await client.search("apple")).toBe("real search");
    expect(calls).toEqual(["quote", "search"]);
  });

  it("keeps the real client's other properties and lets tests spy on the methods", async () => {
    const { real } = fakeClient();
    const client = withMarketDataSource(real as never) as unknown as Record<string, unknown>;
    expect(client.version).toBe("real");
    const spy = vi.spyOn(client as { quote: () => Promise<unknown> }, "quote").mockResolvedValueOnce("mocked");
    expect(await (client.quote as () => Promise<unknown>)()).toBe("mocked");
    spy.mockRestore();
  });
});
