import type { APIRequestContext } from "@playwright/test";

import type { Quote, QuotesResponse } from "@/types/api";
import type { AnalystActivity, EarningsDetail } from "@/types/earnings";
import type { DividendHistory, FinancialStatements, OwnershipData } from "@/types/research";

import { AT_DEFAULT_NOW } from "../support/env";
import {
  anyPrecision,
  api,
  change,
  chartPanel,
  chartSeries,
  chartSummaryPattern,
  chartSummaryText,
  clockTime,
  dataRows,
  eventDay,
  expectNoErrorStates,
  fixed,
  inOrder,
  known,
  longDate,
  MARKET_STATE,
  NEW_YORK,
  panel,
  percent,
  perShare,
  price,
  priceLinePattern,
  quoteHeader,
  quoteTabs,
  ratio,
  reportSession,
  share,
  shortDate,
  stockDetail,
  stockRoute,
  tableWithColumn,
} from "../support/quote";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Locator, type Page } from "../support/test";

// The quote page against the API routes it reads: the header of a stock (price, change, the extended-hours trade, the
// event chips and the investor's position line), the section tabs (each with a figure from its own route, deep links
// and Back), a fund's reduced set of tabs and panels, and the header and chart of an index, a crypto pair, a currency
// pair, a future and a Hong Kong listing. Expected figures are computed from the routes' answers, not written down.

const HELD: Readonly<Record<string, { shares: number; cost: number }>> = SAMPLE_DATA.holdings;

