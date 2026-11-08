import { describe, expect, it } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";

import { comparePeers, followUpQuestions, suggestedQuestions, type SuggestionData } from "./ai-suggestions";

const NOW = new Date("2026-11-07T16:00:00Z");
const EN = MESSAGES.en.ai.suggest;
const ZH = MESSAGES.zh.ai.suggest;

function data(overrides: Partial<SuggestionData>): SuggestionData {
  return { page: { view: "market" }, lang: "en", live: true, hasPositions: false, now: NOW, ...overrides };
}

const ADVICE = /\b(should|buy|sell|trim|hedge|rebalance)\b|买入|卖出|减仓|加仓|建议/i;

describe("suggested questions", () => {
  it("ask why a stock is moving with its size, what the next report expects, and compare with peers", () => {
    const items = suggestedQuestions(data({ page: { view: "stock", symbol: "NVDA" }, changePercent: -3.14, nextEarningsDate: "2026-11-19T21:00:00.000Z" }), EN);
    expect(items[0]).toEqual({ text: "Why is NVDA down 3.14% today?", intent: { kind: "move", symbol: "NVDA" } });
    expect(items[1]).toEqual({ text: "What is expected from the Nov 19 report?", intent: { kind: "earnings", symbol: "NVDA" } });
    expect(items[2].text).toBe("What are the bull and bear cases for NVDA?");
    expect(items[3]).toEqual({ text: "Compare NVDA with MSFT and AAPL", intent: { kind: "compare", symbols: ["NVDA", "MSFT", "AAPL"] } });
    expect(items).toHaveLength(4);
  });

  it("asks about the investor's position when they hold the stock, and words a quiet day neutrally", () => {
    const items = suggestedQuestions(data({ page: { view: "stock", symbol: "NVDA" }, changePercent: 0.4, held: true, live: false }), EN);
    expect(items[0].text).toBe("What moved NVDA in the last session?");
    expect(items.map((i) => i.text)).toContain("How big is my NVDA position, and what is my P&L?");
    expect(items.map((i) => i.text).some((text) => text.includes("report"))).toBe(false);
  });

  it("calls out heavy volume even on a small move", () => {
    expect(suggestedQuestions(data({ page: { view: "stock", symbol: "NVDA" }, changePercent: 0.8, relativeVolume: 2.1 }), EN)[0].text).toBe("Why is NVDA up 0.80% today?");
  });

  it("asks about P&L, concentration and reports on the watchlist when positions are sent", () => {
    expect(suggestedQuestions(data({ page: { view: "watchlist" }, hasPositions: true }), EN).map((i) => i.text)).toEqual([
      "What drove my P&L today?",
      "Where is my portfolio most concentrated?",
      "Which holdings report in the next two weeks?",
      "How has my portfolio behaved over the past year?",
    ]);
    expect(suggestedQuestions(data({ page: { view: "watchlist" } }), EN)[0].text).toBe("How did my watchlist do today?");
  });

  it("covers the market and sector pages, in Chinese too", () => {
    expect(suggestedQuestions(data({ hasPositions: true }), EN).map((i) => i.text)).toContain("How did my portfolio do today?");
    const sector = suggestedQuestions(data({ page: { view: "sector", sector: "technology" }, lang: "zh" }), ZH);
    expect(sector[0].text).toBe("信息技术今天的涨跌由什么驱动？");
    const stock = suggestedQuestions(data({ page: { view: "stock", symbol: "NVDA" }, lang: "zh", changePercent: 2.78 }), ZH);
    expect(stock[0].text).toBe("NVDA 今天为什么上涨 2.78%？");
    expect(stock.find((item) => item.intent?.kind === "compare")?.text).toBe("比较 NVDA 与 MSFT 和 AAPL");
  });

  it("are never phrased as advice, in either language", () => {
    const pages: SuggestionData["page"][] = [{ view: "stock", symbol: "NVDA" }, { view: "watchlist" }, { view: "market" }, { view: "sector", sector: "energy" }];
    for (const [lang, m] of [
      ["en", EN],
      ["zh", ZH],
    ] as const) {
      for (const page of pages) {
        for (const hasPositions of [true, false]) {
          const input = data({ page, lang, hasPositions, held: true, changePercent: 2, nextEarningsDate: "2026-11-10" });
          for (const item of [...suggestedQuestions(input, m), ...followUpQuestions(input, m, [])]) expect(item.text).not.toMatch(ADVICE);
        }
      }
    }
  });
});

describe("follow-up questions", () => {
  it("offer up to three questions not asked yet", () => {
    const input = data({ page: { view: "stock", symbol: "NVDA" } });
    const all = followUpQuestions(input, EN, []);
    expect(all).toHaveLength(3);
    const next = followUpQuestions(input, EN, [all[0].text]);
    expect(next.map((i) => i.text)).not.toContain(all[0].text);
    expect(followUpQuestions(data({ page: { view: "sector", sector: "energy" } }), EN, [])).toHaveLength(3);
  });

  it("pick peers from the universe sector", () => {
    expect(comparePeers("NVDA")).toEqual(["MSFT", "AAPL"]);
    expect(comparePeers("PLTR")).toEqual([]);
  });
});
