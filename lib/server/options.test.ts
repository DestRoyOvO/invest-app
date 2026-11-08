import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiErrorBody } from "@/types/api";
import type { ImpliedMove, ImpliedMoveResponse } from "@/types/earnings";

vi.mock("server-only", () => ({}));

// getQuote tells an unknown symbol from a known one without options; it is mocked too, so no test reaches Yahoo.
const mocks = vi.hoisted(() => ({ options: vi.fn(), getQuote: vi.fn(), hasFreshQuote: vi.fn() }));
vi.mock("./yahoo", async (importOriginal) => {
  const original = await importOriginal<typeof import("./yahoo")>();
  return { ...original, yf: { options: mocks.options }, getQuote: mocks.getQuote, hasFreshQuote: mocks.hasFreshQuote };
});

import { GET as impliedMoveRoute } from "@/app/api/stock/[symbol]/implied-move/route";

import { clearCache } from "./cache";
import {
  atmStraddle,
  getImpliedMove,
  getImpliedMoveResponse,
  legPrice,
  mapOptionsPayload,
  optionsTtlMs,
  pickExpiry,
  uncachedImpliedMoveCalls,
  type OptionChain,
} from "./options";
import { resetRateLimits } from "./rate-limit";

// Fixture: NVDA's options() answer recorded on Saturday 2026-11-07 (the nearest chain is the Nov 9 expiry; quotes are
// from the Friday close, two of them crossed), trimmed to the strikes around the 186.64 close. The Nov 20 chain is
// shaped like Yahoo's answer with prices in line with the ±11% the audit measured through that expiry.

const NOW = Date.parse("2026-11-07T15:00:00Z");
const MIN = 60_000;

const EXPIRIES = ["2026-11-09", "2026-11-11", "2026-11-13", "2026-11-20", "2026-11-27", "2026-12-04"].map((d) => new Date(`${d}T00:00:00.000Z`));

const contract = (kind: "C" | "P", expiry: string, strike: number, lastPrice: number, bid: number, ask: number) => ({
  contractSymbol: `NVDA${expiry.slice(2).replaceAll("-", "")}${kind}${String(strike * 1000).padStart(8, "0")}`,
  strike,
  currency: "USD",
  lastPrice,
  bid,
  ask,
  contractSize: "REGULAR",
  expiration: new Date(`${expiry}T00:00:00.000Z`),
  impliedVolatility: 0.5,
});

function quote(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "NVDA",
    shortName: "NVIDIA Corporation",
    quoteType: "EQUITY",
    currency: "USD",
    marketState: "CLOSED",
    regularMarketPrice: 186.64,
    earningsTimestamp: new Date("2026-11-17T21:00:00.000Z"),
    earningsTimestampStart: new Date("2026-11-17T21:00:00.000Z"),
    earningsTimestampEnd: new Date("2026-11-17T21:00:00.000Z"),
    isEarningsDateEstimate: false,
    ...overrides,
  };
}

function payload(expiry: string, calls: unknown[], puts: unknown[], quoteOverrides: Record<string, unknown> = {}) {
  return {
    underlyingSymbol: "NVDA",
    expirationDates: EXPIRIES,
    strikes: [185, 187.5, 190, 192.5],
    hasMiniOptions: false,
    quote: quote(quoteOverrides),
    options: [{ expirationDate: new Date(`${expiry}T00:00:00.000Z`), hasMiniOptions: false, calls, puts }],
  };
}

const NEAREST = payload(
  "2026-11-09",
  [
    contract("C", "2026-11-09", 185, 4.3, 4.35, 4.45),
    contract("C", "2026-11-09", 187.5, 3.05, 2.99, 3.05),
    contract("C", "2026-11-09", 190, 1.92, 1.91, 1.93),
    contract("C", "2026-11-09", 192.5, 1.15, 1.19, 1.15),
  ],
  [
    contract("P", "2026-11-09", 185, 2.69, 2.68, 2.64),
    contract("P", "2026-11-09", 187.5, 3.81, 3.75, 3.75),
    contract("P", "2026-11-09", 190, 5.25, 5.2, 5.25),
    contract("P", "2026-11-09", 192.5, 6.9, 6.9, 6.95),
  ],
);

const NOV20 = payload(
  "2026-11-20",
  [contract("C", "2026-11-20", 185, 11.6, 11.5, 11.7), contract("C", "2026-11-20", 187.5, 10.2, 10.1, 10.3), contract("C", "2026-11-20", 190, 9.0, 8.9, 9.1)],
  [contract("P", "2026-11-20", 185, 9.6, 9.5, 9.7), contract("P", "2026-11-20", 187.5, 10.8, 10.7, 10.9), contract("P", "2026-11-20", 190, 12.1, 12.0, 12.2)],
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearCache();
  resetRateLimits();
  mocks.options.mockReset();
  mocks.getQuote.mockReset();
  mocks.getQuote.mockResolvedValue(null);
  mocks.hasFreshQuote.mockReset();
  mocks.hasFreshQuote.mockReturnValue(false);
});