/** The tab is the current page (aria-current) and the only one. */
async function expectCurrentTab(tabs: Locator, name: string): Promise<void> {
  await expect(tabs.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
  await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
}

/** The tile of the dividends panel with the next ex-date, its amount and the payment date, from the dividends route. */
async function expectNextExDate(page: Page, dividends: DividendHistory): Promise<void> {
  const next = known(dividends.next, "next ex-dividend date");
  const amount = known(next.amount, "next dividend amount");
  const pay = known(dividends.nextPayDate, "next payment date");
  await expect(panel(page, "Dividends")).toContainText(inOrder(["Next ex-date", longDate(`${next.exDate}T00:00:00Z`), `${perShare(amount)} · Pay date ${longDate(`${pay}T00:00:00Z`)}`]));
}

test.describe("quote header", () => {
  test("shows the quote's price, change, after-hours trade, events and the investor's position", async ({ page, app, request }) => {
    await app.seedStorage(SAMPLE_DATA);
    const others = Object.keys(HELD).filter((symbol) => symbol !== "AAPL");
    const [{ quote }, { quotes }] = await Promise.all([stockDetail(request, "AAPL"), api<QuotesResponse>(request, `/api/quotes?symbols=${others.join(",")}`)]);
    const last = known(quote.price, "price");
    const dayChange = known(quote.change, "change");
    await app.goto("/stock/AAPL");
    const header = quoteHeader(page, "AAPL");

    // The price, the day's change and its percentage on one line, then the market state and the last trade's time.
    await expect(header).toContainText(inOrder([price(last), change(dayChange), percent(known(quote.changePercent, "change in percent"))]));
    await expect(header).toContainText(inOrder([MARKET_STATE[known(quote.marketState, "market state")], `${clockTime(known(quote.regularMarketTime, "trade time"), NEW_YORK)} ET`]));

    // On the pinned Saturday the market is closed and Friday's after-hours trade is the latest.
    if (AT_DEFAULT_NOW) expect(quote.extendedSession).toBe("POST");
    if (quote.extendedSession) {
      const label = quote.extendedSession === "PRE" ? "Pre-market" : "After hours";
      await expect(header).toContainText(inOrder([label, price(known(quote.extendedPrice, "extended price")), percent(known(quote.extendedChangePercent, "extended change"))]));
    }

    // The next report, with its session, and (AAPL goes ex-dividend 3 sessions after the pinned Friday) the ex-date.
    const report = known(quote.nextEarningsDate, "next earnings date");
    await expect(header).toContainText([`Reports ${eventDay(report)}`, reportSession(report), quote.earningsDateEstimated ? "est." : null].filter(Boolean).join(" · "));
    if (AT_DEFAULT_NOW) {
      await expect(header).toContainText(`Ex-dividend ${eventDay(known(quote.exDividendDate, "ex-dividend date"))} · ${perShare(known(quote.dividendAmount, "dividend amount"))}`);
    }

    // The position line: SAMPLE_DATA's 10 shares at 150.00 valued at the quote, and their share of the portfolio.
    const { shares, cost } = HELD.AAPL;
    const value = shares * last;
    const basis = shares * cost;
    const total = value + quotes.reduce((sum, other) => sum + HELD[other.symbol].shares * known(other.price, `${other.symbol} price`), 0);
    await expect(header).toContainText(
      inOrder([
        `${shares} sh @ ${price(cost)}`,
        `value ${fixed(value)}`,
        `today ${change(shares * dayChange)}`,
        `total ${change(value - basis)} (${ratio((value - basis) / basis)})`,
        `${((value / total) * 100).toFixed(0)}% of portfolio`,
      ]),
    );
    await expect(header.getByRole("button", { name: "Edit position" })).toBeVisible();
    await expect(header.getByRole("button", { name: "In watchlist" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("quote tabs", () => {
  test("each tab updates ?tab=, becomes current and shows its panel with a figure from its route; Back steps back", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The same links on phones, where the deep-link test covers the tab row scrolled into view.");
    const [financials, earnings, analysts, dividends, ownership] = await Promise.all([
      api<FinancialStatements>(request, stockRoute("AAPL", "/financials")),
      api<EarningsDetail>(request, stockRoute("AAPL", "/earnings")),
      api<AnalystActivity>(request, stockRoute("AAPL", "/analysts")),
      api<DividendHistory>(request, stockRoute("AAPL", "/dividends")),
      api<OwnershipData>(request, stockRoute("AAPL", "/ownership")),
    ]);
    await app.goto("/stock/AAPL");
    const tabs = quoteTabs(page);
    await expect(tabs.getByRole("link")).toHaveText(["Overview", "Financials", "Earnings", "Analysts", "Dividends", "Ownership"]);
    await expectCurrentTab(tabs, "Overview");

    // The tabs are links (a navigation landmark, not an ARIA tablist): Tab moves to the next one and Enter opens it.
    await tabs.getByRole("link", { name: "Overview" }).focus();
    await page.keyboard.press("Tab");
    await expect(tabs.getByRole("link", { name: "Financials" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/stock\/AAPL\?tab=financials$/);
    await expectCurrentTab(tabs, "Financials");
    // Financials: diluted EPS of each fiscal year, the latest last.
    const years = financials.annual;
    const statements = panel(page, "Financials");
    await expect(statements.getByRole("columnheader", { name: `FY${known(years.at(-1), "fiscal year").end.slice(0, 4)}` })).toBeVisible();
    await expect(statements.getByRole("row", { name: /^Diluted EPS / }).getByRole("cell")).toHaveText([
      "Diluted EPS",
      ...years.map((year) => fixed(known(year.dilutedEps, `EPS of ${year.end}`))),
      /%$/,
    ]);

    // Earnings: the latest reported quarter heads the table, with its EPS, the estimate and the surprise.
    await tabs.getByRole("link", { name: "Earnings" }).click();
    await expect(page).toHaveURL(/\?tab=earnings$/);
    await expectCurrentTab(tabs, "Earnings");
    const quarter = known(earnings.history.at(-1), "reported quarter");
    const reported = dataRows(tableWithColumn(panel(page, "Earnings"), "Surprise")).first();
    await expect(reported.getByRole("cell")).toHaveText([
      new RegExp(`^${quarter.period}(?!\\d)`),
      fixed(known(quarter.epsActual, "reported EPS")),
      fixed(known(quarter.epsEstimate, "EPS estimate")),
      ratio(known(quarter.surprise, "surprise")),
    ]);

    // Analysts: the latest rating action, newest first, with its new grade and target.
    await tabs.getByRole("link", { name: "Analysts" }).click();
    await expect(page).toHaveURL(/\?tab=analysts$/);
    await expectCurrentTab(tabs, "Analysts");
    const action = known(analysts.actions[0], "rating action");
    const target = known(action.currentTarget, "price target");
    await expect(dataRows(tableWithColumn(panel(page, "Analysts"), "Firm")).first().getByRole("cell")).toHaveText([
      shortDate(action.date, NEW_YORK),
      action.firm,
      new RegExp(`${known(action.toGrade, "grade")}$`),
      new RegExp(`(?:^|→ )${target >= 100 ? fixed(target, 0) : price(target)}$`),
    ]);

    // Dividends: the next ex-date and amount, and when it is paid.
    await tabs.getByRole("link", { name: "Dividends" }).click();
    await expect(page).toHaveURL(/\?tab=dividends$/);
    await expectCurrentTab(tabs, "Dividends");
    await expectNextExDate(page, dividends);

    // Ownership: the largest institution and its share of the company.
    await tabs.getByRole("link", { name: "Ownership" }).click();
    await expect(page).toHaveURL(/\?tab=ownership$/);
    await expectCurrentTab(tabs, "Ownership");
    const largest = known(ownership.institutions[0], "institution");
    const holder = dataRows(panel(page, "Top institutions").getByRole("table")).first();
    await expect(holder.getByRole("cell").first()).toHaveText(largest.name);
    await expect(holder.getByRole("cell").nth(1)).toHaveText(share(known(largest.pctHeld, "share held"), 2));

    // Back returns to the tabs in the order they were opened.
    await page.goBack();
    await expect(page).toHaveURL(/\?tab=dividends$/);
    await expectCurrentTab(tabs, "Dividends");
    await expectNextExDate(page, dividends);
    await page.goBack();
    await expect(page).toHaveURL(/\?tab=analysts$/);
    await expectCurrentTab(tabs, "Analysts");
    await expect(panel(page, "Analysts")).toBeVisible();
    await expectNoErrorStates(page);
  });

  test("a deep link opens its tab, scrolled into view, and Back returns to it from the overview", async ({ page, app, request }) => {
    const ownership = await api<OwnershipData>(request, stockRoute("AAPL", "/ownership"));
    await app.goto("/stock/AAPL?tab=ownership");
    const tabs = quoteTabs(page);
    await expectCurrentTab(tabs, "Ownership");
    // On a phone the tab row scrolls sideways and brings the current tab into view.
    await expect(tabs.getByRole("link", { name: "Ownership" })).toBeInViewport({ ratio: 1 });
    const largest = known(ownership.institutions[0], "institution");
    await expect(dataRows(panel(page, "Top institutions").getByRole("table")).first().getByRole("cell").first()).toHaveText(largest.name);

    await tabs.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/stock\/AAPL$/);
    await expectCurrentTab(tabs, "Overview");
    await expect(chartSummaryText(page, "AAPL")).toBeAttached();
    await page.goBack();
    await expect(page).toHaveURL(/\/stock\/AAPL\?tab=ownership$/);
    await expectCurrentTab(tabs, "Ownership");
    await expect(dataRows(panel(page, "Top institutions").getByRole("table")).first()).toContainText(largest.name);
  });

  test("a fund has only the overview and dividends tabs, and neither earnings nor analyst panels", async ({ page, app, request }) => {
    test.skip(app.isPhone, "Which tabs and panels a fund gets does not depend on the layout.");
    const dividends = await api<DividendHistory>(request, stockRoute("SPY", "/dividends"));
    // A link to a tab funds do not have lands on the overview and says why.
    await app.goto("/stock/SPY?tab=earnings");
    await expect(page.getByRole("status").filter({ hasText: /\bSPY\b.*\bEarnings\b/ })).toBeVisible();
    const tabs = quoteTabs(page);
    await expect(tabs.getByRole("link")).toHaveText(["Overview", "Dividends"]);
    await expectCurrentTab(tabs, "Overview");
    await expect(chartSummaryText(page, "SPY")).toBeAttached();

    // Fund figures instead of company ones, and no earnings or analyst panels once the page has settled.
    const header = quoteHeader(page, "SPY");
    await expect(header).toContainText("Net assets");
    await expect(header).not.toContainText("Market cap");
    const stats = panel(page, "Key statistics");
    await expect(stats.getByRole("heading", { name: "Fund", exact: true })).toBeVisible();
    await expect(stats.getByText("Expense ratio", { exact: true })).toBeVisible();
    await app.settle();
    await expect(page.getByRole("region", { name: "Earnings", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Analysts", exact: true })).toHaveCount(0);
    await expectNoErrorStates(page);

    await tabs.getByRole("link", { name: "Dividends" }).click();
    await expect(page).toHaveURL(/\/stock\/SPY\?tab=dividends$/);
    await expectCurrentTab(tabs, "Dividends");
    await expectNextExDate(page, dividends);
  });
});

interface OtherType {
  symbol: string;
  path: string;
  kind: string;
  /** A listing with the stock tabs (0700.HK); the others have the overview only. */
  tabs: boolean;
  /** Checks of its own after the header and chart. */
  check?: (page: Page, request: APIRequestContext, quote: Quote) => Promise<void>;
}

/**
 * Quote types other than US stocks. Their decimals, volume and placeholder figures are being reworked (pending in the
 * data polish branch), so prices are checked as values at whatever precision the page writes them.
 */
const OTHER_TYPES: readonly OtherType[] = [
  { symbol: "^GSPC", path: "/stock/%5EGSPC", kind: "an index", tabs: false },
  {
    symbol: "BTC-USD",
    path: "/stock/BTC-USD",
    kind: "a crypto pair",
    tabs: false,
    // Crypto trades around the clock: open on the pinned Saturday, and its 1D view is the last 24 hours, without sessions.
    check: async (page, request, quote) => {
      if (AT_DEFAULT_NOW) expect(quote.marketState).toBe("REGULAR");
      const day = await chartSeries(request, "BTC-USD", "1d");
      expect(day.continuous).toBe(true);
      expect(known(day.bars.at(-1), "last bar").t - day.bars[0].t).toBe(24 * 3_600_000 - 5 * 60_000);
      const chart = chartPanel(page);
      await chart.getByRole("radio", { name: "1D", exact: true }).click();
      await expect(chartSummaryText(page, "BTC-USD")).toHaveText(chartSummaryPattern("1d", day));
      await expect(chart.getByRole("switch", { name: "Extended hours" })).toHaveCount(0);
    },
  },
  { symbol: "EURUSD=X", path: "/stock/EURUSD%3DX", kind: "a currency pair", tabs: false },
  { symbol: "GC=F", path: "/stock/GC%3DF", kind: "a future", tabs: false },
  {
    symbol: "0700.HK",
    path: "/stock/0700.HK",
    kind: "a Hong Kong listing",
    tabs: true,
    check: async (page, _request, quote) => {
      expect(quote.currency).toBe("HKD");
      await expect(quoteHeader(page, "0700.HK").getByText("HKD", { exact: true })).toBeVisible();
    },
  },
];

test.describe("other quote types", () => {
  for (const type of OTHER_TYPES) {
    test(`${type.symbol} (${type.kind}) shows its own header and chart, in line with its routes`, async ({ page, app, request }) => {
      test.skip(app.isPhone, "Agreement with the data, not layout: the route sweep opens these pages on phones.");
      const [{ quote }, series] = await Promise.all([stockDetail(request, type.symbol), chartSeries(request, type.symbol, "2y")]);
      await app.goto(type.path);
      const header = quoteHeader(page, type.symbol);
      await expect(header.getByRole("heading", { level: 1 })).toHaveText(type.symbol);
      // The first plain number in the header is the price, followed by the day's change and its percentage.
      const last = known(quote.price, "price");
      await expect(header.getByText(/^\d{1,3}(?:,\d{3})*(?:\.\d+)?$/).first()).toHaveText(anyPrecision(last));
      await expect(header).toContainText(priceLinePattern(last, known(quote.change, "change"), known(quote.changePercent, "change in percent")));
      await expect(header).toContainText(inOrder([MARKET_STATE[known(quote.marketState, "market state")], `${clockTime(known(quote.regularMarketTime, "trade time"), NEW_YORK)} ET`]));
      // The chart opens on 1Y, a window of the two-year daily series.
      await expect(chartSummaryText(page, type.symbol)).toHaveText(chartSummaryPattern("1y", series));
      if (type.tabs) await expect(quoteTabs(page).getByRole("link", { name: "Financials" })).toBeVisible();
      else await expect(quoteTabs(page)).toHaveCount(0);
      await type.check?.(page, request, quote);
      await app.settle();
      await expectNoErrorStates(page);
    });
  }
});
