import { PORT_VIEW_KEY } from "@/components/portfolio/port-view";
import { HOLDINGS_STORAGE_KEY } from "@/hooks/useHoldings";
import { yahooSectorKey } from "@/lib/sectors";
import { getSector, sectorOfSymbol } from "@/lib/universe";
import type { Quote } from "@/types/api";

import {
  amount,
  cellOf,
  dataRows,
  expectFigure,
  fetchHistory,
  fetchProfiles,
  fetchQuotes,
  FIGURE,
  parseFigure,
  percent,
  price,
  rangeReturns,
  readStored,
  riskFigures,
  rowOf,
  shortDate,
  signedAmount,
  tileLines,
  toast,
  valueHoldings,
  type Holdings,
  type ValuedHoldings,
} from "../support/personal";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Page } from "../support/test";

// Positions and the portfolio page (PORT, its exposure, risk and correlation tabs). Every figure is compared with what
// the seeded shares and costs imply at the quotes the page reads (/api/quotes) and, for the risk figures, with the
// statistics of a year of the closes it reads (/api/history), computed in e2e/support/personal.ts by the definitions
// the page states. The positions: AAPL and MSFT (universe stocks), SPY (a fund) and PLTR (outside the stock universe,
// so its sector comes from its profile); the exposure test adds a Hong Kong listing quoted in HKD.

const HOLDINGS: Holdings = SAMPLE_DATA.holdings;
const SYMBOLS = Object.keys(HOLDINGS);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function analyticsPanel(page: Page) {
  return page.getByRole("region", { name: "Portfolio analytics", exact: true }).first();
}

/** "Fri, Nov 6" when the latest session of the positions' quotes was before today (a weekend), as the day tiles say; else null. */
async function sessionLabel(page: Page, quotes: ReadonlyMap<string, Quote>, symbols: readonly string[]): Promise<string | null> {
  const latest = Math.max(...symbols.map((symbol) => Date.parse(quotes.get(symbol)?.regularMarketTime ?? "")));
  const now = await page.evaluate(() => Date.now());
  const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
  if (day(latest) >= day(now)) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(latest));
}

/** The header of the extended-hours P&L column and the label of its tile, when a position trades outside the session. */
function extendedLabels(quotes: ReadonlyMap<string, Quote>, symbols: readonly string[]): { column: string; tile: string } | null {
  const sessions = new Set(symbols.flatMap((symbol) => (quotes.get(symbol)?.extendedSession && typeof quotes.get(symbol)?.extendedChange === "number" ? [quotes.get(symbol)?.extendedSession] : [])));
  if (sessions.size === 0) return null;
  if (sessions.size > 1) return { column: "Ext P&L", tile: "Extended-hours P&L" };
  return sessions.has("PRE") ? { column: "Pre P&L", tile: "Pre-market P&L" } : { column: "AH P&L", tile: "After-hours P&L" };
}

/** The summed weights as shown (one decimal each) come to 100% up to their rounding. */
function expectWeightsAddUp(shown: readonly string[]): void {
  const sum = shown.reduce((total, text) => total + parseFigure(text), 0);
  expect(Math.abs(sum - 100), `weights ${shown.join(" + ")}`).toBeLessThanOrEqual(0.05 * shown.length + 1e-9);
}

