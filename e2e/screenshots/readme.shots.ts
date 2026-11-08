import { formatInteger, formatPrice, tpl } from "@/lib/format";
import { MESSAGES } from "@/lib/i18n/messages";
import { plural } from "@/lib/i18n/plural";

import { routeCase } from "../support/routes";
import { stage, type Look } from "../support/shots";
import { expect, test, type Lang, type Page } from "../support/test";

import { DEMO_DATA } from "./demo-data";

// The README screenshots (docs/screenshots): nine pages of the fixture-data server as the demo investor sees them
// (demo-data.ts), each opened, checked to show what its image promises and captured at the size of the viewport.
// images.ts lists them; the alt texts of the screenshot block in README.md and README.zh-CN.md describe what each
// image shows: change them with the shot.
//
//   npm run screenshots                                  # into docs/screenshots
//   SCREENSHOTS_DIR=/tmp/shots npm run screenshots       # elsewhere

const DARK_EN: Look = { theme: "dark", lang: "en", updown: "intl" };
const LIGHT_ZH: Look = { theme: "light", lang: "zh", updown: "cn" };

/** A price as the app formats it: 1,234.56. */
const PRICE = /\d{1,3}(?:,\d{3})*\.\d{2}/;
const POSITIONS = Object.keys(DEMO_DATA.holdings).length;

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true }).first();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A message template as a pattern for its text: "Reports {date}" finds "Reports Mon Nov 16 · after close". */
function template(message: string): RegExp {
  return new RegExp(`^${message.split(/\{\w+\}/).map(escapeRegExp).join(".+")}`);
}

/** Data rows of the tables inside a panel: rows of cells, not the one full-width cell of a skeleton or an empty table. */
function dataRows(page: Page, panel: string) {
  return region(page, panel)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") })
    .filter({ hasNot: page.locator("td[colspan]") });
}

/** The overview's panels with their data, in either language: My day with every position, the week ahead, the markets. */
async function overviewReady(page: Page, lang: Lang): Promise<void> {
  const t = MESSAGES[lang];
  await expect(region(page, t.port.myDay.title)).toContainText(plural(t.watchlist.positionsCount, POSITIONS));
  await expect(region(page, t.calendar.weekAhead).getByRole("listitem").first()).toBeVisible();
  await expect(region(page, t.market.board)).toContainText(PRICE);
}

/**
 * What the quote image promises: the after-hours trade, the next report and the ex-dividend date, the demo
 * investor's position, and the chart with their cost, target and stop.
 */
async function quoteReady(page: Page): Promise<void> {
  const t = MESSAGES.en;
  const { shares, cost } = DEMO_DATA.holdings.AAPL;
  const { target, stop } = DEMO_DATA.notes.AAPL;
  const header = region(page, "AAPL");
  await expect(header.getByText(t.stock.afterHours, { exact: true })).toBeVisible();
  await expect(header.getByText(template(t.stock.events.reports))).toBeVisible();
  await expect(header.getByText(template(t.stock.events.exDividendAmount))).toBeVisible();
  await expect(header.getByText(tpl(t.stock.position.shares, { shares: formatInteger(shares), cost: formatPrice(cost) }), { exact: true })).toBeVisible();
  // The chart draws the cost from the position and the target and stop from the note, which the notes panel below the
  // fold shows too. It names a level in its legend instead of drawing it when the level lies far outside its prices.
  const notes = region(page, t.notes.title);
  await expect(notes.getByRole("textbox", { name: t.notes.target, exact: true })).toHaveValue(String(target));
  await expect(notes.getByRole("textbox", { name: t.notes.stop, exact: true })).toHaveValue(String(stop));
  const chart = region(page, t.stock.chart);
  for (const side of ["above", "below"] as const) {
    await expect(chart.getByText(template(t.chart.offscreen[side])), `levels named ${side} the chart instead of drawn`).toHaveCount(0);
  }
}

test.describe("README screenshots", () => {
  test("overview-dark-en.png: the market overview, personal first", async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/");
    await routeCase("/").ready(page);
    await overviewReady(page, "en");
    await expect(dataRows(page, MESSAGES.en.market.watchlist)).toHaveCount(DEMO_DATA.watchlist.length);
    await shot.capture("overview-dark-en.png");
  });

  test("quote-dark-en.png: the AAPL quote page with the chart workstation", async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/stock/AAPL");
    await routeCase("/stock/AAPL").ready(page);
    await quoteReady(page);
    // The header, the position line and the whole chart panel, down to its footer.
    await shot.scrollToFit(region(page, MESSAGES.en.stock.chart), page.getByRole("heading", { level: 1, name: "AAPL" }));
    await shot.capture("quote-dark-en.png");
  });

  test("portfolio-dark-en.png: portfolio analytics against SPY", async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/portfolio");
    await routeCase("/portfolio").ready(page);
    // Down to the drawdown chart's axis, so the fold falls below it.
    const drawdown = region(page, MESSAGES.en.port.analytics).getByRole("img", { name: MESSAGES.en.port.overview.drawdownCaption });
    await shot.scrollToFit(drawdown, page.getByText(tpl(MESSAGES.en.port.kpi.value, { currency: "USD" }), { exact: true }).first());
    await shot.capture("portfolio-dark-en.png");
  });

  test("calendar-dark-en.png: the events calendar", async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/calendar");
    await routeCase("/calendar").ready(page);
    // Four weeks fill the page with the holdings' and the watchlist's reports and ex-dividend dates.
    await page.getByRole("radio", { name: MESSAGES.en.calendar.range.month }).click();
    await expect(page.getByRole("radio", { name: MESSAGES.en.calendar.range.month })).toBeChecked();
    await shot.capture("calendar-dark-en.png");
  });

  test("screener-dark-en.png: the screener", async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/screener");
    await routeCase("/screener").ready(page);
    await shot.capture("screener-dark-en.png");
  });

  test("lab-dark-en.png: the factor lab", async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/lab");
    await routeCase("/lab").ready(page);
    await shot.capture("lab-dark-en.png");
  });

  test("markets-dark-en.png: world markets and the Treasury curve", async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/markets");
    await routeCase("/markets").ready(page);
    await shot.capture("markets-dark-en.png");
  });

  test("overview-light-zh.png: the overview in Chinese, light theme, red up", async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: LIGHT_ZH, data: DEMO_DATA });
    await app.goto("/");
    await overviewReady(page, "zh");
    await expect(region(page, MESSAGES.zh.market.heatmap).getByRole("option", { name: /^NVDA / })).toBeVisible();
    // The headlines at the top of the right column, beside breadth and the heatmap in red-up colors on the left: an
    // offset of the left column's panels would cut a headline in two.
    await shot.scrollToTop(region(page, MESSAGES.zh.market.news), 16);
    await shot.capture("overview-light-zh.png");
  });

  test("mobile-light-zh.png: the overview on a phone", { tag: "@phone" }, async ({ page, app, request }) => {
    const shot = await stage(page, app, request, { look: LIGHT_ZH, data: DEMO_DATA });
    await app.goto("/");
    await overviewReady(page, "zh");
    await shot.capture("mobile-light-zh.png");
  });
});
