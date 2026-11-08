import { beforeEach, describe, expect, it, vi } from "vitest";

import { uncachedStockNewsCalls } from "@/lib/server/charging";
import { jsonError } from "@/lib/server/http";
import { getStockNews } from "@/lib/server/market";
import { chargePublicRequest } from "@/lib/server/request-guard";

import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/log", () => ({ log: vi.fn(), logThrottled: vi.fn() }));
vi.mock("@/lib/server/market", () => ({ getStockNews: vi.fn() }));
vi.mock("@/lib/server/charging", () => ({
  extraUnits: (calls: number) => Math.max(0, calls - 1),
  uncachedStockNewsCalls: vi.fn(() => 0),
}));
vi.mock("@/lib/server/request-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/request-guard")>()),
  chargePublicRequest: vi.fn(() => null),
}));

// A stand-in for the news: the route passes the loader's answer through unchanged.
const DATA = [{ id: "n1", title: "NVDA headline" }] as unknown as NonNullable<Awaited<ReturnType<typeof getStockNews>>>;

function call(symbol: string) {
  return GET(new Request(`http://localhost/api/stock/${symbol}/news`), { params: Promise.resolve({ symbol }) });
}

describe("GET /api/stock/[symbol]/news", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(uncachedStockNewsCalls).mockReturnValue(0);
    vi.mocked(chargePublicRequest).mockReturnValue(null);
  });

  it("answers the news with a shared-cache lifetime", async () => {
    vi.mocked(getStockNews).mockResolvedValue(DATA);
    const response = await call("nvda");
    expect(response.status).toBe(200);
    expect(getStockNews).toHaveBeenCalledWith("NVDA");
    expect((await response.json()).news).toEqual(DATA);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300,");
  });

  it("charges one unit for every uncached Yahoo call beyond the first", async () => {
    vi.mocked(getStockNews).mockResolvedValue(DATA);
    vi.mocked(uncachedStockNewsCalls).mockReturnValue(7);
    await call("NVDA");
    expect(uncachedStockNewsCalls).toHaveBeenCalledWith("NVDA");
    expect(vi.mocked(chargePublicRequest).mock.calls[0]?.[1]).toBe(6);
  });

  it("answers 429 without loading when the client's budget cannot cover the calls", async () => {
    vi.mocked(uncachedStockNewsCalls).mockReturnValue(7);
    vi.mocked(chargePublicRequest).mockReturnValue(jsonError(429, "rate_limited", "Too many requests."));
    const response = await call("NVDA");
    expect(response.status).toBe(429);
    expect(getStockNews).not.toHaveBeenCalled();
  });

  it("answers 404 when there is nothing to show and 502 when Yahoo fails", async () => {
    vi.mocked(getStockNews).mockResolvedValueOnce(null);
    expect((await call("SPY")).status).toBe(404);
    vi.mocked(getStockNews).mockRejectedValueOnce(new Error("fetch failed"));
    const failed = await call("NVDA");
    expect(failed.status).toBe(502);
    expect((await failed.json()).error.code).toBe("upstream_error");
  });

  it("rejects an invalid symbol before charging", async () => {
    const response = await call("not a symbol");
    expect(response.status).toBe(400);
    expect(chargePublicRequest).not.toHaveBeenCalled();
    expect(getStockNews).not.toHaveBeenCalled();
  });
});
