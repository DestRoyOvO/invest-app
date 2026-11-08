import { formatNumber, tpl } from "@/lib/format";
import { WORLD_BOARD, WORLD_REGIONS, type WorldRegion } from "@/lib/universe";
import type { MarketState } from "@/types/api";
import type { TenorKey, WorldMarketsResponse, YieldCurve, YieldCurveResponse } from "@/types/markets";

import { AT_DEFAULT_NOW } from "../support/env";
import { apiJson, en, escapeRegExp, localTradeTime, panel, signedChange, signedPercent } from "../support/shell";
import { expect, test, type Page } from "../support/test";

// World markets (/markets, WEI and GC): every region of the world board with its instruments, each with its price and
// change, its session and the time of its last trade on the exchange's own clock, which follow the pinned clock; and the
// Treasury curve, whose spreads must be the differences of the curve points the panel plots. Expectations come from the
// app's own /api/markets/world and /api/rates/curve answers.

const esc = escapeRegExp;
const EQUITY_REGIONS: readonly WorldRegion[] = ["americas", "europe", "asia"];

/** Yahoo's market state as the session word of the board. */
function sessionWord(state: MarketState | null): string {
  const kind = state === "REGULAR" ? "open" : state === "PRE" || state === "PREPRE" ? "pre" : state === "POST" || state === "POSTPOST" ? "post" : state === "CLOSED" ? "closed" : "unknown";
  return en.markets.session[kind];
}

async function checkRegions(page: Page, phone: boolean): Promise<void> {
  const world = await apiJson<WorldMarketsResponse>(page.request, "/api/markets/world");
  const now = Date.parse(world.asOf);
  expect(world.missing, "instruments without a quote").toEqual([]);
  const worldPanel = panel(page, en.markets.world);
  /** A row as it reads on screen (hidden columns left out), its cells in order. */
  const row = (...cells: string[]) => new RegExp(`^${cells.map(esc).join("\\s*")}\\s*$`);

  for (const region of WORLD_REGIONS) {
    const equity = EQUITY_REGIONS.includes(region);
    const expected = WORLD_BOARD.filter((def) => def.region === region).map((def) => {
      const quote = world.rows.find((entry) => entry.symbol === def.symbol);
      if (!quote?.time) throw new Error(`No quote with a trade time for ${def.symbol}`);
      const session = sessionWord(quote.marketState);
      const time = localTradeTime(quote.time, def.timeZone, now);
      if (AT_DEFAULT_NOW) {
        // Saturday: every exchange closed after Friday's session, crypto trading (its last daily bar closed at midnight UTC).
        expect(quote.marketState, `${def.symbol} on the pinned Saturday`).toBe(region === "crypto" ? "REGULAR" : "CLOSED");
        expect(time, `${def.symbol}'s last trade on its own clock`).toMatch(region === "crypto" ? /^\d{2}:\d{2}$/ : /^Fri \d{2}:\d{2}$/);
      }
      const name = [def.code, def.label.en];
      const when = [session, time, tpl(en.markets.localTimeOf, { place: def.place.en })];
      const price = formatNumber(quote.price, def.digits, "en");
      const change = signedPercent(quote.changePercent);
      // The narrow panels put the session and the local time under the name, on every screen; the wide table of the
      // equity regions has columns for them and for the absolute change, which phones leave out.
      if (!equity) return row(...name, ...when, price, change);
      return phone ? row(...name, price, change) : row(...name, ...when, price, signedChange(quote.change), change);
    });
    // The equity regions are sections of the world panel; currencies, commodities and crypto are panels of their own.
    const table = panel(equity ? worldPanel : page, en.markets.regions[region]).getByRole("table");
    await expect(table.getByRole("row").filter({ has: page.getByRole("cell") }), `the ${region} rows`).toHaveText(expected, { useInnerText: true });
  }
}

async function checkTreasurySpreads(page: Page): Promise<void> {
  const curve = await apiJson<YieldCurveResponse>(page.request, "/api/rates/curve");
  const yieldAt = (line: YieldCurve | null, tenor: TenorKey): number => {
    const value = line?.yields[curve.tenors.indexOf(tenor)];
    if (typeof value !== "number") throw new Error(`No ${tenor} yield on the curve of ${line?.date ?? "a missing date"}`);
    return value;
  };
  const rates = panel(page, en.markets.rates.title);

  // The points: the chart's table for screen readers lists every tenor's yield, latest and a month ago.
  const points = rates.getByRole("table").filter({ has: page.getByRole("rowheader") });
  for (const tenor of ["3M", "2Y", "10Y"] as const) {
    const latest = `${yieldAt(curve.current, tenor).toFixed(2)}%`;
    const monthAgo = `${yieldAt(curve.monthAgo, tenor).toFixed(2)}%`;
    await expect(points.getByRole("row", { name: new RegExp(`^${tenor} ${esc(latest)} ${esc(monthAgo)}(?: |$)`) })).toHaveCount(1);
  }

  // Each spread in basis points, then its change from the curve a month ago: "+71 bp", "−8 bp vs 1M ago".
  const bp = (value: number) => tpl(en.markets.rates.bp, { n: value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0" });
  const spreads = (["2s10s", "3m10y"] as const).map((key) => {
    const short: TenorKey = key === "2s10s" ? "2Y" : "3M";
    const latest = (yieldAt(curve.current, "10Y") - yieldAt(curve.current, short)) * 100;
    const monthAgo = (yieldAt(curve.monthAgo, "10Y") - yieldAt(curve.monthAgo, short)) * 100;
    return `${esc(en.markets.rates.spread[key])}[\\s\\S]*?${esc(bp(Math.round(latest)))}[\\s\\S]*?${esc(tpl(en.markets.rates.vsMonthAgo, { n: bp(Math.round(latest - monthAgo)) }))}`;
  });
  await expect(rates.getByRole("region", { name: en.markets.rates.spreads })).toHaveText(new RegExp(spreads.join("[\\s\\S]*?")));
}

test("every region lists its instruments on the pinned clock, and the Treasury spreads are the differences of the plotted points", async ({ page, app }) => {
  await app.goto("/markets");
  await checkRegions(page, app.isPhone);
  await checkTreasurySpreads(page);
});
