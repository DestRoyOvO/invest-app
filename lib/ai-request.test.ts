import { describe, expect, it } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";

import { chatRequestContext, contextRef, pageContextFromPath, positionFlags, positionsForAi } from "./ai-request";
import { suggestedQuestions } from "./ai-suggestions";

const HOLDINGS = {
  NVDA: { shares: 10, cost: 120 },
  AAPL: { shares: 10, cost: 200 },
  JPM: { shares: 1, cost: 250 },
};

const LABELS = { market: "Market", watchlist: "Watchlist", portfolio: "Portfolio" };

describe("chat request context", () => {
  it("maps paths to views", () => {
    expect(pageContextFromPath("/stock/nvda")).toEqual({ view: "stock", symbol: "NVDA" });
    expect(pageContextFromPath("/stock/%5EGSPC")).toEqual({ view: "stock", symbol: "^GSPC" });
    expect(pageContextFromPath("/stock/%E0%A4%A")).toEqual({ view: "market" });
    expect(pageContextFromPath("/sector/technology")).toEqual({ view: "sector", sector: "technology" });
    expect(pageContextFromPath("/sector/crypto")).toEqual({ view: "market" });
    expect(pageContextFromPath("/watchlist")).toEqual({ view: "watchlist" });
    expect(pageContextFromPath("/portfolio")).toEqual({ view: "watchlist", portfolio: true });
    expect(pageContextFromPath("/calendar")).toEqual({ view: "market" });
    expect(pageContextFromPath("/")).toEqual({ view: "market" });
  });

  it("sends the largest positions by cost basis, at most 50", () => {
    expect(positionsForAi(HOLDINGS).map((p) => p.symbol)).toEqual(["AAPL", "NVDA", "JPM"]);
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`S${i}`, { shares: 1, cost: i + 1 }]));
    expect(positionsForAi(many)).toHaveLength(50);
    expect(positionsForAi(many)[0].symbol).toBe("S59");
  });

  it("sends every position on the watchlist, market and sector views, and only the symbol's own on the stock view", () => {
    const base = { watchlist: ["NVDA", "MSFT"], holdings: HOLDINGS, includePositions: true };
    expect(chatRequestContext({ ...base, page: { view: "watchlist" } })).toEqual({ view: "watchlist", symbols: ["NVDA", "MSFT"], positions: positionsForAi(HOLDINGS) });
    expect(chatRequestContext({ ...base, page: { view: "market" } })).toEqual({ view: "market", positions: positionsForAi(HOLDINGS) });
    expect(chatRequestContext({ ...base, page: { view: "sector", sector: "energy" } })).toMatchObject({ view: "sector", sector: "energy", positions: positionsForAi(HOLDINGS) });
    expect(chatRequestContext({ ...base, page: { view: "stock", symbol: "NVDA" } })).toEqual({ view: "stock", symbol: "NVDA", positions: [{ symbol: "NVDA", shares: 10, cost: 120 }] });
    expect(chatRequestContext({ ...base, page: { view: "stock", symbol: "MSFT" } })).toEqual({ view: "stock", symbol: "MSFT" });
  });

  it("sends no positions when the investor turned them off, and carries the intent", () => {
    const context = chatRequestContext({ page: { view: "watchlist" }, watchlist: [], holdings: HOLDINGS, includePositions: false, intent: { kind: "move", symbol: "NVDA" } });
    expect(context).toEqual({ view: "watchlist", symbols: [], intent: { kind: "move", symbol: "NVDA" } });
    expect(chatRequestContext({ page: { view: "stock", symbol: "NVDA" }, watchlist: [], holdings: HOLDINGS, includePositions: false })).toEqual({ view: "stock", symbol: "NVDA" });
  });

  it("lets questions assume only positions that are sent", () => {
    expect(positionFlags(HOLDINGS, true, "NVDA")).toEqual({ held: true, hasPositions: true });
    expect(positionFlags(HOLDINGS, true, "MSFT")).toEqual({ held: false, hasPositions: true });
    expect(positionFlags(HOLDINGS, false, "NVDA")).toEqual({ held: false, hasPositions: false });
    expect(positionFlags({ NVDA: { shares: 0, cost: 120 } }, true, "NVDA")).toEqual({ held: false, hasPositions: false });
    expect(positionFlags(HOLDINGS, true)).toEqual({ held: false, hasPositions: true });
    // With positions off, the stock page asks no question about the position the request would leave out.
    const off = positionFlags(HOLDINGS, false, "NVDA");
    const starters = suggestedQuestions({ page: { view: "stock", symbol: "NVDA" }, lang: "en", live: true, now: new Date("2026-11-07T16:00:00Z"), ...off }, MESSAGES.en.ai.suggest);
    expect(starters.map((item) => item.text)).not.toContain("How big is my NVDA position, and what is my P&L?");
  });

  it("labels the page for the conversation", () => {
    expect(contextRef({ view: "stock", symbol: "NVDA" }, "en", LABELS)).toEqual({ key: "stock:NVDA", label: "NVDA" });
    expect(contextRef({ view: "sector", sector: "technology" }, "zh", LABELS)).toEqual({ key: "sector:technology", label: "信息技术" });
    expect(contextRef({ view: "watchlist", portfolio: true }, "en", LABELS)).toEqual({ key: "portfolio", label: "Portfolio" });
    expect(contextRef({ view: "watchlist" }, "en", LABELS)).toEqual({ key: "watchlist", label: "Watchlist" });
    expect(contextRef({ view: "market" }, "en", LABELS)).toEqual({ key: "market", label: "Market" });
  });
});
