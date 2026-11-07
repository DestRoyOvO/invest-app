import { describe, expect, it } from "vitest";

import { staleSinceLabel } from "./stale";

describe("staleSinceLabel", () => {
  const now = Date.parse("2026-11-07T19:30:00Z");

  it("shows only the time for data from the same day", () => {
    expect(staleSinceLabel("2026-11-07T19:05:00Z", "en", now, "UTC")).toBe("19:05");
  });

  it("adds the date for older data", () => {
    expect(staleSinceLabel("2026-11-06T21:00:00Z", "en", now, "UTC")).toBe("Nov 6 21:00");
    expect(staleSinceLabel("2026-11-06T21:00:00Z", "zh", now, "UTC")).toMatch(/^11月6日 21:00$/);
  });

  it("decides the day in the given time zone", () => {
    // 01:00 UTC on Nov 7 is still Nov 6 in New York.
    expect(staleSinceLabel("2026-11-07T01:00:00Z", "en", now, "America/New_York")).toBe("Nov 6 20:00");
  });

  it("accepts epoch milliseconds", () => {
    expect(staleSinceLabel(now - 60_000, "en", now, "UTC")).toBe("19:29");
  });
});
