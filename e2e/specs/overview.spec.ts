import { formatNumber, formatPrice, formatShortDate, tpl } from "@/lib/format";
import { getSector, MARKET_BOARD, UNIVERSE_STOCKS } from "@/lib/universe";
import type { BreadthTally, DiscoverResponse, MarketOverview, Quote, QuotesResponse } from "@/types/api";
import type { BoardResponse } from "@/types/shell";

import { AT_DEFAULT_NOW } from "../support/env";
import {
  apiJson,
  dayIn,
  daysBetween,
  en,
  escapeRegExp,
  expectPage,
  money,
  NEW_YORK,
  panel,
  serverNow,
  sessionsAfter,
  SHELL_DATA,
  signedChange,
  signedPercent,
  signedRatio,
  stockPath,
  weekdayOf,
} from "../support/shell";
import { expect, test, type Page } from "../support/test";

// The overview (/, MKT) as a returning investor sees it: My day computed from the quotes the page itself loads, the week
// ahead from the fixture data's fixed event dates, the markets board, the breadth strip, the movers in both scopes, and
// the sector heatmap (a keyboard-driven treemap on the desktop, an expandable sector list on phones). Every figure is
// computed here from the app's own API answers and formatted the way the app formats it.

const esc = escapeRegExp;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

interface Position {
  symbol: string;
  shares: number;
  value: number;
  cost: number;
  dayPnl: number;
  quote: Quote;
}

/** The seeded positions valued at the quotes of the page's own quote request (watchlist and holdings, sorted). */
async function valuedPositions(page: Page): Promise<Position[]> {
  const symbols = [...new Set([...SHELL_DATA.watchlist, ...Object.keys(SHELL_DATA.holdings)])].sort();
  const { quotes } = await apiJson<QuotesResponse>(page.request, `/api/quotes?symbols=${symbols.join(",")}`);
  return Object.entries(SHELL_DATA.holdings).map(([symbol, { shares, cost }]) => {
    const quote = quotes.find((q) => q.symbol === symbol);
    if (!quote || quote.price === null || quote.change === null) throw new Error(`No quote with a price and a change for ${symbol}`);
    return { symbol, shares, value: shares * quote.price, cost: shares * cost, dayPnl: shares * quote.change, quote };
  });
}

/** "62 of 78" as a share: 79%. */
function share(tally: BreadthTally): string {
  return `${Math.round((tally.count / tally.of) * 100)}%`;
}