test.describe("positions", () => {
  test("the positions panel values each holding at its quote, with totals and weights that add up", async ({ page, app, request }) => {
    await app.seedStorage({ watchlist: ["NVDA"], holdings: HOLDINGS });
    await app.goto("/watchlist");
    const quotes = await fetchQuotes(request, SYMBOLS);
    const valued = valueHoldings(HOLDINGS, quotes);
    const phone = app.isPhone;
    const table = page.getByRole("region", { name: "Positions", exact: true }).first().getByRole("table");
    const extended = extendedLabels(quotes, SYMBOLS);
    const session = await sessionLabel(page, quotes, SYMBOLS);

    // Largest value first, then the totals row. Phones show values in whole units and P&L % under the P&L.
    await expect(dataRows(table)).toHaveText([...valued.rows.map((row) => new RegExp(`^${escapeRegExp(row.symbol)}`)), /^Total/]);
    for (const row of valued.rows) {
      const line = rowOf(table, row.symbol);
      const cell = (column: string) => cellOf(table, line, column);
      await expect(await cell("Value")).toHaveText(amount(row.value, phone ? 0 : 2), { useInnerText: true });
      await expect(await cell("Day P&L")).toHaveText(signedAmount(row.dayPnl), { useInnerText: true });
      await expect(await cell("P&L")).toHaveText(phone ? `${signedAmount(row.pnl)} ${percent(row.pnlRatio, 1, true)}` : signedAmount(row.pnl), { useInnerText: true });
      if (phone) {
        await expect(await cell("Symbol")).toHaveText(`${row.symbol} ${row.shares} sh`, { useInnerText: true });
        continue;
      }
      await expect(await cell("Shares")).toHaveText(String(row.shares));
      await expect(await cell("Weight")).toHaveText(percent(row.weight as number));
      await expect(await cell("P&L %")).toHaveText(percent(row.pnlRatio, 1, true));
      if (extended) await expect(await cell(extended.column)).toHaveText(row.extendedPnl === null ? "—" : signedAmount(row.extendedPnl));
      const next = quotes.get(row.symbol)?.nextEarningsDate;
      await expect(await cell("Next ER")).toHaveText(next ? shortDate(next) : "—");
    }

    const totals = rowOf(table, "Total");
    const total = (column: string) => cellOf(table, totals, column);
    await expect(await total("Value")).toHaveText(amount(valued.totals.value, phone ? 0 : 2), { useInnerText: true });
    await expect(await total("Day P&L")).toHaveText(signedAmount(valued.totals.dayPnl), { useInnerText: true });
    await expect(await total("P&L")).toHaveText(phone ? `${signedAmount(valued.totals.pnl)} ${percent(valued.totals.pnlRatio, 1, true)}` : signedAmount(valued.totals.pnl), {
      useInnerText: true,
    });
    if (!phone) {
      await expect(await total("Weight")).toHaveText("100.0%");
      await expect(await total("P&L %")).toHaveText(percent(valued.totals.pnlRatio, 1, true));
      if (extended) await expect(await total(extended.column)).toHaveText(signedAmount(valued.totals.extendedPnl));
      expectWeightsAddUp(valued.rows.map((row) => percent(row.weight as number)));
    }

    // The summary band above the list shows the same totals.
    await expect.poll(() => tileLines(page, `Value · ${valued.base}`)).toEqual([amount(valued.totals.value), `${valued.rows.length} positions`]);
    await expect
      .poll(() => tileLines(page, session ? "Last session" : "Today"))
      .toEqual([signedAmount(valued.totals.dayPnl), percent(valued.totals.dayRatio, 2, true), ...(session ? [session] : [])]);
    await expect.poll(() => tileLines(page, "Unrealized P&L")).toEqual([signedAmount(valued.totals.pnl), percent(valued.totals.pnlRatio, 1, true)]);
    await expect.poll(() => tileLines(page, "Cost basis")).toEqual([amount(valued.totals.costBasis)]);
    if (extended) {
      await expect
        .poll(() => tileLines(page, extended.tile))
        .toEqual([
          signedAmount(valued.totals.extendedPnl),
          percent(valued.totals.extendedPnl / valued.totals.value, 2, true),
          session ? "Not included in the last session" : "Not included in Today",
        ]);
    }
  });
});