/** The move of an answer that has one (fails the test otherwise). */
function moveOf(answer: ImpliedMoveResponse | null): ImpliedMove {
  if (!answer?.available) throw new Error(`expected an implied move, got ${JSON.stringify(answer)}`);
  return answer;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("optionsTtlMs", () => {
  it("caches 15 minutes during the options session and until the next open (at most 2 hours) otherwise", () => {
    expect(optionsTtlMs(Date.parse("2026-11-09T15:00:00Z"))).toBe(15 * MIN); // Mon 10:00 ET
    expect(optionsTtlMs(Date.parse("2026-11-09T14:00:00Z"))).toBe(30 * MIN); // Mon 09:00 ET
    expect(optionsTtlMs(Date.parse("2026-11-09T21:10:00Z"))).toBe(15 * MIN); // Mon 16:10 ET, quotes still settling
    expect(optionsTtlMs(Date.parse("2026-11-09T22:00:00Z"))).toBe(120 * MIN); // Mon 17:00 ET
    expect(optionsTtlMs(NOW)).toBe(120 * MIN); // Saturday
    expect(optionsTtlMs(Date.parse("2026-11-09T14:29:30Z"))).toBe(MIN); // a minute floor right before the open
  });
});

describe("pickExpiry", () => {
  const expiries = EXPIRIES.map((d) => d.toISOString());

  it("needs an expiry after the report day for reports after the close or at an unknown time", () => {
    expect(pickExpiry(expiries, "2026-11-17T21:00:00.000Z", "post")).toBe("2026-11-20T00:00:00.000Z");
    expect(pickExpiry(expiries, "2026-11-13T21:00:00.000Z", "post")).toBe("2026-11-20T00:00:00.000Z");
    expect(pickExpiry(expiries, "2026-11-13T21:00:00.000Z", null)).toBe("2026-11-20T00:00:00.000Z");
  });

  it("accepts the report day's own expiry for reports before the open or during the session", () => {
    expect(pickExpiry(expiries, "2026-11-13T12:00:00.000Z", "pre")).toBe("2026-11-13T00:00:00.000Z");
    expect(pickExpiry(expiries, "2026-11-13T17:00:00.000Z", "intraday")).toBe("2026-11-13T00:00:00.000Z");
  });

  it("returns null when no listed expiry comes after the report", () => {
    expect(pickExpiry(expiries, "2026-12-10T21:00:00.000Z", "post")).toBeNull();
    expect(pickExpiry([], "2026-11-17T21:00:00.000Z", "post")).toBeNull();
  });
});

describe("legPrice and atmStraddle", () => {
  it("uses the mid of a sane quote and the last trade when the quote is crossed or empty", () => {
    expect(legPrice({ strike: 1, bid: 2.99, ask: 3.05, last: 3.0 })).toEqual({ price: 3.02, basis: "mid" });
    expect(legPrice({ strike: 1, bid: 1.19, ask: 1.15, last: 1.15 })).toEqual({ price: 1.15, basis: "last" });
    expect(legPrice({ strike: 1, bid: 0, ask: 0, last: 0.4 })).toEqual({ price: 0.4, basis: "last" });
    expect(legPrice({ strike: 1, bid: null, ask: null, last: 0 })).toBeNull();
  });

  it("prices the strike nearest the underlying and skips strikes without usable legs", () => {
    const chain = mapOptionsPayload(NEAREST)!.chain!;
    expect(atmStraddle(chain, 186.64)).toEqual({ strike: 187.5, callPrice: 3.02, putPrice: 3.75, basis: "mid" });
    const holes: OptionChain = { ...chain, calls: chain.calls.map((c) => (c.strike === 187.5 ? { ...c, bid: 0, ask: 0, last: 0 } : c)) };
    // 185 is next nearest; its put quote is crossed, so it uses the last trade.
    expect(atmStraddle(holes, 186.64)).toMatchObject({ strike: 185, callPrice: 4.4, putPrice: 2.69, basis: "mixed" });
    expect(atmStraddle({ ...chain, puts: [] }, 186.64)).toBeNull();
  });
});

describe("mapOptionsPayload", () => {
  it("reads expiries, the embedded quote's report and the nearest chain", () => {
    const parsed = mapOptionsPayload(NEAREST)!;
    expect(parsed.head).toEqual({
      quoted: true,
      expiries: EXPIRIES.map((d) => d.toISOString()),
      report: { at: "2026-11-17T21:00:00.000Z", estimated: false },
      price: 186.64,
      currency: "USD",
    });
    expect(parsed.chain).toMatchObject({ expiry: "2026-11-09T00:00:00.000Z", price: 186.64 });
    expect(parsed.chain!.calls).toHaveLength(4);
  });

  it("handles symbols without options and empty answers", () => {
    const hk = mapOptionsPayload({ underlyingSymbol: "0700.HK", expirationDates: [], strikes: [], quote: { symbol: "0700.HK", regularMarketPrice: 419.8, currency: "HKD" }, options: [] });
    expect(hk?.head).toMatchObject({ quoted: true, expiries: [] });
    expect(hk?.chain).toBeNull();
    expect(mapOptionsPayload({ expirationDates: [], options: [] })?.head.quoted).toBe(false);
    expect(mapOptionsPayload(undefined)).toBeNull();
  });
});

describe("getImpliedMoveResponse", () => {
  it("fetches the expiries, then the first expiry after the report, and caches both", async () => {
    mocks.options.mockImplementation(async (_symbol: string, query: { date?: Date }) => (query.date ? NOV20 : NEAREST));
    expect(uncachedImpliedMoveCalls("NVDA")).toBe(2);
    const answer = await getImpliedMoveResponse("NVDA");
    expect(answer).toMatchObject({ available: true });
    const move = moveOf(answer);
    expect(mocks.options).toHaveBeenCalledTimes(2);
    expect(mocks.options.mock.calls[1][1]).toEqual({ date: new Date("2026-11-20T00:00:00.000Z") });
    expect(mocks.options.mock.calls[1][2]).toMatchObject({ validateResult: false });
    expect(move).toMatchObject({
      symbol: "NVDA",
      report: { at: "2026-11-17T21:00:00.000Z", estimated: false, timing: "post" },
      expiry: "2026-11-20T00:00:00.000Z",
      daysToExpiry: 13,
      strike: 187.5,
      price: 186.64,
      callPrice: 10.2,
      putPrice: 10.8,
      basis: "mid",
      currency: "USD",
    });
    expect(move.straddle).toBeCloseTo(21, 10);
    expect(move.move).toBeCloseTo(21 / 186.64, 10);

    expect(uncachedImpliedMoveCalls("NVDA")).toBe(0);
    await getImpliedMoveResponse("NVDA");
    expect(mocks.options).toHaveBeenCalledTimes(2);
    expect(mocks.getQuote).not.toHaveBeenCalled();
  });

  it("needs one call when the nearest expiry already settles after the report", async () => {
    // Reported before Monday's open: Monday's own expiry prices it.
    const early = { ...NEAREST, quote: quote({ earningsTimestamp: new Date("2026-11-09T12:00:00.000Z"), earningsTimestampStart: undefined, earningsTimestampEnd: undefined }) };
    mocks.options.mockResolvedValue(early);
    const move = moveOf(await getImpliedMoveResponse("NVDA"));
    expect(mocks.options).toHaveBeenCalledTimes(1);
    expect(move).toMatchObject({ expiry: "2026-11-09T00:00:00.000Z", report: { timing: "pre" }, daysToExpiry: 2 });
    expect(move.move).toBeCloseTo((3.02 + 3.75) / 186.64, 10);
  });

  it("says why a known symbol has no implied move: no options, no report on file, or a report over 30 days out", async () => {
    const asOf = new Date(NOW).toISOString();
    mocks.options.mockResolvedValueOnce({ underlyingSymbol: "0700.HK", expirationDates: [], strikes: [], quote: { symbol: "0700.HK", regularMarketPrice: 419.8 }, options: [] });
    expect(await getImpliedMoveResponse("0700.HK")).toEqual({ symbol: "0700.HK", asOf, available: false, reason: "no_options" });
    expect(uncachedImpliedMoveCalls("0700.HK")).toBe(0);

    // A fund, or Berkshire the day after its Saturday report: options, but no upcoming report in the quote.
    const noReport = { ...NEAREST, quote: quote({ symbol: "SPY", earningsTimestamp: undefined, earningsTimestampStart: undefined, earningsTimestampEnd: undefined }) };
    mocks.options.mockResolvedValueOnce(noReport);
    expect(await getImpliedMoveResponse("SPY")).toMatchObject({ available: false, reason: "no_report" });

    const far = { ...NEAREST, quote: quote({ earningsTimestamp: new Date("2027-01-28T21:00:00.000Z"), earningsTimestampStart: undefined, earningsTimestampEnd: undefined }) };
    mocks.options.mockResolvedValueOnce(far);
    expect(await getImpliedMoveResponse("AAPL")).toMatchObject({ available: false, reason: "report_far" });
    expect(mocks.options).toHaveBeenCalledTimes(3);
    expect(uncachedImpliedMoveCalls("AAPL")).toBe(0);
    expect(mocks.getQuote).not.toHaveBeenCalled();
  });

  it("says so when no listed expiry settles after the report", async () => {
    const short = { ...NEAREST, expirationDates: EXPIRIES.slice(0, 3), quote: quote() };
    mocks.options.mockResolvedValueOnce(short);
    expect(await getImpliedMoveResponse("NVDA")).toMatchObject({ available: false, reason: "no_expiry" });
  });

  it("tells an unknown symbol (null) from a known one without options by its quote", async () => {
    mocks.options.mockResolvedValue(undefined);
    expect(await getImpliedMoveResponse("ZZZZQX")).toBeNull();
    expect(mocks.getQuote).toHaveBeenCalledWith("ZZZZQX");

    mocks.getQuote.mockResolvedValueOnce({ symbol: "BRK-A" });
    expect(await getImpliedMoveResponse("BRK-A")).toMatchObject({ available: false, reason: "no_options" });

    // With the answer cached, only the quote can cost a call.
    expect(uncachedImpliedMoveCalls("ZZZZQX")).toBe(1);
    mocks.hasFreshQuote.mockReturnValue(true);
    expect(uncachedImpliedMoveCalls("ZZZZQX")).toBe(0);
  });

  it("reports unusable quotes instead of an implausible straddle built from placeholders", async () => {
    const junk = payload("2026-11-20", [contract("C", "2026-11-20", 187.5, 150, 0, 0)], [contract("P", "2026-11-20", 187.5, 140, 0, 0)]);
    mocks.options.mockImplementation(async (_symbol: string, query: { date?: Date }) => (query.date ? junk : NEAREST));
    expect(await getImpliedMoveResponse("NVDA")).toMatchObject({ symbol: "NVDA", available: false, reason: "no_quotes" });
  });
});

describe("getImpliedMove", () => {
  it("gives the move alone, and null when there is none or the symbol is unknown", async () => {
    const noReport = { ...NEAREST, quote: quote({ symbol: "SPY", earningsTimestamp: undefined, earningsTimestampStart: undefined, earningsTimestampEnd: undefined }) };
    mocks.options.mockImplementation(async (symbol: string, query: { date?: Date }) => {
      if (symbol === "ZZZZQX") return undefined;
      if (symbol === "SPY") return noReport;
      return query.date ? NOV20 : NEAREST;
    });
    const move = await getImpliedMove("NVDA");
    expect(move).toMatchObject({ symbol: "NVDA", expiry: "2026-11-20T00:00:00.000Z", strike: 187.5, price: 186.64 });
    expect(move?.move).toBeCloseTo(21 / 186.64, 10);
    // The same cached answer as the route's.
    expect(await getImpliedMoveResponse("NVDA")).toMatchObject({ available: true, strike: 187.5 });
    expect(mocks.options).toHaveBeenCalledTimes(2);

    expect(await getImpliedMove("SPY")).toBeNull();
    expect(await getImpliedMove("ZZZZQX")).toBeNull();
  });
});

describe("GET /api/stock/[symbol]/implied-move", () => {
  const params = (symbol: string) => ({ params: Promise.resolve({ symbol }) });

  it("serves the move, 200 with the reason when there is none, 404 for unknown symbols and 400 for invalid ones", async () => {
    mocks.options.mockImplementation(async (symbol: string, query: { date?: Date }) => {
      if (symbol === "0700.HK") return { underlyingSymbol: symbol, expirationDates: [], strikes: [], quote: { symbol }, options: [] };
      if (symbol === "ZZZZQX") return undefined;
      return query.date ? NOV20 : NEAREST;
    });
    const ok = await impliedMoveRoute(new Request("http://localhost/api/stock/NVDA/implied-move"), params("NVDA"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ available: true, expiry: "2026-11-20T00:00:00.000Z" });
    const none = await impliedMoveRoute(new Request("http://localhost/api/stock/0700.HK/implied-move"), params("0700.HK"));
    expect(none.status).toBe(200);
    expect(await none.json()).toMatchObject({ symbol: "0700.HK", available: false, reason: "no_options" });
    const unknown = await impliedMoveRoute(new Request("http://localhost/api/stock/ZZZZQX/implied-move"), params("ZZZZQX"));
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as ApiErrorBody).error.code).toBe("not_found");
    expect((await impliedMoveRoute(new Request("http://localhost/api/stock/%3C/implied-move"), params("%3C"))).status).toBe(400);
  });

  it("answers 502 when Yahoo fails", async () => {
    mocks.options.mockRejectedValue(new Error("socket hang up"));
    expect((await impliedMoveRoute(new Request("http://localhost/api/stock/TSLA/implied-move"), params("TSLA"))).status).toBe(502);
  });
});
