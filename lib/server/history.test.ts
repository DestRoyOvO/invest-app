import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyBar } from "@/lib/bars";
import type { ApiErrorBody, HistoryResponse } from "@/types/api";

vi.mock("server-only", () => ({}));

const yahoo = vi.hoisted(() => ({
  getDailyBars: vi.fn<(symbol: string, days: number) => Promise<DailyBar[]>>(),
  hasCachedDailyBars: vi.fn<(symbol: string, days: number) => boolean>(() => false),
}));
vi.mock("./yahoo", () => yahoo);

import { GET as historyRoute } from "@/app/api/history/route";

import { alignCloses, getHistory } from "./history";
import { resetRateLimits } from "./rate-limit";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 6, 21);
const D = (offset: number) => Date.UTC(2026, 10, 6) - offset * DAY;

function bar(t: number, close: number): DailyBar {
  return { t, o: close, h: close, l: close, c: close, adjClose: close / 2, v: 1000 };
}

describe("alignCloses", () => {
  it("aligns adjusted closes on the union of session dates and keeps input order", () => {
    const bars = new Map([
      ["AAA", [bar(D(3), 10), bar(D(2), 11), bar(D(0), 12)]],
      ["BBB", [bar(D(2), 20), bar(D(1), 21), bar(D(0), 22)]],
    ]);
    const aligned = alignCloses(["BBB", "AAA", "ZZZ"], bars, D(10));
    expect(aligned.dates).toEqual([D(3), D(2), D(1), D(0)]);
    expect(Object.keys(aligned.closes)).toEqual(["BBB", "AAA"]);
    expect(aligned.closes.AAA).toEqual([5, 5.5, null, 6]);
    expect(aligned.closes.BBB).toEqual([null, 10, 10.5, 11]);
    expect(aligned.missing).toEqual(["ZZZ"]);
  });

  it("drops sessions before the start and reports symbols left without bars", () => {
    const bars = new Map([
      ["OLD", [bar(D(40), 5)]],
      ["NEW", [bar(D(40), 7), bar(D(1), 8)]],
    ]);
    const aligned = alignCloses(["OLD", "NEW"], bars, D(30));
    expect(aligned.dates).toEqual([D(1)]);
    expect(aligned.closes).toEqual({ NEW: [4] });
    expect(aligned.missing).toEqual(["OLD"]);
  });
});

describe("getHistory", () => {
  beforeEach(() => {
    yahoo.getDailyBars.mockReset();
  });

  it("reuses the 540-day request for 1y and trims to about a year", async () => {
    yahoo.getDailyBars.mockResolvedValue([bar(D(500), 1), bar(D(300), 2), bar(D(0), 3)]);
    const history = await getHistory(["AAPL"], "1y", NOW);
    expect(yahoo.getDailyBars).toHaveBeenCalledWith("AAPL", 540);
    expect(history.dates).toEqual([D(300), D(0)]);
    expect(history).toMatchObject({ range: "1y", missing: [], degraded: false });
  });

  it("lists failed symbols as missing and flags the response", async () => {
    yahoo.getDailyBars.mockImplementation(async (symbol) => {
      if (symbol === "BAD") throw new Error("Yahoo down");
      return [bar(D(1), 10), bar(D(0), 11)];
    });
    const history = await getHistory(["GOOD", "BAD"], "6mo", NOW);
    expect(history.missing).toEqual(["BAD"]);
    expect(history.degraded).toBe(true);
    expect(Object.keys(history.closes)).toEqual(["GOOD"]);
  });

  it("throws when every symbol failed upstream", async () => {
    yahoo.getDailyBars.mockRejectedValue(new Error("Yahoo down"));
    await expect(getHistory(["AAA", "BBB"], "2y", NOW)).rejects.toThrow("Yahoo down");
  });
});

describe("GET /api/history", () => {
  beforeEach(() => {
    yahoo.getDailyBars.mockReset();
    resetRateLimits();
  });

  const call = (query: string) => historyRoute(new Request(`http://localhost/api/history${query}`));

  it("validates the symbols and the range", async () => {
    expect((await call("")).status).toBe(400);
    expect((await call("?symbols=AAPL&range=10y")).status).toBe(400);
    const tooMany = Array.from({ length: 26 }, (_, i) => `S${i}`).join(",");
    const res = await call(`?symbols=${tooMany}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe("bad_request");
  });

  it("returns aligned closes with a shared cache header", async () => {
    yahoo.getDailyBars.mockResolvedValue([bar(D(1), 10), bar(D(0), 11)]);
    const res = await call("?symbols=aapl,spy&range=6mo");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=600");
    const body = (await res.json()) as HistoryResponse;
    expect(Object.keys(body.closes)).toEqual(["AAPL", "SPY"]);
    expect(body.range).toBe("6mo");
  });

  it("answers 502 when Yahoo fails for every symbol", async () => {
    yahoo.getDailyBars.mockRejectedValue(new Error("Yahoo down"));
    const res = await call("?symbols=AAPL");
    expect(res.status).toBe(502);
  });
});
