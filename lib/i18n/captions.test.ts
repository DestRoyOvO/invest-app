import { describe, expect, it } from "vitest";

import { tpl } from "@/lib/format";
import type { Lang } from "@/types/api";

import { MESSAGES } from "./messages";

// A DataTable caption also names the table's scroll box once the table overflows it (a region landmark), so a caption
// must never repeat the name of the panel or section around the table (docs/design-system.md, DataTable): axe reports
// two regions of the same name as landmark-unique.

function pairs(lang: Lang): Array<[where: string, caption: string]> {
  const t = MESSAGES[lang];
  const regions = ["americas", "europe", "asia", "fx", "commodities", "crypto"] as const;
  const lists = [t.market.gainers, t.market.losers, t.market.mostActive];
  return [
    [t.watchlist.title, t.watchlist.quotesCaption],
    [t.market.watchlist, t.watchlist.quotesCaption],
    [t.portfolio.title, t.portfolio.caption],
    [t.watchlist.upcoming, t.watchlist.upcomingCaption],
    [t.notes.title, t.notes.caption],
    [t.sector.constituents, tpl(t.sector.constituentsCaption, { sector: "Energy" })],
    [t.markets.sector.etfReturns, t.markets.sector.etfCaption],
    [t.markets.breadth.bySector, t.markets.breadth.bySectorCaption],
    [t.research.dividends.recent, t.research.dividends.recentCaption],
    [t.research.ownership.trades, t.research.ownership.tradesCaption],
    [t.research.ownership.topInstitutions, t.research.ownership.institutionsCaption],
    [t.alerts.page.rules, t.alerts.page.rulesCaption],
    [t.alerts.page.history, t.alerts.page.historyCaption],
    ...regions.map((region): [string, string] => [t.markets.regions[region], t.markets.regionCaptions[region]]),
    ...lists.map((list): [string, string] => [t.markets.movers.titleUs, tpl(t.markets.movers.captionUs, { list })]),
    ...lists.map((list): [string, string] => [tpl(t.markets.movers.titleUniverse, { n: 78 }), tpl(t.markets.movers.captionUniverse, { list, n: 78 })]),
  ];
}

describe("table captions", () => {
  for (const lang of ["en", "zh"] as const) {
    it(`differ from the panel or section that holds the table (${lang})`, () => {
      const same = pairs(lang).filter(([where, caption]) => where.trim().toLowerCase() === caption.trim().toLowerCase());
      expect(same).toEqual([]);
      for (const [, caption] of pairs(lang)) expect(caption.trim().length).toBeGreaterThan(3);
    });

    it(`name each table of the world markets page apart (${lang})`, () => {
      const t = MESSAGES[lang];
      const names = [
        ...Object.values(t.markets.regions),
        ...Object.values(t.markets.regionCaptions),
        t.markets.world,
        t.markets.breadth.bySector,
        t.markets.breadth.bySectorCaption,
        t.markets.rates.keyTenors,
      ];
      expect(new Set(names).size).toBe(names.length);
    });
  }
});
