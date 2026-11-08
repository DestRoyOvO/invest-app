import type { APIRequestContext } from "@playwright/test";

import type { Bar, ChartData, ChartRange, HistoryResponse } from "@/types/api";
import type { EarningsDetail } from "@/types/earnings";

import { AT_DEFAULT_NOW } from "../support/env";
import {
  api,
  CHART_RANGES,
  chartArea,
  chartPanel,
  chartSeries,
  chartSummary,
  chartSummaryText,
  escapeRegExp,
  inOrder,
  known,
  percent,
  price,
  RANGE_LABELS,
  seriesRange,
  shownBars,
  stockDetail,
  stockRoute,
  storedChartSettings,
} from "../support/quote";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Locator } from "../support/test";

// The chart workstation of the quote page (GP) against the chart routes it reads. The canvas itself is not read: the
// checks go through what the chart exposes, its text summary for screen readers ("AAPL 1Y: low ..., high ..., last ...
// on ..."), the legend, the marker key and the controls, and through the settings it keeps in this browser
// (investseek:chart:v1). The comparison list lives in the URL (?compare=).

/** Every series the AAPL chart loads for its ten ranges: 1D, 5D, 5Y and MAX their own, 1M to 2Y one shared two-year series. */
async function aaplSeries(request: APIRequestContext): Promise<Record<ChartRange, ChartData>> {
  const requested = [...new Set(CHART_RANGES.map(seriesRange))];
  const loaded = new Map(await Promise.all(requested.map(async (range) => [range, await chartSeries(request, "AAPL", range)] as const)));
  return Object.fromEntries(CHART_RANGES.map((range) => [range, known(loaded.get(seriesRange(range)), `${range} series`)])) as Record<ChartRange, ChartData>;
}

function rangeButton(chart: Locator, range: ChartRange): Locator {
  return chart.getByRole("radiogroup", { name: "Chart range" }).getByRole("radio", { name: RANGE_LABELS[range], exact: true });
}

/**
 * How far the price scale stretches to show an investor's level (average cost, target, stop): to a level within a
 * quarter of the span of the prices in view. The rule is written down here rather than imported from the chart's
 * code, so a change to the chart's reach fails the levels test instead of moving its expectations along.
 */
const LEVEL_REACH = 0.25;

/** SAMPLE_DATA's levels for AAPL (its position's average cost, its note's target and stop), as the legend labels them. */
const AAPL_LEVELS: ReadonlyArray<{ label: string; price: number }> = [
  { label: "Avg cost", price: SAMPLE_DATA.holdings.AAPL.cost },
  { label: "Target", price: SAMPLE_DATA.notes.AAPL.target },
  { label: "Stop", price: SAMPLE_DATA.notes.AAPL.stop },
];

/** Where a level lies against the bars in view: off the chart below or above them (beyond the reach), or null (drawn). */
function levelSide(level: number, bars: readonly Bar[]): "below" | "above" | null {
  const low = Math.min(...bars.map((bar) => bar.l));
  const high = Math.max(...bars.map((bar) => bar.h));
  const reach = (high - low) * LEVEL_REACH;
  return level < low - reach ? "below" : level > high + reach ? "above" : null;
}

