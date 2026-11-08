import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { crossLegs, securityOf, TABLE_SECURITIES } from "./securities";

describe("currency pairs outside the table", () => {
  it("are built from the table's dollar rates of their two currencies", () => {
    // BASE/QUOTE is units of QUOTE per BASE: QUOTE per dollar over BASE per dollar. EUR/USD and GBP/USD quote dollars per
    // unit, USD/JPY and Yahoo's HKD=X (USD/HKD) units per dollar.
    expect(crossLegs("HKD", "USD")).toEqual([["HKD=X", -1]]);
    expect(crossLegs("USD", "HKD")).toEqual([["HKD=X", 1]]);
    expect(crossLegs("JPY", "USD")).toEqual([["USDJPY=X", -1]]);
    expect(crossLegs("USD", "EUR")).toEqual([["EURUSD=X", -1]]);
    expect(crossLegs("EUR", "HKD")).toEqual([
      ["HKD=X", 1],
      ["EURUSD=X", 1],
    ]);
    expect(crossLegs("GBP", "EUR")).toEqual([
      ["EURUSD=X", -1],
      ["GBPUSD=X", 1],
    ]);
    // A currency against itself is 1; one the table does not quote has no legs.
    expect(crossLegs("EUR", "EUR")).toEqual([]);
    expect(crossLegs("AUD", "USD")).toBeNull();
    expect(crossLegs("USD", "KRW")).toBeNull();
  });

  it("use only rates the table has", () => {
    const table = new Set(TABLE_SECURITIES.filter((security) => security.type === "CURRENCY").map((security) => security.symbol));
    for (const code of ["USD", "EUR", "GBP", "JPY", "CAD", "SEK", "CHF", "CNY", "HKD"]) {
      for (const [symbol] of crossLegs(code, "USD") ?? []) expect(table, `${code}/USD`).toContain(symbol);
    }
  });

  it("are currency records priced from their legs, under Yahoo's symbols for both directions", () => {
    expect(securityOf("HKDUSD=X")).toMatchObject({ type: "CURRENCY", name: "HKD/USD", currency: "USD", model: "cross", legs: [["HKD=X", -1]], synthetic: true });
    expect(securityOf("USDHKD=X")).toMatchObject({ name: "USD/HKD", currency: "HKD", model: "cross", legs: [["HKD=X", 1]] });
    // Yahoo's short form of a dollar pair: JPY=X is USD/JPY.
    expect(securityOf("JPY=X")).toMatchObject({ name: "USD/JPY", currency: "JPY", model: "cross", legs: [["USDJPY=X", 1]] });
    // The anchor level and the volatility follow from the legs.
    const hkd = securityOf("HKD=X")!;
    expect(securityOf("HKDUSD=X")!.anchorPrice).toBeCloseTo(1 / hkd.anchorPrice, 12);
    expect(securityOf("HKDUSD=X")!.vol).toBeCloseTo(hkd.vol, 12);
    const euro = securityOf("EURUSD=X")!;
    expect(securityOf("EURHKD=X")!.vol).toBeCloseTo(Math.hypot(euro.vol, hkd.vol), 12);
    // The table's own pairs and pairs of other currencies are walks, as before.
    expect(securityOf("HKD=X")).toMatchObject({ model: "walk", legs: null });
    expect(securityOf("AUDUSD=X")).toMatchObject({ type: "CURRENCY", model: "walk", legs: null });
  });
});