test("My day values the positions at the page's quotes, beside the week ahead, the markets board and breadth", async ({ page, app }) => {
  await app.seedStorage(SHELL_DATA);
  await app.goto("/");
  const [positions, now, board, overview] = await Promise.all([
    valuedPositions(page),
    serverNow(page.request),
    apiJson<BoardResponse>(page.request, "/api/market/board"),
    apiJson<MarketOverview>(page.request, "/api/market/overview"),
  ]);
  expect(new Set(positions.map((p) => p.quote.currency)), "every position is quoted in dollars, so all count in the totals").toEqual(new Set(["USD"]));

  // --- My day: value, the day's P&L, unrealized P&L, extended hours, the largest movers and the next report ---
  const myDay = panel(page, en.port.myDay.title);
  const value = sum(positions.map((p) => p.value));
  const cost = sum(positions.map((p) => p.cost));
  const dayPnl = sum(positions.map((p) => p.dayPnl));
  await expect(myDay).toContainText(
    new RegExp(`${esc(tpl(en.watchlist.value, { currency: "USD" }))}\\s*${esc(formatNumber(value, 2, "en"))}\\s*${esc(tpl(en.watchlist.positionsCount, { n: positions.length }))}`),
  );

  // The day's change is the P&L over the value at the previous close (value-weighted). The seed moved enough that the same
  // P&L over today's value would show differently.
  if (AT_DEFAULT_NOW) expect(signedRatio(dayPnl / (value - dayPnl)), "the day's change over the previous close and over today's value").not.toBe(signedRatio(dayPnl / value));

  // While the market has not traded today (the pinned Saturday), the day figure covers the last session and names it.
  const today = dayIn(now, NEW_YORK);
  const session = positions.map((p) => dayIn(Date.parse(p.quote.regularMarketTime ?? ""), NEW_YORK)).sort().at(-1) ?? "";
  const earlier = session < today;
  if (AT_DEFAULT_NOW) expect(earlier, "on the pinned Saturday the day figure is Friday's").toBe(true);
  const sessionName = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(Date.parse(`${session}T00:00:00Z`));
  await expect(myDay).toContainText(
    new RegExp(
      `${esc(earlier ? en.watchlist.lastSession : en.watchlist.today)}\\s*${esc(money(dayPnl))}\\s*${esc(signedRatio(dayPnl / (value - dayPnl)))}${earlier ? `\\s*${esc(sessionName)}` : ""}`,
    ),
  );
  await expect(myDay).toContainText(
    new RegExp(`${esc(en.watchlist.unrealized)}\\s*${esc(money(value - cost))}\\s*${esc(signedRatio((value - cost) / cost, 1))}\\s*${esc(`${en.watchlist.costBasis} ${formatNumber(cost, 2, "en")}`)}`),
  );

  // Extended hours stay apart from the day figure: Friday's after-hours trade shows on the pinned Saturday.
  const extended = positions.filter((p) => p.quote.extendedSession !== null && p.quote.extendedChange !== null);
  if (AT_DEFAULT_NOW) expect(extended.map((p) => p.quote.extendedSession), "after-hours quotes on the pinned Saturday").toEqual(positions.map(() => "POST"));
  if (extended.length > 0) {
    const sessions = new Set(extended.map((p) => p.quote.extendedSession));
    const label = sessions.size > 1 ? en.watchlist.extendedPnl : sessions.has("PRE") ? en.watchlist.preMarketPnl : en.watchlist.afterHoursPnl;
    const pnl = sum(extended.map((p) => p.shares * (p.quote.extendedChange ?? 0)));
    await expect(myDay).toContainText(
      new RegExp(
        `${esc(label)}\\s*${esc(money(pnl))}\\s*${esc(signedRatio(pnl / sum(extended.map((p) => p.value))))}\\s*${esc(earlier ? en.watchlist.notInLastSession : en.watchlist.notInToday)}`,
      ),
    );
  }

  // The three largest gains and losses in money, largest first, each with the stock's change.
  const gainers = positions.filter((p) => p.dayPnl > 0).sort((a, b) => b.dayPnl - a.dayPnl);
  const losers = positions.filter((p) => p.dayPnl < 0).sort((a, b) => a.dayPnl - b.dayPnl);
  // The seed has more of both than the panel lists (four each at the default E2E_NOW), so the cut is checked too.
  if (AT_DEFAULT_NOW) expect(Math.min(gainers.length, losers.length), "positions that rose and fell, of the seed").toBeGreaterThan(3);
  const moverRows = (title: string) => myDay.getByRole("list", { name: title, exact: true }).getByRole("listitem");
  const moverText = (p: Position) => new RegExp(`^${esc(p.symbol)}\\s*${esc(money(p.dayPnl))}\\s*${esc(signedPercent(p.quote.changePercent))}$`);
  await expect(moverRows(en.port.myDay.contributors)).toHaveText(gainers.slice(0, 3).map(moverText));
  await expect(moverRows(en.port.myDay.detractors)).toHaveText(losers.slice(0, 3).map(moverText));

  // The next report among the holdings, from today on.
  const next = positions
    .flatMap((p) => {
      const iso = p.quote.nextEarningsDate;
      const days = iso ? daysBetween(today, dayIn(Date.parse(iso), NEW_YORK)) : -1;
      return iso && days >= 0 ? [{ symbol: p.symbol, iso, days, estimated: p.quote.earningsDateEstimated === true }] : [];
    })
    .sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso))[0];
  if (next) {
    const when = next.days === 0 ? en.port.myDay.today2 : next.days === 1 ? en.port.myDay.tomorrow : tpl(en.port.myDay.inDays, { n: next.days });
    const date = formatShortDate(next.iso, "en", NEW_YORK);
    await expect(myDay).toContainText(`${tpl(en.port.myDay.nextEarnings, { symbol: next.symbol, date })} · ${when}${next.estimated ? ` · ${en.watchlist.est}` : ""}`);
  } else {
    await expect(myDay).toContainText(en.port.myDay.noEarnings);
  }

  // --- The week ahead: the watchlist's fixed event dates, counted in sessions after the latest one ---
  if (AT_DEFAULT_NOW) {
    const week = panel(page, en.calendar.weekAhead);
    const rows = week.getByRole("listitem");
    const row = (symbol: string, day: string) =>
      rows.filter({ has: page.getByRole("link", { name: symbol, exact: true }) }).filter({ hasText: new RegExp(`^${esc(weekdayOf(day))}`) });
    const nvdaReport = sessionsAfter(session, 2);
    const aaplExDividend = sessionsAfter(session, 3);
    const msftReport = sessionsAfter(session, 4);
    await expect(row("NVDA", nvdaReport)).toHaveCount(1);
    await expect(row("NVDA", nvdaReport)).not.toContainText(en.calendar.exDate);
    await expect(row("AAPL", aaplExDividend)).toContainText(en.calendar.exDate);
    await expect(row("MSFT", msftReport)).toHaveCount(1);
    await expect(row("MSFT", msftReport)).not.toContainText(en.calendar.exDate);
    // AAPL's report (six sessions ahead), GOOGL's (eight) and AMZN's (nine) fall after the week, which ends on Sunday.
    await expect(rows.filter({ has: page.getByRole("link", { name: "AAPL", exact: true }) })).toHaveCount(1);
    await expect(rows.filter({ has: page.getByRole("link", { name: "GOOGL", exact: true }) })).toHaveCount(0);
    await expect(rows.filter({ has: page.getByRole("link", { name: "AMZN", exact: true }) })).toHaveCount(0);
    // In time order.
    const texts = await rows.allTextContents();
    const at = (symbol: string, day: string) => texts.findIndex((text) => text.startsWith(weekdayOf(day)) && text.includes(symbol));
    expect(at("NVDA", nvdaReport)).toBeLessThan(at("AAPL", aaplExDividend));
    expect(at("AAPL", aaplExDividend)).toBeLessThan(at("MSFT", msftReport));
  }

  // --- The markets board: every instrument, each a link to its quote with its price and change ---
  const cells = MARKET_BOARD.map((def) => {
    const quote = board.board.find((item) => item.quote.symbol === def.symbol)?.quote;
    if (!quote) throw new Error(`No board quote for ${def.symbol}`);
    const price = def.kind === "yield" ? `${formatNumber(quote.price, 3, "en")}%` : formatPrice(quote.price, "en");
    // The absolute change and the "1M" tag beside the sparkline show only where the cell is wide enough (each cell is a
    // size container, and the desktop's cells are within a pixel of the tag's width).
    return new RegExp(
      `^${esc(def.label.en)}\\s*${esc(def.code)}\\s*${esc(price)}\\s*(?:${esc(signedChange(quote.change))}\\s*)?${esc(signedPercent(quote.changePercent))}\\s*(?:${esc(en.columns.trend)}\\s*)?$`,
    );
  });
  const boardLinks = panel(page, en.market.board).getByRole("link").filter({ hasNotText: en.markets.worldLink });
  await expect(boardLinks).toHaveText(cells, { useInnerText: true });
  expect(await boardLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(MARKET_BOARD.map((def) => stockPath(def.symbol)));

  // --- Breadth over the heatmap's stocks ---
  const breadth = overview.breadth;
  expect(breadth?.stocks, "every universe stock has a quote").toBe(UNIVERSE_STOCKS.length);
  if (!breadth) return;
  const strip = panel(page, tpl(en.markets.breadth.title, { n: UNIVERSE_STOCKS.length }));
  const ofStocks = (tally: BreadthTally) => tpl(en.markets.breadth.ofStocks, { count: tally.count, of: tally.of });
  await expect(strip).toContainText(new RegExp(`${esc(en.markets.breadth.above50)}\\s*${esc(share(breadth.above50d))}\\s*${esc(ofStocks(breadth.above50d))}`));
  await expect(strip).toContainText(new RegExp(`${esc(en.markets.breadth.above200)}\\s*${esc(share(breadth.above200d))}\\s*${esc(ofStocks(breadth.above200d))}`));
  await expect(strip).toContainText(new RegExp(`${esc(en.markets.breadth.advDec)}\\s*${breadth.advancers} / ${breadth.decliners}`));
  await expect(strip).toContainText(new RegExp(`${esc(en.markets.breadth.highsLows)}\\s*${breadth.nearHigh.count} / ${breadth.nearLow.count}`));
  if (breadth.equalWeight !== null && breadth.capWeight !== null) {
    const gap = tpl(en.markets.breadth.points, { value: signedChange(breadth.equalWeight - breadth.capWeight) });
    await expect(strip).toContainText(new RegExp(`${esc(en.markets.breadth.equalVsCap)}\\s*${esc(gap)}`));
  }
});