test.describe("chart ranges", () => {
  test("each range shows the low, high and last of its bars in the chart's summary", async ({ page, app, request }) => {
    const series = await aaplSeries(request);
    await app.goto("/stock/AAPL");
    const chart = chartPanel(page);
    const summary = chartSummaryText(page, "AAPL");
    await expect(chart.getByRole("radiogroup", { name: "Chart range" }).getByRole("radio")).toHaveText(CHART_RANGES.map((range) => RANGE_LABELS[range]));
    // A fresh browser opens on 1Y.
    await expect(rangeButton(chart, "1y")).toHaveAttribute("aria-checked", "true");
    await expect(summary).toHaveText(chartSummary("1y", series["1y"]));

    for (const range of CHART_RANGES) {
      await rangeButton(chart, range).click();
      await expect(rangeButton(chart, range)).toHaveAttribute("aria-checked", "true");
      await expect(summary).toHaveText(chartSummary(range, series[range]));
    }
    await expect.poll(async () => (await storedChartSettings(page))?.range).toBe("max");

    if (!app.isPhone) {
      // One tab stop for the ranges: arrows and Home move the choice; [ and ] step through the ranges from anywhere.
      await rangeButton(chart, "max").focus();
      await page.keyboard.press("ArrowLeft");
      await expect(rangeButton(chart, "5y")).toBeFocused();
      await expect(summary).toHaveText(chartSummary("5y", series["5y"]));
      await page.keyboard.press("Home");
      await expect(rangeButton(chart, "1d")).toHaveAttribute("aria-checked", "true");
      await expect(summary).toHaveText(chartSummary("1d", series["1d"]));
      await page.keyboard.press("]");
      await expect(rangeButton(chart, "5d")).toHaveAttribute("aria-checked", "true");
      await expect(summary).toHaveText(chartSummary("5d", series["5d"]));
      await page.keyboard.press("[");
      await page.keyboard.press("[");
      await expect(rangeButton(chart, "1d")).toHaveAttribute("aria-checked", "true");
    }
  });

  test("extended hours on 1D add the pre-market and after-hours bars, ending at the after-hours trade", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The same switch on phones; the layout adds nothing here.");
    test.skip(!AT_DEFAULT_NOW, "Written for the pinned Saturday, when Friday's after-hours bars end the 1D series.");
    const [{ quote }, day] = await Promise.all([stockDetail(request, "AAPL"), chartSeries(request, "AAPL", "1d")]);
    const last = known(day.bars.at(-1), "last 1D bar");
    expect(last.session).toBe("post");
    await app.goto("/stock/AAPL");
    const chart = chartPanel(page);
    const summary = chartSummaryText(page, "AAPL");
    await rangeButton(chart, "1d").click();
    await expect(summary).toHaveText(chartSummary("1d", day));

    const extended = chart.getByRole("switch", { name: "Extended hours" });
    await expect(extended).toHaveAttribute("aria-checked", "false");
    await extended.click();
    await expect(extended).toHaveAttribute("aria-checked", "true");
    // The last bar is Friday's after-hours trade, the price the header shows after hours.
    expect(last.c).toBe(quote.extendedPrice);
    await expect(summary).toHaveText(chartSummary("1d", day, true));
    await expect(chart).toContainText("After hours");
    await expect.poll(async () => (await storedChartSettings(page))?.extended).toBe(true);

    await extended.click();
    await expect(summary).toHaveText(chartSummary("1d", day));
    await expect.poll(async () => (await storedChartSettings(page))?.extended).toBe(false);
  });
});

