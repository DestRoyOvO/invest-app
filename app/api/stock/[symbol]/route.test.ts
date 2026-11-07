import { beforeEach, describe, expect, it, vi } from "vitest";

import { uncachedStockDetailCalls } from "@/lib/server/charging";
import { jsonError } from "@/lib/server/http";
import { getStockDetail } from "@/lib/server/market";
import { chargePublicRequest } from "@/lib/server/request-guard";
import type { StockDetail } from "@/types/api";

import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/market", () => ({ getStockDetail: vi.fn() }));
vi.mock("@/lib/server/charging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/charging")>()),
  uncachedStockDetailCalls: vi.fn(() => 0),
}));
vi.mock("@/lib/server/request-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/request-guard")>()),
  chargePublicRequest: vi.fn(() => null),
}));

const DETAIL = {
  asOf: "2026-11-07T15:00:00.000Z",
  quote: { symbol: "NVDA", marketState: "CLOSED" },
  profile: { symbol: "NVDA" },
  stats: {},
  news: [],
  warnings: [],
} as unknown as StockDetail;

function call(symbol: string) {
  return GET(new Request(`http://localhost/api/stock/${symbol}`), { params: Promise.resolve({ symbol }) });
}

describe("GET /api/stock/[symbol] charging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(uncachedStockDetailCalls).mockReturnValue(0);
    vi.mocked(chargePublicRequest).mockReturnValue(null);
  });

  it("charges one unit for every uncached Yahoo call beyond the first", async () => {
    vi.mocked(getStockDetail).mockResolvedValue(DETAIL);
    vi.mocked(uncachedStockDetailCalls).mockReturnValue(7);
    const response = await call("nvda");
    expect(response.status).toBe(200);
    expect(uncachedStockDetailCalls).toHaveBeenCalledWith("NVDA");
    expect(vi.mocked(chargePublicRequest).mock.calls[0]?.[1]).toBe(6);
  });

  it("charges nothing extra when everything is cached", async () => {
    vi.mocked(getStockDetail).mockResolvedValue(DETAIL);
    await call("NVDA");
    expect(vi.mocked(chargePublicRequest).mock.calls[0]?.[1]).toBe(0);
  });

  it("answers 429 without touching Yahoo when the client's budget cannot cover the calls", async () => {
    vi.mocked(uncachedStockDetailCalls).mockReturnValue(7);
    vi.mocked(chargePublicRequest).mockReturnValue(jsonError(429, "rate_limited", "Too many requests."));
    const response = await call("NVDA");
    expect(response.status).toBe(429);
    expect(getStockDetail).not.toHaveBeenCalled();
  });

  it("rejects an invalid symbol before charging", async () => {
    const response = await call("not a symbol");
    expect(response.status).toBe(400);
    expect(chargePublicRequest).not.toHaveBeenCalled();
  });
});