test("the movers switch between the US market and the large caps, and the choice survives a reload", async ({ page, app }) => {
  await app.goto("/");
  const [usGainers, usLosers, overview] = await Promise.all([
    apiJson<DiscoverResponse>(page.request, "/api/discover?screen=day_gainers"),
    apiJson<DiscoverResponse>(page.request, "/api/discover?screen=day_losers"),
    apiJson<MarketOverview>(page.request, "/api/market/overview"),
  ]);
  // Eight rows, the first of each list.
  const top = (quotes: ReadonlyArray<{ symbol: string }>) => quotes.slice(0, 8).map((quote) => quote.symbol);
  expect(top(usGainers.quotes), "the two scopes list different stocks").not.toEqual(top(overview.movers.gainers));
  const large = tpl(en.markets.movers.universe, { n: UNIVERSE_STOCKS.length });
  const symbols = (title: string) => panel(page, title).getByRole("table").getByRole("link");

  // The whole US market by default (Yahoo's screens, quality-filtered on the server): gainers, then losers.
  const usPanel = panel(page, en.markets.movers.titleUs);
  const usScope = usPanel.getByRole("radiogroup", { name: en.markets.movers.scope });
  await expect(usScope.getByRole("radio", { name: en.markets.movers.us })).toHaveAttribute("aria-checked", "true");
  await expect(usPanel.getByRole("tab", { name: en.market.gainers })).toHaveAttribute("aria-selected", "true");
  await expect(symbols(en.markets.movers.titleUs)).toHaveText(top(usGainers.quotes));
  await usPanel.getByRole("tab", { name: en.market.losers }).click();
  await expect(symbols(en.markets.movers.titleUs)).toHaveText(top(usLosers.quotes));

  // The large caps behind the heatmap, on the same list.
  const largeTitle = tpl(en.markets.movers.titleUniverse, { n: UNIVERSE_STOCKS.length });
  await usScope.getByRole("radio", { name: large }).click();
  await expect(panel(page, largeTitle).getByRole("tab", { name: en.market.losers })).toHaveAttribute("aria-selected", "true");
  await expect(symbols(largeTitle)).toHaveText(top(overview.movers.losers));

  // The browser keeps the scope; the list starts from the gainers again.
  await page.reload();
  await expect(panel(page, largeTitle).getByRole("radiogroup", { name: en.markets.movers.scope }).getByRole("radio", { name: large })).toHaveAttribute("aria-checked", "true");
  await expect(panel(page, largeTitle).getByRole("tab", { name: en.market.gainers })).toHaveAttribute("aria-selected", "true");
  await expect(symbols(largeTitle)).toHaveText(top(overview.movers.gainers));
});

