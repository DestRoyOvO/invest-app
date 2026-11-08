import { describe, expect, it } from "vitest";

import { COLUMN_SET_KEYS, columnsFor, PHONE_COLUMNS, UNIVERSES } from "@/lib/screens";

import { fitColumns, SCROLLBAR_REM, tableMinWidthRem } from "./widths";

const PX = 16;

describe("table widths", () => {
  it("adds the checkbox, the star and the name's minimum to the column widths", () => {
    expect(tableMinWidthRem(columnsFor({ universe: "stocks", columns: "overview" }))).toBe(50.75);
    expect(tableMinWidthRem(columnsFor({ universe: "etfs", columns: "overview" }))).toBe(61.5);
  });
});

describe("fitColumns", () => {
  const overview = columnsFor({ universe: "stocks", columns: "overview" });
  const etfOverview = columnsFor({ universe: "etfs", columns: "overview" });

  it("keeps the whole set before the table is measured or when it fits", () => {
    expect(fitColumns(overview, "stocks", "overview", null)).toBe(overview);
    expect(fitColumns(overview, "stocks", "overview", 80)).toEqual(overview);
    expect(fitColumns(overview, "stocks", "overview", 50.75 + SCROLLBAR_REM)).toEqual(overview);
  });

  it("drops the lower-priority columns first on a laptop with the rail open", () => {
    // 1024px wide: the 56px nav and the 240px rail leave a 724px table.
    expect(fitColumns(overview, "stocks", "overview", 724 / PX)).toEqual(["symbol", "name", "price", "chg", "cap", "earnings"]);
    // 1280px: the 192px nav and the rail leave 844px; the ETF overview gives up 1M and 6M, not Vol and Beta.
    expect(fitColumns(etfOverview, "etfs", "overview", 844 / PX)).toEqual(["symbol", "name", "price", "assets", "er", "ytd", "r3m", "vol", "beta"]);
    expect(fitColumns(columnsFor({ universe: "stocks", columns: "momentum" }), "stocks", "momentum", 844 / PX)).not.toContain("ma50");
  });

  it("fits every set into the table whenever its phone columns fit", () => {
    for (const universe of UNIVERSES) {
      for (const set of COLUMN_SET_KEYS) {
        const keys = columnsFor({ universe, columns: set });
        const minimal = ["symbol", "name", ...PHONE_COLUMNS[universe][set]];
        for (let px = 600; px <= 1300; px += 20) {
          const fitted = fitColumns(keys, universe, set, px / PX);
          for (const key of minimal) expect(fitted, `${universe}/${set} at ${px}px`).toContain(key);
          if (tableMinWidthRem(minimal as never) <= px / PX - SCROLLBAR_REM) {
            expect(tableMinWidthRem(fitted), `${universe}/${set} at ${px}px`).toBeLessThanOrEqual(px / PX - SCROLLBAR_REM);
          }
          // Columns keep the set's order.
          expect(fitted, `${universe}/${set} at ${px}px`).toEqual(keys.filter((key) => fitted.includes(key)));
        }
      }
    }
  });

  it("never drops below the symbol, the name and the phone columns", () => {
    expect(fitColumns(overview, "stocks", "overview", 10)).toEqual(["symbol", "name", "price", "chg"]);
    expect(fitColumns(etfOverview, "etfs", "overview", 10)).toEqual(["symbol", "name", "price", "ytd"]);
  });
});
