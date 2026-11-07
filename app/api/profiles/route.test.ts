import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/server/http";
import { getProfiles, uncachedProfileCalls } from "@/lib/server/profiles";
import { chargePublicRequest } from "@/lib/server/request-guard";
import type { ProfilesResponse } from "@/types/portfolio";

import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/profiles", () => ({ getProfiles: vi.fn(), uncachedProfileCalls: vi.fn(() => 0), MAX_PROFILE_SYMBOLS: 25 }));
vi.mock("@/lib/server/request-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/request-guard")>()),
  chargePublicRequest: vi.fn(() => null),
}));

const BODY: ProfilesResponse = {
  asOf: "2026-11-07T15:00:00.000Z",
  profiles: { PLTR: { symbol: "PLTR", name: "Palantir", sector: "Technology", industry: "Software", country: "United States", currency: "USD" } },
  missing: [],
  degraded: false,
};

function call(query: string) {
  return GET(new Request(`http://localhost/api/profiles${query}`));
}

describe("GET /api/profiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(uncachedProfileCalls).mockReturnValue(0);
    vi.mocked(chargePublicRequest).mockReturnValue(null);
  });

  it("returns profiles for normalized symbols", async () => {
    vi.mocked(getProfiles).mockResolvedValue(BODY);
    const response = await call("?symbols=pltr,PLTR");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(BODY);
    expect(getProfiles).toHaveBeenCalledWith(["PLTR"]);
    expect(response.headers.get("cache-control")).toMatch(/max-age|no-store|private/);
  });

  it("charges one unit for every uncached Yahoo call beyond the first", async () => {
    vi.mocked(getProfiles).mockResolvedValue(BODY);
    vi.mocked(uncachedProfileCalls).mockReturnValue(5);
    await call("?symbols=A,B,C,D,E");
    expect(uncachedProfileCalls).toHaveBeenCalledWith(["A", "B", "C", "D", "E"]);
    expect(vi.mocked(chargePublicRequest).mock.calls[0]?.[1]).toBe(4);
  });

  it("charges nothing extra when every profile is cached", async () => {
    vi.mocked(getProfiles).mockResolvedValue(BODY);
    await call("?symbols=PLTR");
    expect(vi.mocked(chargePublicRequest).mock.calls[0]?.[1]).toBe(0);
  });

  it("answers 429 without calling Yahoo when the budget cannot cover the calls", async () => {
    vi.mocked(uncachedProfileCalls).mockReturnValue(9);
    vi.mocked(chargePublicRequest).mockReturnValue(jsonError(429, "rate_limited", "Too many requests."));
    const response = await call("?symbols=A,B,C,D,E,F,G,H,I");
    expect(response.status).toBe(429);
    expect(getProfiles).not.toHaveBeenCalled();
  });

  it("rejects a missing, invalid or oversized symbol list before charging", async () => {
    expect((await call("")).status).toBe(400);
    expect((await call("?symbols=not%20a%20symbol")).status).toBe(400);
    const many = Array.from({ length: 26 }, (_, i) => "S" + i).join(",");
    expect((await call(`?symbols=${many}`)).status).toBe(400);
    expect(chargePublicRequest).not.toHaveBeenCalled();
  });

  it("caches a degraded answer briefly and maps failures to 502", async () => {
    vi.mocked(getProfiles).mockResolvedValueOnce({ ...BODY, degraded: true, missing: ["FAIL"] });
    const degraded = await call("?symbols=PLTR,FAIL");
    expect(degraded.status).toBe(200);
    expect(degraded.headers.get("cache-control")).toContain("s-maxage=60,");
    vi.mocked(getProfiles).mockResolvedValueOnce(BODY);
    expect((await call("?symbols=PLTR")).headers.get("cache-control")).toContain("s-maxage=3600,");
    vi.mocked(getProfiles).mockRejectedValueOnce(new Error("boom"));
    const failed = await call("?symbols=PLTR");
    expect(failed.status).toBe(502);
    expect((await failed.json()).error.code).toBe("upstream_error");
  });
});