/**
 * The desktop treemap: one listbox with a single tab stop, arrow keys that move the active tile (its active descendant,
 * selected), Enter that opens the quote, and a card for the hovered or active tile, which Escape closes.
 */
async function checkTreemap(page: Page, overview: MarketOverview): Promise<void> {
  const heatmap = panel(page, en.market.heatmap);
  const treemap = heatmap.getByRole("listbox", { name: en.markets.heatmap.label });
  const card = page.getByRole("tooltip");

  // Hovering a tile shows its card: the symbol, its sector, price and change.
  const sector = overview.sectors.find((entry) => entry.stocks.some((quote) => quote.symbol === "NVDA"));
  const hovered = sector?.stocks.find((quote) => quote.symbol === "NVDA");
  if (!sector || !hovered) throw new Error("NVDA is missing from the overview");
  const tile = treemap.getByRole("option", { name: `NVDA ${signedPercent(hovered.changePercent)}`, exact: true });
  await tile.hover();
  await expect(card).toBeVisible();
  await expect(card).toContainText("NVDA");
  await expect(card).toContainText(getSector(sector.key)?.short.en ?? sector.key);
  await expect(card).toContainText(formatPrice(hovered.price, "en"));
  await expect(card).toContainText(signedPercent(hovered.changePercent));
  await expect(tile).toHaveAttribute("aria-describedby", (await card.getAttribute("id")) ?? "");
  await page.mouse.move(1, 1);
  await expect(card).toBeHidden();

  // One tab stop: Tab enters the treemap from the panel before it, and the next Tab leaves it.
  await panel(page, tpl(en.markets.breadth.title, { n: UNIVERSE_STOCKS.length })).getByRole("link", { name: en.markets.breadth.details }).focus();
  await page.keyboard.press("Tab");
  await expect(treemap).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(treemap).not.toBeFocused();
  expect(await heatmap.evaluate((element) => element.contains(document.activeElement)), "the focus left the heatmap").toBe(false);
  await page.keyboard.press("Shift+Tab");
  await expect(treemap).toBeFocused();

  // The active tile is the listbox's active descendant and the selected option, and the card follows it.
  const selected = treemap.getByRole("option", { selected: true });
  const active = async () => {
    const id = await treemap.getAttribute("aria-activedescendant");
    expect(id, "an active descendant").toBeTruthy();
    await expect(selected).toHaveAttribute("id", id ?? "");
    return { id: id ?? "", name: (await selected.getAttribute("aria-label")) ?? "" };
  };
  let current = await active();
  for (const key of ["ArrowDown", "ArrowRight"]) {
    await page.keyboard.press(key);
    await expect(treemap).not.toHaveAttribute("aria-activedescendant", current.id);
    current = await active();
    await expect(card).toContainText(current.name.split(" ")[0]);
  }
  // Escape closes only the card: the treemap keeps the focus and its active tile.
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(treemap).toBeFocused();
  await expect(treemap).toHaveAttribute("aria-activedescendant", current.id);
  // A stock tile ("AAPL +0.39%"), not a sector header: Enter opens its quote.
  const symbol = current.name.split(" ")[0];
  expect(UNIVERSE_STOCKS, `the active tile ${current.name} is a stock`).toContain(symbol);
  await page.keyboard.press("Enter");
  await expectPage(page, stockPath(symbol));
}

