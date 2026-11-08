import { describe, expect, it } from "vitest";

import { COLUMN_SET_KEYS, columnsFor, PHONE_COLUMNS, UNIVERSES } from "@/lib/screens";

import { fitColumns, SCROLLBAR_REM, tableMinWidthRem } from "./widths";

const PX = 16;

/**
 * The width of the screener table beside the open filter rail on a desktop viewport, from the layout's classes (no
 * shared constants hold them): the nav rail is 4rem wide from md and 13rem from xl (w-16 xl:w-52, NavRail.tsx), the
 * screener has 1px of padding on each side (p-px, ScreenerView.tsx), and the rail column is 15rem with a 1px gap before
 * the results (lg:grid-cols-[15rem_minmax(0,1fr)] and gap-px, ScreenerTab.tsx). 989px at 1440px.
 */
function tableBesideRail(viewport: number): number {
  const nav = viewport >= 1280 ? 208 : 64;
  return viewport - nav - 2 - 240 - 1;
}

describe("table widths", () => {
  it("adds the checkbox, the star and the name's minimum to the column widths", () => {
    expect(tableMinWidthRem(columnsFor({ universe: "stocks", columns: "overview" }))).toBe(50.75);
    expect(tableMinWidthRem(columnsFor({ universe: "etfs", columns: "overview" }))).toBe(61);
  });

  it("measures the table beside the rail from the layout", () => {
    expect(tableBesideRail(1440)).toBe(989);
    expect(tableBesideRail(1280)).toBe(829);
    expect(tableBesideRail(1024)).toBe(717);
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

  it("keeps every set of both universes whole beside the filter rail on a 1440px screen", () => {
    // lib/screens.ts promises it; the ETF overview, the widest set, leaves 1px of the 989px table.
    const widthRem = tableBesideRail(1440) / PX;
    for (const universe of UNIVERSES) {
      for (const set of COLUMN_SET_KEYS) {
        const keys = columnsFor({ universe, columns: set });
        expect(fitColumns(keys, universe, set, widthRem), `${universe}/${set}`).toEqual(keys);
        expect(tableMinWidthRem(keys), `${universe}/${set}`).toBeLessThanOrEqual(widthRem - SCROLLBAR_REM);
      }
    }
  });

  it("drops the lower-priority columns first on a laptop with the rail open", () => {
    // 1024px wide: the 64px nav and the rail leave a 717px table.
    expect(fitColumns(overview, "stocks", "overview", tableBesideRail(1024) / PX)).toEqual(["symbol", "name", "price", "chg", "cap", "earnings"]);
    // 1280px: the 208px nav and the rail leave 829px; the ETF overview gives up 1M, 6M and the net assets, not Vol and Beta.
    expect(fitColumns(etfOverview, "etfs", "overview", tableBesideRail(1280) / PX)).toEqual(["symbol", "name", "price", "er", "ytd", "r3m", "vol", "beta"]);
    expect(fitColumns(columnsFor({ universe: "stocks", columns: "momentum" }), "stocks", "momentum", tableBesideRail(1280) / PX)).not.toContain("ma50");
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
