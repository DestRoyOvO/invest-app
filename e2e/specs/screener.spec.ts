import { readFileSync } from "node:fs";

import { tpl } from "@/lib/format";
import { MESSAGES } from "@/lib/i18n/messages";
import { COLUMN_SET_KEYS, COLUMN_SETS, ETF_UNIVERSE, PHONE_COLUMNS, PRESETS, type ColumnSetKey, type PresetKey } from "@/lib/screens";
import { getSector, UNIVERSE_STOCKS } from "@/lib/universe";
import type { DiscoverResponse, DiscoverScreen, ScreenerResponse, ScreenerRow, ScreenerUniverse } from "@/types/api";

import { AT_DEFAULT_NOW, BASE_URL } from "../support/env";
import {
  columnTexts,
  expectSymbols,
  getJson,
  newYorkDay,
  newYorkDaysUntil,
  panel,
  parseCompact,
  parseCsv,
  parseShown,
  sortedSymbols,
  stored,
  tableIn,
  visibleHeads,
} from "../support/research";
import { expect, test, type Page } from "../support/test";

// The screener (EQS) over the 78 stocks and the 26 ETFs, and the Discover lists (MOST), on fixture data: filters,
// presets, column sets and sorting change the table as they say (the expected rows come from the snapshot the page
// reads, /api/screener, with the filter rules written out here), a copied link reopens the same screen, the CSV holds
// the rows on screen, saved screens and the watch star keep their data in this browser, and every Discover list clears
// the market-cap floor it states.

const S = MESSAGES.en.screener;
const SCREENS_KEY = "investseek:screens:v1";
const WATCHLIST_KEY = "investseek:watchlist:v1";

/** The snapshot the screener reads, with its rows in the snapshot's own order. */
async function stocksSnapshot(request: Parameters<typeof getJson>[0]): Promise<ScreenerResponse> {
  const snapshot = await getJson<ScreenerResponse>(request, "/api/screener?universe=stocks");
  expect(snapshot.rows.map((row) => row.symbol).sort(), "the stocks of the snapshot").toEqual([...UNIVERSE_STOCKS].sort());
  return snapshot;
}

/** The Results panel and its table. */
function results(page: Page) {
  const region = panel(page, S.results);
  return { region, table: tableIn(region), chips: region.getByRole("button", { name: /^Remove filter: / }) };
}

type Results = ReturnType<typeof results>;

/** The snapshot's stocks largest first, the screener's default order. */
function byCap(rows: readonly ScreenerRow[]): string[] {
  return sortedSymbols(rows, "cap", "desc");
}

/**
 * What each preset says it keeps (its button title), as a rule over the snapshot's raw values, the filters it shows
 * as chips, and whether it applies to funds (which have no P/E, analyst rating or report date). The column set and the
 * order a preset picks are its definition in lib/screens.ts.
 */
const PRESETS_SAY: ReadonlyArray<{ key: PresetKey; hint: string; chips: string[]; funds: boolean; keeps: (row: ScreenerRow, now: number) => boolean }> = [
  {
    key: "nearHigh",
    hint: "Within 3% of the 52-week high",
    chips: ["Distance from 52-week high ≥ −3%"],
    funds: true,
    keeps: (row) => row.fromHigh52 !== null && row.fromHigh52 >= -0.03,
  },
  {
    key: "dividendValue",
    hint: "Dividend yield 3% or more and P/E 15 or less",
    chips: ["P/E (trailing) ≤ 15", "Dividend yield ≥ 3%"],
    funds: false,
    keeps: (row) => row.dividendYield !== null && row.dividendYield >= 0.03 && row.trailingPE !== null && row.trailingPE <= 15,
  },
  {
    key: "earningsWeek",
    hint: "Next report within 7 days of the snapshot",
    chips: ["Earnings within 7 days"],
    funds: false,
    keeps: (row, now) => {
      const days = newYorkDaysUntil(row.nextEarningsDate, now);
      return days !== null && days >= 0 && days <= 7;
    },
  },
  {
    key: "lowVol",
    hint: "Volatility percentile 20 or less in this universe",
    chips: ["Percentile of volatility ≤ 20"],
    funds: true,
    keeps: (row) => row.percentiles.volatility !== null && row.percentiles.volatility <= 20,
  },
  { key: "above200", hint: "Price above its 200-day average", chips: ["Above 200-day average"], funds: true, keeps: (row) => row.vs200d !== null && row.vs200d > 0 },
  {
    key: "pullback",
    hint: "10 to 20% below the 52-week high",
    chips: ["Distance from 52-week high −20% to −10%"],
    funds: true,
    keeps: (row) => row.fromHigh52 !== null && row.fromHigh52 >= -0.2 && row.fromHigh52 <= -0.1,
  },
  {
    key: "analystBuy",
    hint: "Mean analyst rating 2 or better (1 strong buy, 5 sell)",
    chips: ["Analyst rating (1 strong buy, 5 sell) ≤ 2"],
    funds: false,
    keeps: (row) => row.analystRating !== null && row.analystRating <= 2,
  },
];