test.describe("portfolio page", () => {
  test("the figures follow from the quotes, the positions and a year of their prices", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The same tiles stack in two columns on phones.");
    await app.seedStorage({ watchlist: ["NVDA"], holdings: HOLDINGS });
    await app.goto("/portfolio");
    const [quotes, history] = await Promise.all([fetchQuotes(request, SYMBOLS), fetchHistory(request, [...SYMBOLS, "SPY"])]);
    const valued = valueHoldings(HOLDINGS, quotes);
    const risk = riskFigures(history, valued.rows);
    const session = await sessionLabel(page, quotes, SYMBOLS);
    const n = valued.rows.length;

    await expect.poll(() => tileLines(page, `Value · ${valued.base}`)).toEqual([amount(valued.totals.value), `${n} positions`]);
    await expect
      .poll(() => tileLines(page, session ? "Last session P&L" : "Day P&L"))
      .toEqual([signedAmount(valued.totals.dayPnl), percent(valued.totals.dayRatio, 2, true), ...(session ? [session] : [])]);
    await expect.poll(() => tileLines(page, "Unrealized P&L")).toEqual([signedAmount(valued.totals.pnl), percent(valued.totals.pnlRatio, 1, true)]);
    await expect.poll(() => tileLines(page, "Cost basis")).toEqual([amount(valued.totals.costBasis)]);

    // Dividends: shares x each quote's forward annual rate, over the payers.
    const payers = valued.rows.filter((row) => (quotes.get(row.symbol)?.dividendRate ?? 0) > 0);
    const dividends = payers.reduce((sum, row) => sum + row.shares * (quotes.get(row.symbol)?.dividendRate as number), 0);
    await expect.poll(() => tileLines(page, "Dividends / yr")).toEqual([amount(dividends), `approx. · ${payers.length} of ${n} pay`]);

    // The risk figures of today's shares over the last year of sessions.
    const line = (label: string, index: number) => async () => (await tileLines(page, label))[index] ?? "";
    await expectFigure(line("Beta vs SPY", 0), risk.beta, 2);
    await expectFigure(line("Volatility 1y", 0), risk.volatility * 100, 1);
    await expectFigure(line("1-day VaR 95%", 0), risk.varAmount, 2);
    await expectFigure(line("1-day VaR 95%", 1), risk.varRatio * 100, 1);
    await expectFigure(line("Max drawdown 1y", 0), risk.maxDrawdown.depth * 100, 1);
    await expect.poll(line("Max drawdown 1y", 1)).toBe(new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(risk.maxDrawdown.troughDate));
    const effective = 1 / valued.rows.reduce((sum, row) => sum + (row.weight as number) ** 2, 0);
    await expect.poll(() => tileLines(page, "Effective positions")).toEqual([effective.toFixed(1), `of ${n} positions`]);

    // Every position is analyzed, at its weight; the weights add up to 100%.
    const coverage = page.getByRole("region", { name: "Holdings analyzed", exact: true }).first();
    await expect(coverage).toContainText(`${n} of ${n} positions`);
    await expect(coverage.getByRole("listitem")).toHaveText(
      valued.rows.map((row) => new RegExp(`^${escapeRegExp(row.symbol)}\\s*${escapeRegExp(percent(row.weight as number))}$`)),
      { useInnerText: true },
    );
    expectWeightsAddUp(valued.rows.map((row) => percent(row.weight as number)));
  });

  test("the benchmark switch compares today's holdings with SPY or QQQ over the chosen range", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The same controls on phones.");
    await app.seedStorage({ watchlist: ["NVDA"], holdings: HOLDINGS });
    await app.goto("/portfolio");
    const [quotes, history, qqq] = await Promise.all([fetchQuotes(request, SYMBOLS), fetchHistory(request, [...SYMBOLS, "SPY"]), fetchHistory(request, ["QQQ"])]);
    const risk = riskFigures(history, valueHoldings(HOLDINGS, quotes).rows);
    const qqqCloses = { dates: qqq.dates, closes: qqq.closes.QQQ ?? [] };
    const analytics = analyticsPanel(page);
    const benchmark = analytics.getByRole("radiogroup", { name: "Benchmark" });
    const range = analytics.getByRole("radiogroup", { name: "Range" });
    const chart = analytics.getByRole("img", { name: /^Today's holdings / });

    /** The chart's label names the benchmark and both returns over the range. */
    const expectComparison = async (name: "SPY" | "QQQ", returns: { holdings: number; benchmark: number }) => {
      const label = async () => (await chart.getAttribute("aria-label")) ?? "";
      const part = (index: 1 | 3) => async () => /^Today's holdings (\S+), (\S+) (\S+) over the range$/.exec(await label())?.[index] ?? "";
      await expect.poll(async () => /^Today's holdings \S+, (\S+) /.exec(await label())?.[1]).toBe(name);
      await expectFigure(part(1), returns.holdings * 100, 1);
      await expectFigure(part(3), returns.benchmark * 100, 1);
      await expect(analytics.getByRole("listitem").filter({ hasText: name })).toHaveText(new RegExp(`^${name}\\s*[+\\u2212]?\\d+\\.\\d%$`), { useInnerText: true });
    };

    await expect(benchmark.getByRole("radio", { name: "SPY" })).toBeChecked();
    await expect(range.getByRole("radio", { name: "1Y" })).toBeChecked();
    await expectComparison("SPY", rangeReturns(risk, 252));

    await benchmark.getByRole("radio", { name: "QQQ" }).click();
    await expect(benchmark.getByRole("radio", { name: "QQQ" })).toBeChecked();
    await expectComparison("QQQ", rangeReturns(risk, 252, qqqCloses));
    await range.getByRole("radio", { name: "3M" }).click();
    await expectComparison("QQQ", rangeReturns(risk, 63, qqqCloses));

    // The choice is remembered in this browser.
    await expect.poll(() => readStored(page, PORT_VIEW_KEY)).toEqual({ benchmark: "QQQ", range: "3m" });
    await page.reload();
    await app.settle();
    await expect(benchmark.getByRole("radio", { name: "QQQ" })).toBeChecked();
    await expect(range.getByRole("radio", { name: "3M" })).toBeChecked();
    await expectComparison("QQQ", rangeReturns(risk, 63, qqqCloses));

    await benchmark.getByRole("radio", { name: "SPY" }).click();
    await expectComparison("SPY", rangeReturns(risk, 63));
  });

  test("exposure by sector, asset class and currency adds up to 100%, with every holding in its bucket", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The same bars, in one column, on phones.");
    const holdings: Holdings = { ...HOLDINGS, "0700.HK": { shares: 2, cost: 400 } };
    await app.seedStorage({ watchlist: ["NVDA"], holdings });
    // A deep link opens the tab.
    await app.goto("/portfolio?tab=exposure");
    const analytics = analyticsPanel(page);
    await expect(analytics.getByRole("tab", { name: "Exposure" })).toHaveAttribute("aria-selected", "true");
    const [quotes, profiles] = await Promise.all([fetchQuotes(request, [...Object.keys(holdings), "HKDUSD=X"]), fetchProfiles(request, ["PLTR"])]);
    const valued: ValuedHoldings = valueHoldings(holdings, quotes);
    expect(valued.base).toBe("USD");
    expect(valued.foreign.map((row) => row.symbol)).toEqual(["0700.HK"]);

    /** Slices by key over the base-currency positions, largest value first, with their members in value order. */
    const slices = (keyOf: (symbol: string) => string) => {
      const groups = new Map<string, { value: number; symbols: string[] }>();
      for (const row of valued.rows) {
        const group = groups.get(keyOf(row.symbol)) ?? { value: 0, symbols: [] };
        group.value += row.value;
        group.symbols.push(row.symbol);
        groups.set(keyOf(row.symbol), group);
      }
      return [...groups].map(([label, group]) => ({ label, ...group })).sort((a, b) => b.value - a.value);
    };
    const bars = async (title: string, expected: Array<{ label: string; value: number; symbols: string[]; note?: string; weight: number }>) => {
      const list = analytics.getByRole("list", { name: title });
      await expect(list.getByRole("listitem")).toHaveText(
        expected.map(
          (slice) =>
            new RegExp(`^${escapeRegExp(slice.label)}\\s*${slice.note ? `${escapeRegExp(slice.note)}\\s*` : ""}${escapeRegExp(amount(slice.value, 0))}\\s*${escapeRegExp(percent(slice.weight))}$`),
        ),
        { useInnerText: true },
      );
      // Each bar names its members (its tooltip), so every holding is in exactly one bucket.
      for (const slice of expected) await expect(list.getByRole("listitem", { name: slice.symbols.join(", "), exact: true })).toHaveCount(1);
      expectWeightsAddUp(expected.map((slice) => percent(slice.weight)));
    };

    // Sector: the universe's sector for AAPL and MSFT, Yahoo's sector (from the profile) for PLTR, funds by kind. The
    // position in HKD is left out of the sector and asset-class bars, which are by value in USD.
    const sectorOf = (symbol: string) => {
      if (quotes.get(symbol)?.quoteType === "ETF") return "ETFs and funds";
      const key = sectorOfSymbol(symbol)?.key ?? yahooSectorKey(profiles.profiles[symbol]?.sector);
      return (key && getSector(key)?.label.en) ?? "Unclassified";
    };
    const total = valued.totals.value;
    await bars("Sector", slices(sectorOf).map((slice) => ({ ...slice, weight: slice.value / total })));
    const classOf = (symbol: string) => ({ EQUITY: "Stocks", ETF: "ETFs" })[quotes.get(symbol)?.quoteType as "EQUITY" | "ETF"] ?? "Other";
    await bars("Asset class", slices(classOf).map((slice) => ({ ...slice, weight: slice.value / total })));

    // Currency: every position, the one in HKD converted at the HKD/USD quote for this breakdown only.
    const rate = quotes.get("HKDUSD=X")?.price as number;
    const hk = valued.foreign[0];
    const converted = hk.value * rate;
    const currencies = [
      { label: "USD", value: total, symbols: valued.rows.map((row) => row.symbol) },
      { label: "HKD", value: converted, symbols: ["0700.HK"], note: `(${amount(hk.value, 0)} HKD)` },
    ].sort((a, b) => b.value - a.value);
    await bars("Currency", currencies.map((slice) => ({ ...slice, weight: slice.value / (total + converted) })));

    // The HKD position is valued on its own, not in the USD totals and risk figures.
    const coverage = page.getByRole("region", { name: "Holdings analyzed", exact: true }).first();
    await expect(coverage).toContainText(`${valued.rows.length} of ${valued.rows.length + 1} positions`);
    await expect(coverage.getByRole("listitem").filter({ hasText: "0700.HK" })).toHaveText(/^0700\.HK\s*in HKD, not converted$/, { useInnerText: true });
  });

  test("the risk tab shows each holding's weight, share of risk, beta and volatility over a year of prices", async ({ page, app, request }) => {
    test.skip(app.isPhone, "Phones hide the volatility and gap columns.");
    await app.seedStorage({ watchlist: ["NVDA"], holdings: HOLDINGS });
    await app.goto("/portfolio?tab=risk");
    const analytics = analyticsPanel(page);
    await expect(analytics.getByRole("tab", { name: "Risk" })).toHaveAttribute("aria-selected", "true");
    const [quotes, history] = await Promise.all([fetchQuotes(request, SYMBOLS), fetchHistory(request, [...SYMBOLS, "SPY"])]);
    const valued = valueHoldings(HOLDINGS, quotes);
    const risk = riskFigures(history, valued.rows);

    // The positions, largest share of risk first.
    const table = analytics.getByRole("table");
    const order = [...valued.rows].sort((a, b) => risk.positions[b.symbol].riskShare - risk.positions[a.symbol].riskShare);
    await expect(dataRows(table)).toHaveText(order.map((row) => new RegExp(`^${escapeRegExp(row.symbol)}`)));
    const shownWeights: string[] = [];
    const shownShares: string[] = [];
    for (const row of order) {
      const figures = risk.positions[row.symbol];
      const line = rowOf(table, row.symbol);
      const cell = (column: string) => cellOf(table, line, column);
      await expect(await cell("Weight")).toHaveText(percent(figures.weight));
      await expectFigure(await cell("Share of risk"), figures.riskShare * 100, 1);
      await expectFigure(await cell("Risk − weight"), (figures.riskShare - figures.weight) * 100, 1);
      await expectFigure(await cell("Beta"), figures.beta, 2);
      await expectFigure(await cell("Volatility"), figures.volatility * 100, 1);
      shownWeights.push(await (await cell("Weight")).innerText());
      shownShares.push(await (await cell("Share of risk")).innerText());
    }
    expectWeightsAddUp(shownWeights);
    expectWeightsAddUp(shownShares);

    // The sentence names the position whose share of risk exceeds its weight the most.
    const excess = (symbol: string) => risk.positions[symbol].riskShare - risk.positions[symbol].weight;
    const gap = order.reduce((best, row) => (excess(row.symbol) > excess(best.symbol) ? row : best));
    await expect(analytics.getByText(/ of value, \d+% of risk$/)).toHaveText(new RegExp(`^${escapeRegExp(gap.symbol)}: ${escapeRegExp(percent(risk.positions[gap.symbol].weight, 0))} of value, \\d+% of risk$`));

    // The portfolio's own beta, volatility, VaR and maximum drawdown are finite figures above the tabs.
    for (const [label, index] of [["Beta vs SPY", 0], ["Volatility 1y", 0], ["1-day VaR 95%", 0], ["1-day VaR 95%", 1], ["Max drawdown 1y", 0]] as const) {
      await expect.poll(async () => (await tileLines(page, label))[index]).toMatch(FIGURE);
    }
  });

  test("the analytics tabs live in the address, and the correlation matrix is symmetric over the held symbols", async ({ page, app, request }) => {
    await app.seedStorage({ watchlist: ["NVDA"], holdings: HOLDINGS });
    await app.goto("/portfolio");
    const analytics = analyticsPanel(page);
    await expect(analytics.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await analytics.getByRole("tab", { name: "Correlation" }).click();
    await expect(page).toHaveURL(/\/portfolio\?tab=correlation$/);
    await expect(analytics.getByRole("tab", { name: "Correlation" })).toHaveAttribute("aria-selected", "true");

    const [quotes, history] = await Promise.all([fetchQuotes(request, SYMBOLS), fetchHistory(request, [...SYMBOLS, "SPY"])]);
    const valued = valueHoldings(HOLDINGS, quotes);
    const risk = riskFigures(history, valued.rows);
    const symbols = valued.rows.map((row) => row.symbol);

    const expectMatrix = async () => {
      // The tab's only table (its scroll box is a region named like the table's caption).
      const matrix = analytics.getByRole("table");
      await expect(matrix.getByRole("columnheader")).toHaveText(symbols);
      await expect(matrix.getByRole("rowheader")).toHaveText(symbols);
      const rows = matrix.getByRole("row").filter({ has: page.getByRole("rowheader") });
      const cells = await Promise.all(symbols.map((_, i) => rows.nth(i).getByRole("cell").allTextContents()));
      symbols.forEach((a, i) => {
        expect(cells[i], `row ${a}`).toHaveLength(symbols.length);
        symbols.forEach((b, j) => {
          const text = cells[i][j].trim();
          if (i === j) {
            expect(text, `${a} with itself`).toBe("1");
            return;
          }
          expect(text, `${a} and ${b} as ${b} and ${a}`).toBe(cells[j][i].trim());
          expect(text, `${a} and ${b}`).toMatch(/^−?[01]\.\d{2}$/);
          expect(Math.abs(parseFigure(text) - risk.correlation[a][b]), `${a} and ${b}: ${text} vs ${risk.correlation[a][b]}`).toBeLessThanOrEqual(0.005 + 1e-9);
        });
      });
      const pairs = symbols.flatMap((a, i) => symbols.slice(i + 1).map((b) => risk.correlation[a][b]));
      await expectFigure(async () => /^Average pairwise correlation (\S+)$/.exec(await analytics.getByText(/^Average pairwise correlation /).innerText())?.[1] ?? "", pairs.reduce((s, r) => s + r, 0) / pairs.length, 2);
      await expect(analytics).toContainText(`Based on ${risk.sessions} sessions.`);
    };
    await expectMatrix();

    // The address keeps the tab: a reload opens it again, and the overview has the plain address.
    await page.reload();
    await app.settle();
    await expect(analytics.getByRole("tab", { name: "Correlation" })).toHaveAttribute("aria-selected", "true");
    await expectMatrix();
    await analytics.getByRole("tab", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(analytics.getByRole("img", { name: /^Today's holdings / })).toBeVisible();
  });

  test("an empty portfolio offers to add a position, and the first one fills the page", async ({ page, app, request }) => {
    await app.seedStorage({ watchlist: ["NVDA"], holdings: {} });
    await app.goto("/portfolio");
    const analytics = analyticsPanel(page);
    await expect(analytics).toContainText("Add positions to see exposure, risk and correlations.");
    await expect(analytics.getByRole("link", { name: "Paste positions" })).toHaveAttribute("href", "/data#paste");
    await expect(analytics.getByRole("tablist")).toHaveCount(0);
    const aapl = (await fetchQuotes(request, ["AAPL"])).get("AAPL")?.price as number;

    await analytics.getByRole("button", { name: "Add position" }).click();
    const editor = page.getByRole("dialog", { name: "Add position" });
    await editor.getByRole("combobox", { name: "Symbol" }).fill("aapl");
    await editor.getByRole("combobox", { name: "Symbol" }).press("Enter");
    const form = page.getByRole("dialog", { name: "Add position for AAPL" });
    await form.getByRole("textbox", { name: "Shares" }).fill("10");
    await form.getByRole("textbox", { name: "Avg cost" }).fill("150");
    await expect(form.getByRole("heading", { name: `At the last price ${price(aapl)}` })).toBeVisible();
    await expect(form.getByRole("definition").first()).toHaveText(amount(10 * aapl));
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toHaveCount(0);
    await expect(toast(page, "Saved AAPL position")).toBeVisible();
    await expect.poll(() => readStored(page, HOLDINGS_STORAGE_KEY)).toEqual({ AAPL: { shares: 10, cost: 150 } });

    await expect(analytics.getByRole("tablist", { name: "Analytics view" })).toBeVisible();
    await expect.poll(async () => (await tileLines(page, "Value · USD"))[0]).toBe(amount(10 * aapl));
    await expect.poll(() => tileLines(page, "Unrealized P&L")).toEqual([signedAmount(10 * aapl - 1500), percent((10 * aapl - 1500) / 1500, 1, true)]);
  });

  test("counts a single position in the singular", async ({ page, app }) => {
    test.skip(app.isPhone, "The same tiles on phones.");
    test.fixme(true, "app bug: the '{n} positions' message has no singular, so one position reads '1 positions' (and 'of 1 positions') in the tiles of /portfolio and /watchlist");
    await app.seedStorage({ watchlist: ["NVDA"], holdings: { AAPL: { shares: 10, cost: 150 } } });
    await app.goto("/portfolio");
    await expect.poll(async () => (await tileLines(page, "Value · USD"))[1]).toBe("1 position");
    await expect.poll(async () => (await tileLines(page, "Effective positions"))[1]).toBe("of 1 position");
  });
});
