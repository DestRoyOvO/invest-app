import { describe, expect, it } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";
import type { Quote } from "@/types/api";
import type { BoardResponse } from "@/types/shell";

import { boardIsStale, delayedNotice, etLabel } from "./board-status";

const en = MESSAGES.en;
const zh = MESSAGES.zh;

function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return { symbol, price: 1, changePercent: 0, stale: false, fetchedAt: "2026-11-09T18:00:00.000Z", ...overrides } as Quote;
}

function board(overrides: Partial<BoardResponse> = {}): BoardResponse {
  return { asOf: "2026-11-09T19:00:00.000Z", marketState: "REGULAR", board: [{ quote: quote("^GSPC"), spark: [] }], warnings: [], quotesAsOf: null, ...overrides };
}

// 14:00 EST on Monday 9 Nov 2026.
const NOW = Date.UTC(2026, 10, 9, 19, 0);

describe("etLabel", () => {
  it("formats exchange times in New York with an ET label", () => {
    expect(etLabel(en, "2026-11-09T18:05:00.000Z", "en", NOW)).toBe("13:05 ET");
    expect(etLabel(zh, "2026-11-09T18:05:00.000Z", "zh", NOW)).toBe("美东 13:05");
    expect(etLabel(en, "2026-11-06T21:00:00.000Z", "en", NOW)).toMatch(/Nov.*6.* 16:00 ET$/);
    // Before the clock runs (server rendering) the time alone is shown.
    expect(etLabel(en, "2026-11-06T21:00:00.000Z", "en", null)).toBe("16:00 ET");
  });
});

describe("delayedNotice", () => {
  it("stays silent while quotes are live", () => {
    expect(delayedNotice(en, undefined, false, "en", NOW)).toBeNull();
    expect(delayedNotice(en, board(), false, "en", NOW)).toBeNull();
    expect(boardIsStale(board())).toBe(false);
  });

  it("says since when quotes are delayed, from the oldest stale quote", () => {
    const stale = board({
      board: [{ quote: quote("^GSPC", { stale: true, fetchedAt: "2026-11-09T18:05:00.000Z" }), spark: [] }],
      warnings: ["quotes_stale"],
      quotesAsOf: "2026-11-09T18:05:00.000Z",
    });
    expect(boardIsStale(stale)).toBe(true);
    expect(delayedNotice(en, stale, false, "en", NOW)).toBe("Quotes delayed since 13:05 ET · Yahoo unavailable");
    expect(delayedNotice(zh, stale, false, "zh", NOW)).toBe("行情自 美东 13:05 起延迟 · Yahoo 暂不可用");
  });

  it("treats a failed refresh of the board itself as delayed since the last board", () => {
    expect(delayedNotice(en, board(), true, "en", NOW)).toBe("Quotes delayed since 14:00 ET · Yahoo unavailable");
  });

  it("falls back to a notice without a time", () => {
    const stale = board({ board: [{ quote: quote("^GSPC", { stale: true, fetchedAt: null }), spark: [] }] });
    expect(delayedNotice(en, stale, false, "en", NOW)).toBe("Quotes delayed · Yahoo unavailable");
  });
});