/** aria-sort of a sorted column. */
function ariaSort(direction: "asc" | "desc"): string {
  return direction === "asc" ? "ascending" : "descending";
}

/** The preset buttons on screen, by label and by the hint in their title. */
async function expectPresetButtons(view: Results, said: ReadonlyArray<(typeof PRESETS_SAY)[number]>): Promise<void> {
  const buttons = view.region.getByRole("list", { name: S.presets.label }).getByRole("button");
  await expect(buttons).toHaveText(said.map((entry) => S.presets[entry.key]));
  expect(await buttons.evaluateAll((elements) => elements.map((element) => element.getAttribute("title")))).toEqual(said.map((entry) => entry.hint));
}

/**
 * Presses a preset and checks what it does: it alone is pressed, its filters show as chips, its column set and sort are
 * picked, and the table holds the rows its rule keeps (from `rows`, the snapshot of `universe` on screen), in its order,
 * or says that none match. At the default E2E_NOW every preset keeps some rows; on another day one can keep none.
 */
async function checkPreset(view: Results, universe: ScreenerUniverse, said: (typeof PRESETS_SAY)[number], rows: readonly ScreenerRow[], now: number): Promise<void> {
  const preset = PRESETS.find((entry) => entry.key === said.key)!;
  const presets = view.region.getByRole("list", { name: S.presets.label });
  await presets.getByRole("button", { name: S.presets[said.key], exact: true }).click();
  await expect(presets.getByRole("button", { pressed: true })).toHaveText([S.presets[said.key]]);
  await expect(view.chips).toHaveText(said.chips);
  await expect(view.region.getByRole("tablist", { name: S.columnSets.label }).getByRole("tab", { name: S.columnSets[preset.columns], exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(view.table.getByRole("columnheader", { name: S.metrics[preset.sort.key as keyof typeof S.metrics], exact: true })).toHaveAttribute("aria-sort", ariaSort(preset.sort.direction));
  const kept = rows.filter((row) => said.keeps(row, now));
  if (AT_DEFAULT_NOW) expect(kept.length, `rows the ${said.key} preset keeps`).toBeGreaterThan(0);
  await expect(view.table).toHaveAccessibleName(tpl(S.caption, { n: kept.length, kind: S.kinds[universe] }));
  await expectSymbols(view.table, sortedSymbols(kept, preset.sort.key, preset.sort.direction));
  if (kept.length === 0) await expect(view.table.getByText(tpl(S.empty.noMatch, { kind: S.kindNouns[universe] }))).toBeVisible();
}

/**
 * Opens each column set and checks the heads on screen: the select-all box (for `rows` results), the set's columns of
 * the universe (all of them on a desktop table with room for them; a phone keeps the symbol and the set's two phone
 * columns) and the watch star. The heads are read in one page call per set.
 */
async function checkColumnSets(view: Results, universe: ScreenerUniverse, rows: number, phone: boolean): Promise<void> {
  const columnSets = view.region.getByRole("tablist", { name: S.columnSets.label });
  for (const set of COLUMN_SET_KEYS) {
    const tab = columnSets.getByRole("tab", { name: S.columnSets[set], exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => visibleHeads(view.table), { message: `the heads of the ${universe} ${set} set` }).toEqual(columnHeads(universe, set, rows, phone));
  }
}

/** The column heads of a set, as checkColumnSets expects them. */
function columnHeads(universe: ScreenerUniverse, set: ColumnSetKey, rows: number, phone: boolean): string[] {
  const metrics = COLUMN_SETS[universe][set].filter((key) => !phone || key === "symbol" || PHONE_COLUMNS[universe][set].includes(key));
  return [tpl(S.selection.selectAll, { n: rows }), ...metrics.map((key) => S.metrics[key]), S.star.column];
}

/** Console errors of a page the suite's collector does not watch (a second page). */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} (${message.location().url})`);
  });
  page.on("pageerror", (error) => errors.push(`Uncaught ${error.name}: ${error.message}`));
  return errors;
}

test.describe("screener", () => {
  test("filters narrow the results to the rows that pass all of them", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The filter rail is the desktop layout; the phone's filter sheet has a test of its own.");
    await app.goto("/screener");
    const { rows } = await stocksSnapshot(request);
    const { region, table, chips } = results(page);
    await expectSymbols(table, byCap(rows));
    const rail = panel(page, S.filters.title);

    const expectMatches = async (matches: ScreenerRow[]) => {
      await expectSymbols(table, byCap(matches));
      await expect(region.getByText(tpl(S.count, { n: matches.length, total: rows.length }), { exact: true })).toBeVisible();
      await expect(table).toHaveAccessibleName(tpl(S.caption, { n: matches.length, kind: S.kinds.stocks }));
    };

    // A sector: only its stocks, each showing the sector's short name.
    const technology = getSector("technology")!;
    await rail.getByRole("checkbox", { name: technology.label.en }).check();
    let matches = rows.filter((row) => row.sector === "technology");
    await expectMatches(matches);
    expect(await columnTexts(table, S.metrics.sector)).toEqual(matches.map(() => technology.short.en));

    // A P/E of at most 40 (typed in the Size and value group): every P/E on screen is 40 or less.
    await rail.getByText(S.filters.groups.size, { exact: true }).click();
    await rail.getByRole("textbox", { name: tpl(S.filters.maxLabel, { metric: S.metricNames.pe }) }).fill("40");
    matches = matches.filter((row) => row.trailingPE !== null && row.trailingPE <= 40);
    await expectMatches(matches);
    // And a market cap of at least $200B.
    await rail.getByRole("textbox", { name: tpl(S.filters.minLabel, { metric: S.metricNames.cap }) }).fill("200");
    matches = matches.filter((row) => row.marketCap !== null && row.marketCap >= 200e9);
    await expectMatches(matches);
    expect(matches.length, "stocks left by the three filters").toBeGreaterThan(0);
    for (const text of await columnTexts(table, S.metrics.pe)) expect(parseShown(text)).toBeLessThanOrEqual(40);
    for (const text of await columnTexts(table, S.metrics.cap)) expect(parseCompact(text)).toBeGreaterThanOrEqual(200e9);
    await expect(chips).toHaveText(["Sector: Information Technology", "Market cap ≥ $200B", "P/E (trailing) ≤ 40"]);
    await expect(page).toHaveURL(/[?&]sector=technology(&|$)/);

    // Removing a chip drops that filter alone; Clear all drops the rest.
    await region.getByRole("button", { name: "Remove filter: Sector: Information Technology" }).click();
    await expectMatches(rows.filter((row) => row.trailingPE !== null && row.trailingPE <= 40 && row.marketCap !== null && row.marketCap >= 200e9));
    await region.getByRole("button", { name: S.filters.clear, exact: true }).click();
    await expectMatches(rows);
    await expect(chips).toHaveCount(0);
  });

  test("each preset keeps the stocks its hint describes, with its columns and order", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The presets are the same on phones, where the sort column can be off screen; one project is enough.");
    await app.goto("/screener");
    const snapshot = await stocksSnapshot(request);
    const now = Date.parse(snapshot.asOf);
    const view = results(page);
    const presets = view.region.getByRole("list", { name: S.presets.label });
    // Every stock preset, each titled with the hint its rule encodes.
    await expectPresetButtons(view, PRESETS_SAY);
    for (const said of PRESETS_SAY) await checkPreset(view, "stocks", said, snapshot.rows, now);

    // Pressing the active preset again clears its filters.
    await presets.getByRole("button", { name: S.presets[PRESETS_SAY.at(-1)!.key], exact: true }).click();
    await expect(presets.getByRole("button", { pressed: true })).toHaveCount(0);
    await expect(view.chips).toHaveCount(0);
    await expect(view.table).toHaveAccessibleName(tpl(S.caption, { n: snapshot.rows.length, kind: S.kinds.stocks }));
  });

  test("each column set shows its columns", async ({ page, app }) => {
    await app.goto("/screener");
    const view = results(page);
    await expect(view.table.getByRole("link", { name: "NVDA", exact: true })).toBeVisible();
    // A 1440px screen fits every stock set beside the filter rail.
    await checkColumnSets(view, "stocks", UNIVERSE_STOCKS.length, app.isPhone);
    // The address keeps the set on screen.
    await expect(page).toHaveURL(new RegExp(`[?&]cols=${COLUMN_SET_KEYS.at(-1)}(&|$)`));
  });

  test("the ETF universe lists the funds by net assets, with the presets that apply to funds", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The universe switch and the presets work the same on phones; one project is enough.");
    await app.goto("/screener");
    const view = results(page);
    await expect(view.table.getByRole("link", { name: "NVDA", exact: true })).toBeVisible();
    const funds = await getJson<ScreenerResponse>(request, "/api/screener?universe=etfs");
    expect(funds.rows.map((row) => row.symbol).sort(), "the funds of the snapshot").toEqual([...ETF_UNIVERSE].sort());

    // The switch shows the funds, largest first by net assets (they have no market cap), and goes into the address.
    await view.region.getByRole("radiogroup", { name: S.universe.label }).getByRole("radio", { name: tpl(S.universe.etfs, { n: ETF_UNIVERSE.length }) }).click();
    await expect(page).toHaveURL(/[?&]u=etfs(&|$)/);
    await expect(view.table.getByRole("columnheader", { name: S.metrics.assets, exact: true })).toHaveAttribute("aria-sort", "descending");
    await expectSymbols(view.table, sortedSymbols(funds.rows, "assets", "desc"));
    await expect(view.table).toHaveAccessibleName(tpl(S.caption, { n: funds.rows.length, kind: S.kinds.etfs }));
    await expect(view.region.getByText(tpl(S.count, { n: funds.rows.length, total: funds.rows.length }), { exact: true })).toBeVisible();

    // Only the presets that apply to funds, each keeping the funds its hint describes (the volatility percentile is
    // within the funds), with its columns and order.
    const forFunds = PRESETS_SAY.filter((said) => said.funds);
    await expectPresetButtons(view, forFunds);
    for (const said of forFunds) await checkPreset(view, "etfs", said, funds.rows, Date.parse(funds.asOf));
    await view.region.getByRole("list", { name: S.presets.label }).getByRole("button", { name: S.presets[forFunds.at(-1)!.key], exact: true }).click();
    await expect(view.chips).toHaveCount(0);
    await expect(view.table).toHaveAccessibleName(tpl(S.caption, { n: funds.rows.length, kind: S.kinds.etfs }));
  });

  test("each ETF column set shows the fund columns", async ({ page, app }) => {
    test.skip(app.isPhone, "Phones show the symbol and two columns of each set, which the stock column sets test checks; one project is enough.");
    // From a link, on a table with room for every set: beside the filter rail the overview gives up its 1M column at
    // 1440px (the next test).
    await app.goto("/screener?u=etfs");
    const view = results(page);
    await expect(view.table.getByRole("link", { name: "SPY", exact: true })).toBeVisible();
    await view.region.getByRole("button", { name: S.filters.hide, exact: true }).click();
    // The fund sets bring net assets, the fee and the return year to date.
    await checkColumnSets(view, "etfs", ETF_UNIVERSE.length, false);
  });

  test("a 1440px screen fits the ETF overview beside the filter rail", async ({ page, app }) => {
    test.skip(app.isPhone, "The filter rail is the desktop layout.");
    test.fixme(true, "The 208px nav and the 240px rail leave a 61.8rem table, the ETF overview needs 62.25rem with the scrollbar reserve, so 1M drops.");
    // lib/screens.ts: each column set fits a 1440px screen with the filter rail open.
    await app.goto("/screener?u=etfs");
    const view = results(page);
    await expect.poll(() => visibleHeads(view.table), { message: "the heads of the ETF overview" }).toEqual(columnHeads("etfs", "overview", ETF_UNIVERSE.length, false));
  });

  test("a column head sorts the rows by its values, then the other way, then back", async ({ page, app, request }) => {
    test.skip(app.isPhone, "Sorting works the same on phones, with fewer columns on screen; one project is enough.");
    await app.goto("/screener");
    const { rows } = await stocksSnapshot(request);
    const { table } = results(page);
    await expectSymbols(table, byCap(rows));

    // P/E: highest first, then lowest first, a stock without a P/E last both ways; a third click keeps the snapshot's order.
    const pe = table.getByRole("columnheader", { name: S.metrics.pe, exact: true });
    await pe.getByRole("button").click();
    await expect(pe).toHaveAttribute("aria-sort", "descending");
    await expectSymbols(table, sortedSymbols(rows, "pe", "desc"));
    const shown = (await columnTexts(table, S.metrics.pe)).map(parseShown);
    const numbers = shown.filter((value): value is number => value !== null);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(shown.slice(numbers.length), "missing P/Es come last").toEqual(shown.filter((value) => value === null));
    await expect(page).toHaveURL(/[?&]sort=pe\.desc(&|$)/);

    await pe.getByRole("button").click();
    await expect(pe).toHaveAttribute("aria-sort", "ascending");
    await expectSymbols(table, sortedSymbols(rows, "pe", "asc"));
    await expect(page).toHaveURL(/[?&]sort=pe\.asc(&|$)/);

    await pe.getByRole("button").click();
    await expect(pe).not.toHaveAttribute("aria-sort", /./);
    await expectSymbols(table, rows.map((row) => row.symbol));
    await expect(page).toHaveURL(/[?&]sort=none(&|$)/);

    // Text sorts A to Z first.
    const name = table.getByRole("columnheader", { name: S.metrics.name, exact: true });
    await name.getByRole("button").click();
    await expect(name).toHaveAttribute("aria-sort", "ascending");
    await expectSymbols(table, sortedSymbols(rows, "name", "asc"));
  });

  test("a copied link reopens the same screen in a fresh page", async ({ page, app, context, request }) => {
    test.skip(app.isPhone, "The link is the same on phones; one project is enough.");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await app.goto("/screener");
    const { rows } = await stocksSnapshot(request);
    const { region, table, chips } = results(page);
    const rail = panel(page, S.filters.title);

    // Financials above their 200-day average, the valuation columns, lowest P/E first.
    await rail.getByRole("checkbox", { name: getSector("financials")!.label.en }).check();
    await rail.getByRole("radiogroup", { name: S.filters.ma200 }).getByRole("radio", { name: S.filters.above }).click();
    await region.getByRole("tablist", { name: S.columnSets.label }).getByRole("tab", { name: S.columnSets.valuation }).click();
    const pe = table.getByRole("columnheader", { name: S.metrics.pe, exact: true });
    await pe.getByRole("button").click();
    await pe.getByRole("button").click();
    await expect(pe).toHaveAttribute("aria-sort", "ascending");
    const expected = sortedSymbols(
      rows.filter((row) => row.sector === "financials" && row.vs200d !== null && row.vs200d > 0),
      "pe",
      "asc",
    );
    expect(expected.length).toBeGreaterThan(0);
    await expectSymbols(table, expected);

    await region.getByRole("button", { name: S.actions.copyHint }).click();
    await expect(page.getByText(S.actions.copied, { exact: true })).toBeVisible();
    const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect(link.origin + link.pathname).toBe(`${BASE_URL}/screener`);
    expect(Object.fromEntries(link.searchParams)).toEqual({ sector: "financials", ma200: "above", cols: "valuation", sort: "pe.asc" });

    // A new page knows nothing of the first one's state: the link alone brings the same screen back.
    const fresh = await context.newPage();
    const errors = watchConsole(fresh);
    await fresh.goto(link.href);
    const reopened = results(fresh);
    await expectSymbols(reopened.table, expected);
    await expect(reopened.chips).toHaveText(await chips.allTextContents());
    await expect(reopened.region.getByRole("tab", { name: S.columnSets.valuation, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(reopened.table.getByRole("columnheader", { name: S.metrics.pe, exact: true })).toHaveAttribute("aria-sort", "ascending");
    await expect(panel(fresh, S.filters.title).getByRole("checkbox", { name: getSector("financials")!.label.en })).toBeChecked();
    await expect(panel(fresh, S.filters.title).getByRole("radiogroup", { name: S.filters.ma200 }).getByRole("radio", { name: S.filters.above })).toBeChecked();
    await fresh.close();
    expect(errors, "console errors on the reopened page").toEqual([]);
  });

  test("the CSV export holds the rows the table shows, in its order", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The export is the same on phones; one project is enough.");
    // Two sectors from a link, ordered by today's change.
    await app.goto("/screener?sector=technology,financials&sort=chg.desc");
    const snapshot = await stocksSnapshot(request);
    const { region, table } = results(page);
    const matches = snapshot.rows.filter((row) => row.sector === "technology" || row.sector === "financials");
    const order = sortedSymbols(matches, "chg", "desc");
    await expectSymbols(table, order);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      region.getByRole("button", { name: tpl(S.actions.exportHint, { n: matches.length }) }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`investseek-screener-stocks-${newYorkDay(Date.parse(snapshot.asOf))}.csv`);
    const [header, ...lines] = parseCsv(readFileSync(await download.path(), "utf8"));
    expect(header.slice(0, 7)).toEqual(["Symbol", "Name", "Sector", "Price", "Change %", "Market cap (USD)", "P/E (TTM)"]);
    expect(lines.map((line) => line[0])).toEqual(await table.getByRole("link").allTextContents());
    expect(lines.map((line) => line[0])).toEqual(order);
    const bySymbol = new Map(matches.map((row) => [row.symbol, row]));
    for (const line of lines) {
      const row = bySymbol.get(line[0])!;
      expect(line.length, `fields of ${row.symbol}`).toBe(header.length);
      expect(line[1]).toBe(row.name);
      expect(line[2]).toBe(getSector(row.sector!)!.label.en);
      expect(Number(line[3])).toBeCloseTo(row.price!, 4);
      expect(Number(line[5])).toBe(Math.round(row.marketCap!));
    }
  });

  test("saved screens stay in this browser: save, reload, reopen, update and delete", async ({ page, app, request }) => {
    test.skip(app.isPhone, "Phones keep the saved screens in the filter sheet; the list works the same, so one project is enough.");
    await app.goto("/screener");
    const snapshot = await stocksSnapshot(request);
    const { region, table, chips } = results(page);
    const saved = panel(page, S.saved.title);
    const name = saved.getByRole("textbox", { name: S.saved.name });
    const dividendValue = PRESETS_SAY.find((entry) => entry.key === "dividendValue")!;
    const preset = PRESETS.find((entry) => entry.key === "dividendValue")!;
    const presetRows = sortedSymbols(
      snapshot.rows.filter((row) => dividendValue.keeps(row, 0)),
      preset.sort.key,
      preset.sort.direction,
    );

    await region.getByRole("list", { name: S.presets.label }).getByRole("button", { name: S.presets.dividendValue }).click();
    await expectSymbols(table, presetRows);
    await name.fill("Income");
    await saved.getByRole("button", { name: S.saved.save, exact: true }).click();
    await expect(page.getByText(tpl(S.saved.saved, { name: "Income" }), { exact: true })).toBeVisible();
    const entry = saved.getByRole("button", { name: /^Income\b/ });
    await expect(entry).toHaveAttribute("aria-current", "true");
    await expect(entry).toContainText(tpl(S.saved.meta, { kind: S.universeNames.stocks, n: 2 }));
    // Kept under its share-link query, the same as the address bar's.
    const query = new URL(page.url()).search.slice(1);
    await expect.poll(() => stored<Array<{ name: string; query: string }>>(page, SCREENS_KEY)).toEqual([expect.objectContaining({ name: "Income", query })]);

    // A reload keeps it.
    await page.reload();
    await app.settle();
    await expect(entry).toHaveAttribute("aria-current", "true");

    // Reopening it brings the screen back after the filters were cleared.
    await region.getByRole("button", { name: S.filters.clear, exact: true }).click();
    await expect(chips).toHaveCount(0);
    await expect(entry).not.toHaveAttribute("aria-current", /./);
    await entry.click();
    await expect(chips).toHaveText(dividendValue.chips);
    await expectSymbols(table, presetRows);
    await expect(entry).toHaveAttribute("aria-current", "true");

    // Saving under the same name (any case) updates the screen and the name instead of adding one.
    await panel(page, S.filters.title).getByRole("checkbox", { name: getSector("energy")!.label.en }).check();
    await name.fill("income");
    await saved.getByRole("button", { name: S.saved.save, exact: true }).click();
    await expect(page.getByText(tpl(S.saved.updated, { name: "income" }), { exact: true })).toBeVisible();
    const updated = saved.getByRole("button", { name: /^income\b/ });
    await expect(saved.getByRole("button", { name: /^Delete / })).toHaveCount(1);
    await expect(updated).toContainText(tpl(S.saved.meta, { kind: S.universeNames.stocks, n: 3 }));
    await expect.poll(async () => (await stored<Array<{ name: string; query: string }>>(page, SCREENS_KEY))?.map((screen) => [screen.name, new URLSearchParams(screen.query).get("sector")])).toEqual([["income", "energy"]]);

    // Deleting it can be undone once; deleted again, it is gone from the list and from storage.
    await saved.getByRole("button", { name: tpl(S.saved.remove, { name: "income" }) }).click();
    await expect(updated).toHaveCount(0);
    await expect(saved.getByText(S.saved.empty)).toBeVisible();
    await page.getByRole("button", { name: S.undo, exact: true }).click();
    await expect(updated).toBeVisible();
    await saved.getByRole("button", { name: tpl(S.saved.remove, { name: "income" }) }).click();
    await expect(updated).toHaveCount(0);
    await expect.poll(() => stored<unknown[]>(page, SCREENS_KEY)).toEqual([]);
  });

  test("the watch star adds a row's symbol to the watchlist and takes it out again", async ({ page, app }) => {
    await app.seedStorage({ watchlist: ["NVDA", "AAPL"] });
    await app.goto("/screener");
    const { table } = results(page);
    const row = table.getByRole("row").filter({ has: page.getByRole("link", { name: "TSLA", exact: true }) });
    // A filled star marks what the watchlist holds already.
    await expect(table.getByRole("button", { name: tpl(S.star.remove, { symbol: "NVDA" }) })).toBeVisible();

    await row.getByRole("button", { name: tpl(S.star.add, { symbol: "TSLA" }) }).click();
    await expect(row.getByRole("button", { name: tpl(S.star.remove, { symbol: "TSLA" }) })).toBeVisible();
    await expect.poll(() => stored<string[]>(page, WATCHLIST_KEY)).toEqual(["NVDA", "AAPL", "TSLA"]);

    await row.getByRole("button", { name: tpl(S.star.remove, { symbol: "TSLA" }) }).click();
    await expect(row.getByRole("button", { name: tpl(S.star.add, { symbol: "TSLA" }) })).toBeVisible();
    await expect.poll(() => stored<string[]>(page, WATCHLIST_KEY)).toEqual(["NVDA", "AAPL"]);
  });

  test("on a phone the filter sheet narrows the results", async ({ page, app, request }) => {
    test.skip(!app.isPhone, "Phones filter in a sheet; the desktop rail has its own test.");
    await app.goto("/screener");
    const { rows } = await stocksSnapshot(request);
    const { region, table } = results(page);
    await expectSymbols(table, byCap(rows));
    await region.getByRole("button", { name: S.filters.button, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: S.filters.title });
    await sheet.getByRole("checkbox", { name: getSector("energy")!.label.en }).check();
    const energy = rows.filter((row) => row.sector === "energy");
    await sheet.getByRole("button", { name: tpl(S.filters.showResults, { n: energy.length }) }).click();
    await expect(sheet).toBeHidden();
    await expectSymbols(table, byCap(energy));
    await expect(region.getByRole("button", { name: tpl(S.filters.buttonCount, { n: 1 }) })).toBeVisible();
  });
});

const D = MESSAGES.en.discover;

/** The lists of the Discover tab: each panel's tabs, then Trending (whose table has no market-cap column). */
const DISCOVER_LISTS: ReadonlyArray<{ panel: string; tab: string | null; label: string; screen: DiscoverScreen; capColumn: boolean }> = [
  { panel: D.movers, tab: D.moverTabs.day_gainers, label: D.moverTabs.day_gainers, screen: "day_gainers", capColumn: true },
  { panel: D.movers, tab: D.moverTabs.day_losers, label: D.moverTabs.day_losers, screen: "day_losers", capColumn: true },
  { panel: D.movers, tab: D.moverTabs.most_actives, label: D.moverTabs.most_actives, screen: "most_actives", capColumn: true },
  { panel: D.ideas, tab: D.ideaTabs.undervalued_large_caps, label: D.ideaTabs.undervalued_large_caps, screen: "undervalued_large_caps", capColumn: true },
  { panel: D.ideas, tab: D.ideaTabs.growth_technology_stocks, label: D.ideaTabs.growth_technology_stocks, screen: "growth_technology_stocks", capColumn: true },
  { panel: D.ideas, tab: D.ideaTabs.most_shorted_stocks, label: D.ideaTabs.most_shorted_stocks, screen: "most_shorted_stocks", capColumn: true },
  { panel: D.trending, tab: null, label: D.trending, screen: "trending", capColumn: false },
];

test.describe("discover", () => {
  test("every list shows its rows with their count, all above the market-cap floor it states", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The phone layout hides columns of the same lists; one project is enough.");
    await app.goto("/screener?tab=discover");
    const about = panel(page, D.source);
    await expect(about.getByText(tpl(D.sourceNote, { cap: "$1B" }), { exact: true })).toBeVisible();

    /** A list on screen: the rows of the API answer for this floor, in its order, each above the floor. Resolves to the answer. */
    const checkList = async (list: (typeof DISCOVER_LISTS)[number], floor: number): Promise<DiscoverResponse> => {
      const region = panel(page, list.panel);
      if (list.tab) await region.getByRole("tab", { name: list.tab, exact: true }).click();
      const data = await getJson<DiscoverResponse>(request, `/api/discover?screen=${list.screen}&minCap=${floor}`);
      const symbols = data.quotes.map((quote) => quote.symbol);
      expect(symbols.length, `${list.screen} above ${floor}`).toBeGreaterThan(0);
      // The quality floor: US-listed stocks at $2 or more, worth at least the floor.
      for (const quote of data.quotes) {
        expect(quote.quoteType, quote.symbol).toBe("EQUITY");
        expect(quote.price ?? 0, quote.symbol).toBeGreaterThanOrEqual(2);
        expect(quote.marketCap ?? 0, quote.symbol).toBeGreaterThanOrEqual(floor);
      }
      const table = tableIn(region);
      await expect(table).toHaveAccessibleName(tpl(D.caption, { list: list.label, n: symbols.length }));
      await expectSymbols(table, symbols);
      const meta = data.total !== null ? tpl(D.shown, { n: symbols.length, scanned: data.scanned, total: data.total }) : tpl(D.shownNoTotal, { n: symbols.length, scanned: data.scanned });
      await expect(region).toContainText(meta);
      // The rows on screen are those of the answer; their market caps as the table prints them clear the floor too.
      if (list.capColumn) for (const text of await columnTexts(table, MESSAGES.en.columns.marketCap)) expect(parseCompact(text), `market cap ${text}`).toBeGreaterThanOrEqual(floor);
      return data;
    };

    // The fixture's lists hold no stock under $1B even without a floor, so a $1B floor left unapplied would go unseen
    // here; the $10B pass below is the one that can tell.
    const atDefault = new Map<DiscoverScreen, DiscoverResponse>();
    for (const list of DISCOVER_LISTS) atDefault.set(list.screen, await checkList(list, 1e9));

    // A higher floor applies to the lists on screen (each panel keeps its tab) and goes into the address. Those lists
    // show stocks under $10B at $1B, which the new floor has to drop: without them this pass would prove nothing.
    const onScreen = DISCOVER_LISTS.filter((entry) => [D.moverTabs.most_actives, D.ideaTabs.most_shorted_stocks, D.trending].includes(entry.label));
    const under = onScreen.flatMap((list) => atDefault.get(list.screen)!.quotes.filter((quote) => (quote.marketCap ?? 0) < 1e10).map((quote) => `${quote.symbol} (${list.screen})`));
    expect(under, "stocks under $10B in the lists on screen at the $1B floor").not.toEqual([]);
    await page.getByRole("radiogroup", { name: D.minCap }).getByRole("radio", { name: "$10B" }).click();
    await expect(page).toHaveURL(/[?&]mincap=10B(&|$)/);
    await expect(about.getByText(tpl(D.sourceNote, { cap: "$10B" }), { exact: true })).toBeVisible();
    for (const list of onScreen) await checkList({ ...list, tab: null }, 1e10);
  });
});
