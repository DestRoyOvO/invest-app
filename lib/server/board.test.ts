import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiErrorBody, Quote } from "@/types/api";
import type { BoardResponse } from "@/types/shell";
import { MARKET_BOARD } from "@/lib/universe";

vi.mock("server-only", () => ({}));

// Counting fakes for the Yahoo getters the board uses, and probes that read the same fake cache, so the tests can compare
// what uncachedBoardCalls predicts with the calls the loader makes.
const fake = vi.hoisted(() => ({
  calls: [] as string[],
  fresh: new Set<string>(),
  quotes: new Map<string, unknown>(),
  failQuotes: false,
  failSparks: new Set<string>(),
}));

vi.mock("./yahoo", async (importOriginal) => {
  const original = await importOriginal<typeof import("./yahoo")>();
  return {
    ...original,
    getQuotes: async (symbols: string[]) => {
      fake.calls.push(`quotes:${symbols.length}`);
      if (fake.failQuotes) throw new Error("Yahoo is down");
      for (const symbol of symbols) fake.fresh.add(`quote:${symbol}`);
      return new Map(symbols.flatMap((symbol) => (fake.quotes.has(symbol) ? [[symbol, fake.quotes.get(symbol)]] : [])));
    },
    getSparkline: async (symbol: string) => {
      fake.calls.push(`spark:${symbol}`);
      if (fake.failSparks.has(symbol)) throw new Error("no bars");
      fake.fresh.add(`spark:${symbol}`);
      return [1, 2, 3];
    },
    hasFreshQuote: (symbol: string) => fake.fresh.has(`quote:${symbol}`),
    hasCachedSparkline: (symbol: string) => fake.fresh.has(`spark:${symbol}`),
  };
});

import { GET as boardRoute } from "@/app/api/market/board/route";

import { BOARD_SYMBOLS, boardItems, getBoard, staleSince, uncachedBoardCalls } from "./board";
import { clearCache } from "./cache";
import { clientIp } from "./http";
import { clientKey, consumeRateLimit, RATE_LIMITS, resetRateLimits } from "./rate-limit";

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: symbol,
    marketState: "REGULAR",
    price: 100,
    changePercent: 0.5,
    stale: false,
    fetchedAt: "2026-11-09T18:00:00.000Z",
    ...overrides,
  } as Quote;
}

function serveAll(overrides: Record<string, Partial<Quote>> = {}) {
  for (const symbol of BOARD_SYMBOLS) fake.quotes.set(symbol, quote(symbol, overrides[symbol]));
}

beforeEach(() => {
  clearCache();
  resetRateLimits();
  fake.calls = [];
  fake.fresh.clear();
  fake.quotes.clear();
  fake.failQuotes = false;
  fake.failSparks.clear();
});

describe("boardItems and staleSince", () => {
  it("keeps the board order, skips missing quotes and finds the oldest stale fetch", () => {
    const quotes = new Map([
      ["BTC-USD", quote("BTC-USD", { stale: true, fetchedAt: "2026-11-09T17:00:00.000Z" })],
      ["^GSPC", quote("^GSPC", { stale: true, fetchedAt: "2026-11-09T18:05:00.000Z" })],
      ["^VIX", quote("^VIX")],
    ]);
    const items = boardItems(quotes, new Map([["^GSPC", [1, 2]]]));
    expect(items.map((item) => item.quote.symbol)).toEqual(["^GSPC", "^VIX", "BTC-USD"]);
    expect(items[0].spark).toEqual([1, 2]);
    expect(items[1].spark).toEqual([]);
    expect(staleSince(items)).toEqual({ stale: true, since: "2026-11-09T17:00:00.000Z" });
    expect(staleSince(boardItems(new Map([["^VIX", quote("^VIX")]]), new Map()))).toEqual({ stale: false, since: null });
  });
});