test.describe("comparisons", () => {
  test("adds up to three symbols, refuses a fourth, removes one and keeps the list across a reload", async ({ page, app, request }) => {
    test.skip(app.isPhone, "Keyboard focus and the pointer resting off the canvas; the phone test covers the bar's own phone layout.");
    await app.goto("/stock/AAPL");
    const chart = chartPanel(page);
    // SPY and the sector's ETF (XLK) are offered as chips, any other symbol through the search.
    await chart.getByRole("button", { name: "SPY", exact: true }).click();
    await expect(page).toHaveURL(/\/stock\/AAPL\?compare=SPY$/);
    await chart.getByRole("button", { name: "XLK", exact: true }).click();
    await expect(page).toHaveURL(/\?compare=SPY,XLK$/);
    await chart.getByRole("button", { name: "Add symbol" }).click();
    const search = chart.getByRole("combobox", { name: "Add a symbol to compare" });
    await expect(search).toBeFocused();
    await search.fill("MSFT");
    await search.press("Enter");
    await expect(page).toHaveURL(/\?compare=SPY,XLK,MSFT$/);

    // Three is the limit: the bar says so and offers no way to add a fourth.
    await expect(chart.getByText("Up to 3 symbols", { exact: true })).toBeVisible();
    await expect(chart.getByRole("button", { name: "Add symbol" })).toHaveCount(0);
    await expect(chart.getByRole("button", { name: /^Remove \S+ from the chart$/ })).toHaveCount(3);
    for (const symbol of ["SPY", "XLK", "MSFT"]) await expect(chart.getByRole("button", { name: `Remove ${symbol} from the chart` })).toBeVisible();
    // Studies and price lines stand aside while comparing.
    await expect(chart.getByRole("button", { name: "Studies" })).toBeDisabled();
    await expectReturns(chart, request, ["AAPL", "SPY", "XLK", "MSFT"]);

    // Removing a symbol moves focus to the next chip.
    await chart.getByRole("button", { name: "Remove XLK from the chart" }).click();
    await expect(page).toHaveURL(/\?compare=SPY,MSFT$/);
    await expect(chart.getByRole("button", { name: "Remove MSFT from the chart" })).toBeFocused();
    await expect(chart.getByRole("button", { name: "Add symbol" })).toBeVisible();

    await page.reload();
    await app.settle();
    await expect(chart.getByRole("button", { name: /^Remove \S+ from the chart$/ })).toHaveCount(2);
    await expect(chart.getByRole("button", { name: "Remove SPY from the chart" })).toBeVisible();
    await expect(chart.getByRole("button", { name: "Remove MSFT from the chart" })).toBeVisible();
    await expectReturns(chart, request, ["AAPL", "SPY", "MSFT"]);

    // A link that names four symbols opens with the first three and a full bar; the fourth is drawn nowhere.
    await app.goto("/stock/AAPL?compare=SPY,XLK,MSFT,QQQ");
    await expect(chart.getByRole("button", { name: /^Remove \S+ from the chart$/ })).toHaveCount(3);
    for (const symbol of ["SPY", "XLK", "MSFT"]) await expect(chart.getByRole("button", { name: `Remove ${symbol} from the chart` })).toBeVisible();
    await expect(chart.getByText("Up to 3 symbols", { exact: true })).toBeVisible();
    await expect(chart.getByRole("button", { name: "Add symbol" })).toHaveCount(0);
    await expect(chart).not.toContainText("QQQ");
  });

  test("on a phone the comparison search keeps its suggestions on screen and adds the one tapped", async ({ page, app }) => {
    test.skip(!app.isPhone, "The phone layout of the comparison bar; the desktop test covers the limit, removal and reload.");
    await app.goto("/stock/AAPL");
    const chart = chartPanel(page);
    await chart.getByRole("button", { name: "Add symbol" }).click();
    const search = chart.getByRole("combobox", { name: "Add a symbol to compare" });
    await expect(search).toBeFocused();
    await search.fill("MSFT");
    // The suggestions open under the field, across the width of the screen.
    const suggestions = chart.getByRole("listbox");
    await expect(suggestions).toBeInViewport({ ratio: 1 });
    await suggestions.getByRole("option", { name: /^MSFT/ }).tap();
    await expect(page).toHaveURL(/\/stock\/AAPL\?compare=MSFT$/);
    await expect(chart.getByRole("button", { name: "Remove MSFT from the chart" })).toBeVisible();
    await expect(search).toHaveCount(0);
  });
});

/**
 * The legend of a comparison on 1Y: each symbol's change from the first bar of the window (the same day a year before
 * the last bar) to the last, from the dividend-adjusted closes of /api/history (two years, as the page asks for them).
 */
async function expectReturns(chart: Locator, request: APIRequestContext, symbols: readonly string[]): Promise<void> {
  const history = await api<HistoryResponse>(request, `/api/history?symbols=${symbols.join(",")}&range=2y`);
  const end = new Date(known(history.dates.at(-1), "history date"));
  const start = Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate());
  const parts = symbols.flatMap((symbol) => {
    const points = history.dates.flatMap((date, i) => {
      const close = history.closes[symbol]?.[i];
      return close === null || close === undefined || date < start ? [] : [close];
    });
    const first = known(points[0], `${symbol} close`);
    const last = known(points.at(-1), `${symbol} close`);
    return [symbol, percent((last / first - 1) * 100)];
  });
  await expect(chart).toContainText(inOrder(parts));
}

