import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ValuedPosition } from "@/lib/portfolio";
import { analyzeRisk } from "@/lib/portfolio-analytics";

import { CorrelationTab } from "./CorrelationTab";

// The correlation tab's note as server-rendered markup. Every statistic uses the sessions on which each analyzed
// holding has a price, so a holding listed the session before leaves a single session.

vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});

const DAY = 86_400_000;
const DATES = [1, 2, 3, 4, 5].map((i) => Date.UTC(2026, 10, 1) + i * DAY);

function pos(symbol: string, shares: number, price: number): ValuedPosition {
  const value = shares * price;
  return { symbol, shares, cost: price, price, currency: "USD", value, costBasis: value, pnl: 0, pnlPct: null, dayPnl: null, weight: null };
}

/** The tab's text without tags, for two holdings: OLD with five closes, and NEW with the given ones. */
function tab(newCloses: Array<number | null>) {
  const report = analyzeRisk([pos("OLD", 10, 14), pos("NEW", 5, 21)], { dates: DATES, closes: { OLD: [10, 11, 12, 13, 14], NEW: newCloses } });
  return { sessions: report.sessions, text: renderToStaticMarkup(createElement(CorrelationTab, { report })).replace(/<[^>]+>/g, "") };
}

describe("CorrelationTab", () => {
  it("counts a single session in the singular", () => {
    const { sessions, text } = tab([null, null, null, 20, 21]);
    expect(sessions).toBe(1);
    expect(text).toContain("Based on 1 session.");
  });

  it("counts more sessions in the plural", () => {
    const { sessions, text } = tab([17, 18, 19, 20, 21]);
    expect(sessions).toBe(4);
    expect(text).toContain("Based on 4 sessions.");
  });
});