describe("getBoard", () => {
  it("returns the ten board instruments in order with the S&P 500 market state", async () => {
    serveAll({ "^GSPC": { marketState: "POST" } });
    const board = await getBoard();
    expect(board.board.map((item) => item.quote.symbol)).toEqual(MARKET_BOARD.map((b) => b.symbol));
    expect(board.marketState).toBe("POST");
    expect(board.warnings).toEqual([]);
    expect(board.quotesAsOf).toBeNull();
    expect(board.board[0].spark).toEqual([1, 2, 3]);
    expect(fake.calls.filter((call) => call.startsWith("quotes:"))).toEqual([`quotes:${BOARD_SYMBOLS.length}`]);
  });

  it("flags stale quotes with the oldest fetch time, missing instruments and missing sparklines", async () => {
    serveAll({ "^TNX": { stale: true, fetchedAt: "2026-11-09T18:05:00.000Z" }, "GC=F": { stale: true, fetchedAt: "2026-11-09T18:01:00.000Z" } });
    fake.quotes.delete("CL=F");
    fake.failSparks.add("^VIX");
    const board = await getBoard();
    expect(board.warnings.sort()).toEqual(["board", "quotes_stale", "sparklines"]);
    expect(board.quotesAsOf).toBe("2026-11-09T18:01:00.000Z");
    expect(board.board).toHaveLength(BOARD_SYMBOLS.length - 1);
    expect(board.board.find((item) => item.quote.symbol === "^VIX")?.spark).toEqual([]);
  });

  it("serves every visitor from one load for 10 seconds", async () => {
    serveAll();
    await getBoard();
    const calls = fake.calls.length;
    await getBoard();
    expect(fake.calls).toHaveLength(calls);
  });

  it("fails when no quote can be loaded", async () => {
    fake.failQuotes = true;
    await expect(getBoard()).rejects.toThrow("Yahoo is down");
    fake.failQuotes = false;
    await expect(getBoard()).rejects.toThrow(/no quotes/);
  });
});

describe("uncachedBoardCalls", () => {
  it("predicts the Yahoo calls the loader makes", async () => {
    serveAll();
    const predicted = uncachedBoardCalls();
    expect(predicted).toBe(1 + BOARD_SYMBOLS.length);
    await getBoard();
    expect(fake.calls).toHaveLength(predicted);
    expect(uncachedBoardCalls()).toBe(0);
  });

  it("counts only what is missing once the board itself has expired", () => {
    for (const symbol of BOARD_SYMBOLS) fake.fresh.add(`quote:${symbol}`);
    fake.fresh.add("spark:^GSPC");
    expect(uncachedBoardCalls()).toBe(BOARD_SYMBOLS.length - 1);
    for (const symbol of BOARD_SYMBOLS) fake.fresh.add(`spark:${symbol}`);
    expect(uncachedBoardCalls()).toBe(0);
  });
});

describe("GET /api/market/board", () => {
  const request = () => new Request("http://localhost/api/market/board");
  const remaining = () => {
    const result = consumeRateLimit(RATE_LIMITS.market, clientKey(clientIp(request())));
    return result.ok ? result.remaining : 0;
  };

  it("answers with the board and a short shared cache while trading", async () => {
    serveAll();
    const response = await boardRoute(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as BoardResponse;
    expect(body.board).toHaveLength(BOARD_SYMBOLS.length);
    expect(response.headers.get("cache-control")).toContain("10");
  });

  it("charges one unit per uncached Yahoo call and nothing extra while the board is cached", async () => {
    serveAll();
    await boardRoute(request());
    const afterCold = remaining();
    expect(afterCold).toBe(RATE_LIMITS.market.limit - 1 - BOARD_SYMBOLS.length - 1);
    await boardRoute(request());
    expect(remaining()).toBe(afterCold - 2);
  });

  it("reports an upstream error when Yahoo fails", async () => {
    fake.failQuotes = true;
    const response = await boardRoute(request());
    expect(response.status).toBe(502);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe("upstream_error");
  });
});
