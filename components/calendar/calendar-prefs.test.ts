import { describe, expect, it } from "vitest";

import { sanitizeCalendarPrefs } from "./calendar-prefs";

describe("sanitizeCalendarPrefs", () => {
  it("keeps valid choices in the canonical order", () => {
    expect(sanitizeCalendarPrefs({ range: "month", filters: ["macro", "holdings"] })).toEqual({ range: "month", filters: ["holdings", "macro"] });
    expect(sanitizeCalendarPrefs({ range: "next", filters: [] })).toEqual({ range: "next", filters: [] });
  });

  it("falls back to the defaults for anything else", () => {
    expect(sanitizeCalendarPrefs(null)).toEqual({ range: "week", filters: ["holdings", "watchlist", "macro"] });
    expect(sanitizeCalendarPrefs({ range: "year", filters: "all" })).toEqual({ range: "week", filters: ["holdings", "watchlist", "macro"] });
    expect(sanitizeCalendarPrefs({ filters: ["bogus", "universe"] })).toEqual({ range: "week", filters: ["universe"] });
  });
});