/** Phones: the sectors best first, each opening to its stocks (largest first) and a link to the sector page. */
async function checkSectorList(page: Page, overview: MarketOverview): Promise<void> {
  const sectors = overview.sectors.filter((sector) => sector.stocks.length > 0).sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
  const label = (key: string) => getSector(key)?.label.en ?? key;
  const heatmap = panel(page, en.market.heatmap);
  const buttons = heatmap.getByRole("button");
  await expect(buttons).toHaveText(sectors.map((sector) => new RegExp(`^${esc(label(sector.key))}\\s*${esc(signedPercent(sector.changePercent))}$`)));

  const best = sectors[0];
  const marketCaps = best.stocks.map((quote) => quote.marketCap ?? 0);
  expect(marketCaps, "the overview lists a sector's stocks largest first").toEqual([...marketCaps].sort((a, b) => b - a));
  await buttons.first().click();
  await expect(buttons.first()).toHaveAttribute("aria-expanded", "true");
  const links = heatmap.getByRole("list", { name: tpl(en.markets.heatmap.constituents, { sector: label(best.key) }) }).getByRole("link");
  await expect(links).toHaveText([
    ...best.stocks.map((quote) => new RegExp(`^${esc(quote.symbol)}.*${esc(formatPrice(quote.price, "en"))}\\s*${esc(signedPercent(quote.changePercent))}$`)),
    tpl(en.markets.heatmap.allStocks, { sector: label(best.key) }),
  ]);
  await expect(links.last()).toHaveAttribute("href", `/sector/${best.key}`);

  const target = best.stocks[1] ?? best.stocks[0];
  await links.nth(best.stocks.indexOf(target)).click();
  await expectPage(page, stockPath(target.symbol));
}

test("the heatmap: a treemap with one tab stop, arrow keys, Enter and hover cards, or on phones a list of sectors that open", async ({ page, app }) => {
  await app.goto("/");
  const overview = await apiJson<MarketOverview>(page.request, "/api/market/overview");
  if (app.isPhone) await checkSectorList(page, overview);
  else await checkTreemap(page, overview);
});