test.describe("studies", () => {
  test("the studies menu toggles indicators, and they and the range persist in this browser", async ({ page, app }) => {
    test.skip(app.isPhone, "Desktop keyboard shortcuts (L, [ and ]); the menu is the same on phones.");
    await app.goto("/stock/AAPL");
    const chart = chartPanel(page);
    // The RSI pane is drawn on the canvas; outside it, the room the chart makes for the pane is what shows.
    const area = chartArea(page, "AAPL");
    const plainHeight = known(await area.boundingBox(), "chart area").height;
    const areaHeight = async () => (await area.boundingBox())?.height;
    const menuButton = chart.getByRole("button", { name: "Studies" });
    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    const menu = chart.getByRole("group", { name: "Chart studies" });
    const studies = ["MA 20", "MA 50", "MA 200", "Bollinger (20, 2)", "RSI (14)", "Volume", "Log scale"];
    // The defaults: the 20- and 50-day averages and volume.
    for (const [name, on] of studies.map((name) => [name, ["MA 20", "MA 50", "Volume"].includes(name)] as const)) {
      await expect(menu.getByRole("switch", { name, exact: true })).toHaveAttribute("aria-checked", String(on));
    }
    for (const name of ["MA 20", "MA 200", "Bollinger (20, 2)", "RSI (14)", "Log scale"]) await menu.getByRole("switch", { name, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuButton).toBeFocused();

    // The legend names the lines on the chart.
    const legend = (label: string) => chart.getByText(label, { exact: true });
    await expect(legend("MA 200")).toBeVisible();
    await expect(legend("BB 20, 2")).toBeVisible();
    await expect(legend("MA 50")).toBeVisible();
    await expect(legend("MA 20")).toHaveCount(0);
    await expect.poll(areaHeight).toBeGreaterThan(plainHeight);
    await expect
      .poll(() => storedChartSettings(page))
      .toMatchObject({ range: "1y", ma20: false, ma50: true, ma200: true, bollinger: true, rsi: true, volume: true, log: true });

    // L toggles the log scale, [ steps back a range (1Y to YTD).
    await page.keyboard.press("l");
    await expect.poll(async () => (await storedChartSettings(page))?.log).toBe(false);
    await page.keyboard.press("[");
    await expect(rangeButton(chart, "ytd")).toHaveAttribute("aria-checked", "true");

    await page.reload();
    await app.settle();
    await expect(rangeButton(chart, "ytd")).toHaveAttribute("aria-checked", "true");
    await expect(chartSummaryText(page, "AAPL")).toHaveText(/^AAPL YTD: /);
    await expect(legend("MA 200")).toBeVisible();
    await expect(legend("BB 20, 2")).toBeVisible();
    await expect(legend("MA 20")).toHaveCount(0);
    await expect.poll(areaHeight).toBeGreaterThan(plainHeight);
    await menuButton.click();
    const expected: Record<string, boolean> = { "MA 20": false, "MA 50": true, "MA 200": true, "Bollinger (20, 2)": true, "RSI (14)": true, Volume: true, "Log scale": false };
    for (const name of studies) await expect(menu.getByRole("switch", { name, exact: true })).toHaveAttribute("aria-checked", String(expected[name]));
  });
});

test.describe("markers and levels", () => {
  test("the marker key names the dividends, splits and earnings among each range's bars", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The key is the same on phones.");
    const [earnings, series] = await Promise.all([api<EarningsDetail>(request, stockRoute("AAPL", "/earnings")), aaplSeries(request)]);
    const reports = earnings.history.flatMap((quarter) => (quarter.reportedAt ? [Date.parse(quarter.reportedAt)] : []));
    /**
     * The kinds of marker a series carries: dividends on daily and intraday bars only (weekly and monthly bars would
     * carry one on nearly every bar), splits, and earnings reports from the first bar on. There is no switch for them.
     */
    const markerKey = (data: ChartData): string => {
      const first = known(data.bars[0], "first bar").t;
      const daily = data.interval === "1d" || data.intraday;
      const kinds = [
        daily && data.dividends.length > 0 ? "D dividend" : null,
        data.splits.length > 0 ? "S split" : null,
        reports.some((t) => t >= first) ? "E earnings" : null,
      ].filter((kind): kind is string => kind !== null);
      return kinds.join(" · ");
    };
    await app.goto("/stock/AAPL");
    const chart = chartPanel(page);
    const key = chart.getByText(/^[DSE] (?:dividend|split|earnings)(?: · [DSE] (?:dividend|split|earnings))*$/);
    for (const range of ["1y", "max", "5y", "1d"] as const) {
      await rangeButton(chart, range).click();
      await expect(chartSummaryText(page, "AAPL")).toHaveText(chartSummary(range, series[range]));
      const expected = markerKey(series[range]);
      if (expected) await expect(key).toHaveText(expected);
      else await expect(key).toHaveCount(0);
    }
    // The pinned data has all three kinds somewhere: dividends on 1Y, the 4:1 split of 2020 on MAX.
    expect([markerKey(series["1y"]), markerKey(series.max)]).toEqual(["D dividend · E earnings", "S split · E earnings"]);
  });

  test("names the investor's cost, target and stop when they lie beyond the prices in view", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The legend is the same on phones.");
    await app.seedStorage(SAMPLE_DATA);
    const [year, day] = await Promise.all([chartSeries(request, "AAPL", "2y"), chartSeries(request, "AAPL", "1d")]);
    await app.goto("/stock/AAPL");
    const chart = chartPanel(page);
    // The price scale stretches to a level within reach of the prices in view; one further out stays off the chart and
    // the legend names it with its side.
    const places = new Set<string>();
    for (const [range, series] of [["1y", year], ["1d", day]] as const) {
      await rangeButton(chart, range).click();
      await expect(chartSummaryText(page, "AAPL")).toHaveText(chartSummary(range, series));
      const bars = shownBars(range, series);
      for (const level of AAPL_LEVELS) {
        const side = levelSide(level.price, bars);
        places.add(side ?? "within");
        const named = chart.getByText(new RegExp(`^${level.label} [\\d,.]+, (?:below|above) the chart$`));
        if (side) await expect(named).toHaveText(`${level.label} ${price(level.price)}, ${side} the chart`);
        else await expect(named).toHaveCount(0);
      }
    }
    // The pinned data puts levels in every place: within reach on 1Y (the target and the stop), below and above on 1D.
    if (AT_DEFAULT_NOW) expect([...places].sort()).toEqual(["above", "below", "within"]);
  });

  test("tells assistive technology where the cost, target and stop lines drawn on the chart are", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The legend is the same on phones.");
    await app.seedStorage(SAMPLE_DATA);
    const year = await chartSeries(request, "AAPL", "2y");
    await app.goto("/stock/AAPL");
    const chart = chartPanel(page);
    await expect(chartSummaryText(page, "AAPL")).toHaveText(chartSummary("1y", year));
    // The levels within reach of the 1Y prices are drawn (the target and the stop in the pinned data): each should be
    // named, with its price, where assistive technology reads it.
    const drawn = AAPL_LEVELS.filter((level) => levelSide(level.price, shownBars("1y", year)) === null);
    if (AT_DEFAULT_NOW) expect(drawn.length, "levels drawn within the 1Y prices").toBeGreaterThan(0);
    for (const level of drawn) await expect(chart).toContainText(new RegExp(`${escapeRegExp(level.label)}\\D{0,20}${escapeRegExp(price(level.price))}`));
  });
});
