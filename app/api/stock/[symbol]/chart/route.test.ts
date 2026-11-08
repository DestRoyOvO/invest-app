import { beforeEach, describe, expect, it, vi } from "vitest";

import { getChartData } from "@/lib/server/market";
import type { ChartData } from "@/types/api";

import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/log", () => ({ log: vi.fn(), logThrottled: vi.fn() }));
vi.mock("@/lib/server/market", () => ({ getChartData: vi.fn() }));

function chart(intraday: boolean): ChartData {
  return { symbol: "NVDA", range: intraday ? "1d" : "1y", interval: intraday ? "5m" : "1d", intraday, bars: [], timezone: null, previousClose: null, dividends: [], splits: [] };
}

function call(symbol: string, query = "") {
  return GET(new Request(`http://localhost/api/stock/${symbol}/chart${query}`), { params: Promise.resolve({ symbol }) });
}

describe("GET /api/stock/[symbol]/chart", () => {
  beforeEach(() => vi.resetAllMocks());

  it("defaults to 1Y and caches intraday charts for a shorter time", async () => {
    vi.mocked(getChartData).mockResolvedValueOnce(chart(false));
    const daily = await call("nvda");
    expect(daily.status).toBe(200);
    expect(getChartData).toHaveBeenLastCalledWith("NVDA", "1y");
    expect(daily.headers.get("cache-control")).toContain("s-maxage=60,");

    vi.mocked(getChartData).mockResolvedValueOnce(chart(true));
    const intraday = await call("NVDA", "?range=1d");
    expect(getChartData).toHaveBeenLastCalledWith("NVDA", "1d");
    expect(intraday.headers.get("cache-control")).toContain("s-maxage=30,");
  });

  it("rejects an unknown range or symbol without loading", async () => {
    const badRange = await call("NVDA", "?range=10y");
    expect(badRange.status).toBe(400);
    expect((await badRange.json()).error.message).toContain("1d, 5d, 1mo, 3mo, 6mo, ytd, 1y, 2y, 5y, max");
    expect((await call("not a symbol")).status).toBe(400);
    expect(getChartData).not.toHaveBeenCalled();
  });

  it("answers 404 for a symbol without data and 502 when Yahoo fails", async () => {
    vi.mocked(getChartData).mockResolvedValueOnce(null);
    expect((await call("ZZZZ")).status).toBe(404);
    vi.mocked(getChartData).mockRejectedValueOnce(new Error("fetch failed"));
    expect((await call("NVDA")).status).toBe(502);
  });
});
