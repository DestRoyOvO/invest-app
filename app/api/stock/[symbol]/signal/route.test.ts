import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSignalReport, SignalNotFoundError } from "@/lib/server/signal-service";
import type { SignalReport } from "@/types/api";

import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/signal-service", () => {
  class SignalNotFoundError extends Error {}
  return { getSignalReport: vi.fn(), SignalNotFoundError };
});

const REPORT: SignalReport = {
  symbol: "^GSPC",
  asOf: "2026-11-07T00:00:00.000Z",
  status: "insufficient_data",
  reason: "Not enough price history: 0 of the 120 daily bars the model needs.",
  code: null,
  score: null,
  technicalScore: null,
  consensus: null,
  coverage: null,
  confidence: null,
  factors: [],
  backtest: null,
  meta: { bars: 0, droppedPartialBar: false, lastBarDate: null },
};

function call(symbol: string) {
  return GET(new Request(`http://localhost/api/stock/${symbol}/signal`), { params: Promise.resolve({ symbol }) });
}

describe("GET /api/stock/[symbol]/signal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects invalid symbols with 400", async () => {
    for (const symbol of ["not a symbol", "%E0%A4%A", "toolongsymbol12345"]) {
      const response = await call(symbol);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "bad_request" } });
    }
    expect(getSignalReport).not.toHaveBeenCalled();
  });

  it("normalizes and decodes the symbol and lets the CDN cache the report", async () => {
    vi.mocked(getSignalReport).mockResolvedValue(REPORT);
    const response = await call("%5Egspc");
    expect(getSignalReport).toHaveBeenCalledWith("^GSPC");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(await response.json()).toEqual(REPORT);
  });

  it("maps an unknown symbol to 404", async () => {
    vi.mocked(getSignalReport).mockRejectedValue(new SignalNotFoundError("ZZZZ"));
    const response = await call("zzzz");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("hides upstream errors behind a generic 502", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getSignalReport).mockRejectedValue(new Error("internal detail: socket hang up"));
    const response = await call("AAPL");
    expect(response.status).toBe(502);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: { code: "upstream_error" } });
    expect(JSON.stringify(body)).not.toContain("socket");
    expect(response.headers.get("cache-control")).toBe("no-store");
    log.mockRestore();
  });
});
