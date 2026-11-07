import { describe, expect, it } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";

import { chipLabel, earningsText, formatBound, formatMetric, formatRelativeVolume, rangeLabel } from "./display";

const en = MESSAGES.en;
const zh = MESSAGES.zh;
const NOW = Date.parse("2026-11-07T15:00:00Z");
const sectorLabel = (key: string) => (key === "energy" ? "Energy" : key === "utilities" ? "Utilities" : "Information Technology");

describe("formatMetric", () => {
  it("formats each unit with a true minus and a dash for missing values", () => {
    expect(formatMetric("pe", null, "en")).toBe("—");
    expect(formatMetric("price", 1234.5, "en")).toBe("1,234.50");
    expect(formatMetric("cap", 3.9e12, "en")).toBe("3.9T");
    expect(formatMetric("yield", 0.0312, "en")).toBe("3.12%");
    expect(formatMetric("er", 0.0009, "en")).toBe("0.09%");
    expect(formatMetric("high", -0.123, "en")).toBe("−12.3%");
    expect(formatMetric("ma50", 0.021, "en")).toBe("+2.1%");
    expect(formatMetric("vol", 0.2434, "en")).toBe("24.3%");
    expect(formatMetric("pe", 23.61, "en")).toBe("23.6");
    expect(formatMetric("rating", 2.06, "en")).toBe("2.1");
    expect(formatMetric("rsi", 55.4, "en")).toBe("55");
    expect(formatMetric("beta", 1.123, "en")).toBe("1.12");
    expect(formatMetric("volPct", 71.6, "en")).toBe("72");
    expect(formatMetric("exdiv", "2026-11-12T05:00:00.000Z", "en")).toBe("Nov 12");
    expect(formatMetric("exdiv", "2026-11-12T05:00:00.000Z", "zh")).toBe("11月12日");
  });
});

describe("chip labels", () => {
  it("writes bounds in typed units", () => {
    expect(formatBound("yield", 0.03)).toBe("3%");
    expect(formatBound("cap", 1e10)).toBe("$10B");
    expect(formatBound("high", -0.2)).toBe("−20%");
    expect(formatBound("pe", 15)).toBe("15");
    expect(formatBound("price", 25)).toBe("$25");
    expect(formatBound("chg", 2.5)).toBe("2.5%");
  });

  it("describes one-sided and two-sided ranges", () => {
    expect(rangeLabel(en, "pe", { min: null, max: 15 })).toBe("P/E (trailing) ≤ 15");
    expect(rangeLabel(en, "yield", { min: 0.03, max: null })).toBe("Dividend yield ≥ 3%");
    expect(rangeLabel(en, "high", { min: -0.2, max: -0.1 })).toBe("Distance from 52-week high −20% to −10%");
    expect(rangeLabel(zh, "pe", { min: 5, max: 15 })).toBe("市盈率（TTM） 5 至 15");
  });

  it("labels every chip kind", () => {
    expect(chipLabel(en, { id: "sectors", sectors: ["energy", "utilities"] }, sectorLabel)).toBe("Sector: Energy, Utilities");
    expect(chipLabel(en, { id: "sectors", sectors: ["technology", "energy", "utilities"] }, sectorLabel)).toBe("Sector: Information Technology and 2 more");
    expect(chipLabel(en, { id: "ma200", trend: "above" }, sectorLabel)).toBe("Above 200-day average");
    expect(chipLabel(en, { id: "earnings", days: 7 }, sectorLabel)).toBe("Earnings within 7 days");
    expect(chipLabel(en, { id: "list", list: "neither" }, sectorLabel)).toBe("Not in my lists");
    expect(chipLabel(en, { id: "range:volPct", key: "volPct", range: { min: null, max: 20 } }, sectorLabel)).toBe("Percentile of volatility ≤ 20");
  });
});

describe("earningsText", () => {
  it("counts New York days from the snapshot and marks estimates", () => {
    expect(earningsText(en, "2026-11-12T21:00:00Z", false, NOW, "en")).toEqual({ short: "5d", long: "in 5 days", title: "Nov 12" });
    expect(earningsText(en, "2026-11-12T21:00:00Z", true, NOW, "en")).toEqual({ short: "~5d", long: "in 5 days, estimated", title: "Nov 12 (estimated)" });
    expect(earningsText(en, "2026-11-07T21:00:00Z", false, NOW, "en").short).toBe("Today");
    expect(earningsText(zh, "2026-11-12T21:00:00Z", false, NOW, "zh").short).toBe("5天");
  });

  it("shows a dash for unknown or past dates", () => {
    expect(earningsText(en, null, null, NOW, "en")).toEqual({ short: "—", long: null, title: null });
    expect(earningsText(en, "2026-11-01T21:00:00Z", false, NOW, "en").short).toBe("—");
  });
});

describe("formatRelativeVolume", () => {
  it("shows a multiple", () => {
    expect(formatRelativeVolume(2.43, "en")).toBe("2.4x");
    expect(formatRelativeVolume(12.6, "en")).toBe("13x");
    expect(formatRelativeVolume(null, "en")).toBe("—");
  });
});
