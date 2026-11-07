import { describe, expect, it } from "vitest";

import { sanitizeWatchlistView } from "./watchlist-view";

describe("sanitizeWatchlistView", () => {
  it("keeps a known column sort", () => {
    expect(sanitizeWatchlistView({ sort: { key: "changePct", direction: "desc" } })).toEqual({ sort: { key: "changePct", direction: "desc" } });
    expect(sanitizeWatchlistView({ sort: { key: "symbol", direction: "asc" }, extra: 1 })).toEqual({ sort: { key: "symbol", direction: "asc" } });
  });

  it("falls back to the investor's own order for anything else", () => {
    for (const raw of [null, "x", [], {}, { sort: null }, { sort: { key: "trend", direction: "asc" } }, { sort: { key: "last", direction: "up" } }]) {
      expect(sanitizeWatchlistView(raw)).toEqual({ sort: null });
    }
  });
});
