import { beforeEach, describe, expect, it, vi } from "vitest";

import { uncachedOwnershipCalls } from "@/lib/server/charging";
import { jsonError } from "@/lib/server/http";
import { getOwnership } from "@/lib/server/research";
import { chargePublicRequest } from "@/lib/server/request-guard";

import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/log", () => ({ log: vi.fn(), logThrottled: vi.fn() }));
vi.mock("@/lib/server/research", () => ({ getOwnership: vi.fn() }));
vi.mock("@/lib/server/charging", () => ({
  extraUnits: (calls: number) => Math.max(0, calls - 1),
  uncachedOwnershipCalls: vi.fn(() => 0),
}));
vi.mock("@/lib/server/request-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/request-guard")>()),
  chargePublicRequest: vi.fn(() => null),
}));

// A stand-in for the ownership data: the route passes the loader's answer through unchanged.
const DATA = { symbol: "NVDA", asOf: "2026-11-07T15:00:00.000Z" } as unknown as NonNullable<Awaited<ReturnType<typeof getOwnership>>>;

function call(symbol: string) {
  return GET(new Request(`http://localhost/api/stock/${symbol}/ownership`), { params: Promise.resolve({ symbol }) });
}

describe("GET /api/stock/[symbol]/ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(uncachedOwnershipCalls).mockReturnValue(0);
    vi.mocked(chargePublicRequest).mockReturnValue(null);
  });

  it("answers the ownership data with a shared-cache lifetime", async () => {
    vi.mocked(getOwnership).mockResolvedValue(DATA);
    const response = await call("nvda");
    expect(response.status).toBe(200);
    expect(getOwnership).toHaveBeenCalledWith("NVDA");
    expect(await response.json()).toEqual(DATA);
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600,");
  });

  it("charges one unit for every uncached Yahoo call beyond the first", async () => {
    vi.mocked(getOwnership).mockResolvedValue(DATA);
    vi.mocked(uncachedOwnershipCalls).mockReturnValue(1);
    await call("NVDA");
    expect(uncachedOwnershipCalls).toHaveBeenCalledWith("NVDA");
    expect(vi.mocked(chargePublicRequest).mock.calls[0]?.[1]).toBe(0);
  });

  it("answers 429 without loading when the client's budget cannot cover the calls", async () => {
    vi.mocked(uncachedOwnershipCalls).mockReturnValue(1);
    vi.mocked(chargePublicRequest).mockReturnValue(jsonError(429, "rate_limited", "Too many requests."));
    const response = await call("NVDA");
    expect(response.status).toBe(429);
    expect(getOwnership).not.toHaveBeenCalled();
  });

  it("answers 404 when there is nothing to show and 502 when Yahoo fails", async () => {
    vi.mocked(getOwnership).mockResolvedValueOnce(null);
    expect((await call("SPY")).status).toBe(404);
    vi.mocked(getOwnership).mockRejectedValueOnce(new Error("fetch failed"));
    const failed = await call("NVDA");
    expect(failed.status).toBe(502);
    expect((await failed.json()).error.code).toBe("upstream_error");
  });

  it("rejects an invalid symbol before charging", async () => {
    const response = await call("not a symbol");
    expect(response.status).toBe(400);
    expect(chargePublicRequest).not.toHaveBeenCalled();
    expect(getOwnership).not.toHaveBeenCalled();
  });
});
