import { describe, expect, it } from "vitest";

import { combineStaleness, rangePosition, relativeVolume, sharePercent, stalenessOf, staleSinceOf } from "./metrics";

describe("relativeVolume", () => {
  it("divides today's volume by the 3-month average", () => {
    expect(relativeVolume({ volume: 300, avgVolume: 100 })).toBe(3);
    expect(relativeVolume({ volume: 0, avgVolume: 100 })).toBe(0);
  });

  it("is null without both numbers or with a zero average", () => {
    expect(relativeVolume({ volume: null, avgVolume: 100 })).toBeNull();
    expect(relativeVolume({ volume: 100, avgVolume: null })).toBeNull();
    expect(relativeVolume({ volume: 100, avgVolume: 0 })).toBeNull();
  });
});

describe("rangePosition", () => {
  it("places the price between the 52-week low and high", () => {
    expect(rangePosition({ price: 150, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 })).toBe(50);
    expect(rangePosition({ price: 250, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 })).toBe(100);
    expect(rangePosition({ price: 90, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 })).toBe(0);
  });

  it("is null without a valid range or price", () => {
    expect(rangePosition({ price: 150, fiftyTwoWeekLow: null, fiftyTwoWeekHigh: 200 })).toBeNull();
    expect(rangePosition({ price: 150, fiftyTwoWeekLow: 200, fiftyTwoWeekHigh: 200 })).toBeNull();
    expect(rangePosition({ price: null, fiftyTwoWeekLow: 100, fiftyTwoWeekHigh: 200 })).toBeNull();
  });
});

describe("sharePercent", () => {
  it("rounds to whole percent", () => {
    expect(sharePercent(44, 78)).toBe(56);
    expect(sharePercent(0, 78)).toBe(0);
    expect(sharePercent(1, 0)).toBeNull();
  });
});

describe("staleSinceOf", () => {
  const base = { asOf: "2026-11-07T20:00:05.000Z", staleSince: null, warnings: [] as string[] };

  it("uses the oldest stale quote when the server served some", () => {
    expect(staleSinceOf({ ...base, warnings: ["quotes_stale"], staleSince: "2026-11-07T19:40:00.000Z" })).toBe("2026-11-07T19:40:00.000Z");
  });

  it("uses the response time when only the refresh failed", () => {
    expect(staleSinceOf(base)).toBe("2026-11-07T20:00:05.000Z");
  });

  it("leaves the time out when it is unknown", () => {
    expect(staleSinceOf({ ...base, warnings: ["quotes_stale"] })).toBeNull();
    expect(staleSinceOf(undefined)).toBeNull();
  });
});

describe("stalenessOf and combineStaleness", () => {
  const base = { asOf: "2026-11-07T20:00:05.000Z", staleSince: null, warnings: [] as string[] };
  const overview = { ...base, warnings: ["quotes_stale"], staleSince: "2026-11-07T19:40:00.000Z" };

  it("calls a feed stale when the server served old quotes or the refresh failed, never before data arrives", () => {
    expect(stalenessOf(base, false)).toEqual({ stale: false, since: null });
    expect(stalenessOf(overview, false)).toEqual({ stale: true, since: "2026-11-07T19:40:00.000Z" });
    expect(stalenessOf(base, true)).toEqual({ stale: true, since: "2026-11-07T20:00:05.000Z" });
    expect(stalenessOf(undefined, true)).toEqual({ stale: false, since: null });
  });

  it("puts one banner over several feeds, as of the oldest time, and without a time when one is unknown", () => {
    const fresh = { stale: false, since: null };
    expect(combineStaleness([fresh, fresh])).toEqual(fresh);
    expect(combineStaleness([fresh, { stale: true, since: "2026-11-07T19:58:00.000Z" }])).toEqual({ stale: true, since: "2026-11-07T19:58:00.000Z" });
    expect(combineStaleness([{ stale: true, since: "2026-11-07T19:58:00.000Z" }, { stale: true, since: "2026-11-07T19:40:00.000Z" }])).toEqual({
      stale: true,
      since: "2026-11-07T19:40:00.000Z",
    });
    expect(combineStaleness([{ stale: true, since: "2026-11-07T19:58:00.000Z" }, { stale: true, since: null }])).toEqual({ stale: true, since: null });
  });
});
