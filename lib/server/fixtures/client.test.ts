import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import YahooFinance from "yahoo-finance2";

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

describe("the not-found answers match what yahoo-finance2 makes of Yahoo's", () => {
  // The library itself, fed Yahoo's answers for an unknown symbol through a stub fetch (cookie, crumb, then the
  // module's request): the fixture must fail and resolve exactly as the library does, so the app's error handling
  // sees the same thing in both modes. The bodies are Yahoo's error envelope ({ <module>: { result, error } }).
  const NOT_FOUND = { code: "Not Found", description: "" };
  const answers: Array<[RegExp, number, unknown]> = [
    [/\/v8\/finance\/chart\//, 404, { chart: { result: null, error: { ...NOT_FOUND, description: "No data found, symbol may be delisted" } } }],
    [/\/v10\/finance\/quoteSummary\//, 404, { quoteSummary: { result: null, error: { ...NOT_FOUND, description: "Quote not found for symbol: ZZZZ" } } }],
    [/\/v7\/finance\/quote\b/, 200, { quoteResponse: { result: [], error: null } }],
    [/\/v7\/finance\/options\//, 200, { optionChain: { result: [], error: null } }],
  ];

  const requested: string[] = [];

  async function stubFetch(input: string | URL | Request): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (url.includes("/v1/test/getcrumb")) return new Response("fixture-crumb", { status: 200 });
    const answer = answers.find(([pattern]) => pattern.test(url));
    if (answer) return new Response(JSON.stringify(answer[2]), { status: answer[1], headers: { "content-type": "application/json" } });
    // The cookie handshake: any other page sets Yahoo's session cookie.
    return new Response("<html></html>", {
      status: 200,
      headers: { "set-cookie": "A3=d=fixture&S=fixture; Max-Age=31557600; Domain=.yahoo.com; Path=/; Secure; HttpOnly" },
    });
  }

  const library = () =>
    new YahooFinance({ fetch: stubFetch as typeof fetch, versionCheck: false, suppressNotices: ["yahooSurvey", "ripHistorical"], validation: { logErrors: false, logOptionsErrors: false } });

  it("for chart and quoteSummary", async () => {
    const yahoo = library();
    const options = { validateResult: false as const };
    const period1 = new Date(Date.now() - 30 * DAY);
    const fromLibrary = await rejection(yahoo.chart("ZZZZ", { period1 }, options));
    const fromFixture = await rejection(fixtureClient.chart("ZZZZ", { period1 }));
    expect([fromFixture.name, fromFixture.message]).toEqual([fromLibrary.name, fromLibrary.message]);
    const summaryFromLibrary = await rejection(yahoo.quoteSummary("ZZZZ", { modules: ["price"] }, options));
    const summaryFromFixture = await rejection(fixtureClient.quoteSummary("ZZZZ", { modules: ["price"] }));
    expect([summaryFromFixture.name, summaryFromFixture.message]).toEqual([summaryFromLibrary.name, summaryFromLibrary.message]);
    expect(requested.some((url) => url.includes("/v8/finance/chart/ZZZZ")) && requested.some((url) => url.includes("/v10/finance/quoteSummary/ZZZZ"))).toBe(true);
  });

  it("for quote and options", async () => {
    const yahoo = library();
    const options = { validateResult: false as const };
    expect(await fixtureClient.quote(["ZZZZ"], { return: "array" })).toEqual(await yahoo.quote(["ZZZZ"], { return: "array" }, options));
    expect(await fixtureClient.quote("ZZZZ")).toEqual(await yahoo.quote("ZZZZ", {}, options));
    expect(await fixtureClient.options("ZZZZ", {})).toEqual(await yahoo.options("ZZZZ", {}, options));
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
