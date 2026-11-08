import { tpl } from "@/lib/format";
import { MESSAGES } from "@/lib/i18n/messages";
import { UNIVERSE_STOCKS } from "@/lib/universe";

import { routeCase } from "../support/routes";
import { capture, scrollToFit, scrollToTop, stage, type Look } from "../support/shots";
import { expect, test, type Lang, type Page } from "../support/test";

import { DEMO_DATA } from "./demo-data";

// The README screenshots (docs/screenshots): nine pages of the fixture-data server as the demo investor sees them
// (demo-data.ts), each opened, checked to show its data and captured at the size of the viewport. The alt texts of the
// screenshot block in README.md and README.zh-CN.md describe what each image shows: change them with the shot.
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
  await expect(region(page, t.port.myDay.title)).toContainText(tpl(t.watchlist.positionsCount, { n: POSITIONS }));
  await expect(region(page, t.calendar.weekAhead).getByRole("listitem").first()).toBeVisible();
  await expect(region(page, t.market.board)).toContainText(PRICE);
}

test.describe("README screenshots", () => {
  test("overview-dark-en.png: the market overview, personal first", async ({ page, app, request }) => {
    await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/");
    await routeCase("/").ready(page);
    await overviewReady(page, "en");
    await expect(dataRows(page, MESSAGES.en.market.watchlist)).toHaveCount(DEMO_DATA.watchlist.length);
    await capture(page, app, "overview-dark-en.png", "en");
  });

  test("quote-dark-en.png: the AAPL quote page with the chart workstation", async ({ page, app, request }) => {
    await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/stock/AAPL");
    await routeCase("/stock/AAPL").ready(page);
    // The header, the position line and the whole chart panel, down to its footer.
    await scrollToFit(region(page, MESSAGES.en.stock.chart), page.getByRole("heading", { level: 1, name: "AAPL" }));
    await capture(page, app, "quote-dark-en.png", "en");
  });

  test("portfolio-dark-en.png: portfolio analytics against SPY", async ({ page, app, request }) => {
    await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/portfolio");
    await routeCase("/portfolio").ready(page);
    // Down to the drawdown chart's axis, so the fold falls below it.
    const drawdown = region(page, MESSAGES.en.port.analytics).getByRole("img", { name: MESSAGES.en.port.overview.drawdownCaption });
    await scrollToFit(drawdown, page.getByText(tpl(MESSAGES.en.port.kpi.value, { currency: "USD" }), { exact: true }).first());
    await capture(page, app, "portfolio-dark-en.png", "en");
  });

  test("calendar-dark-en.png: the events calendar", async ({ page, app, request }) => {
    await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/calendar");
    await routeCase("/calendar").ready(page);
    // Four weeks fill the page with the holdings' and the watchlist's reports and ex-dividend dates.
    await page.getByRole("radio", { name: MESSAGES.en.calendar.range.month }).click();
    await expect(page.getByRole("radio", { name: MESSAGES.en.calendar.range.month })).toBeChecked();
    await capture(page, app, "calendar-dark-en.png", "en");
  });

  test("screener-dark-en.png: the screener", async ({ page, app, request }) => {
    await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/screener");
    await routeCase("/screener").ready(page);
    await capture(page, app, "screener-dark-en.png", "en");
  });

  test("lab-dark-en.png: the factor lab", async ({ page, app, request }) => {
    await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/lab");
    await routeCase("/lab").ready(page);
    await capture(page, app, "lab-dark-en.png", "en");
  });

  test("markets-dark-en.png: world markets and the Treasury curve", async ({ page, app, request }) => {
    await stage(page, app, request, { look: DARK_EN, data: DEMO_DATA });
    await app.goto("/markets");
    await routeCase("/markets").ready(page);
    await capture(page, app, "markets-dark-en.png", "en");
  });

  test("overview-light-zh.png: the overview in Chinese, light theme, red up", async ({ page, app, request }) => {
    await stage(page, app, request, { look: LIGHT_ZH, data: DEMO_DATA });
    await app.goto("/");
    await overviewReady(page, "zh");
    // From breadth down: the heatmap in red-up colors, next to the headlines and the AI brief.
    const heatmap = region(page, MESSAGES.zh.market.heatmap);
    await expect(heatmap.getByRole("option", { name: /^NVDA / })).toBeVisible();
    await scrollToTop(region(page, tpl(MESSAGES.zh.markets.breadth.title, { n: UNIVERSE_STOCKS.length })));
    await capture(page, app, "overview-light-zh.png", "zh");
  });

  test("mobile-light-zh.png: the overview on a phone", { tag: "@phone" }, async ({ page, app, request }) => {
    await stage(page, app, request, { look: LIGHT_ZH, data: DEMO_DATA });
    await app.goto("/");
    await overviewReady(page, "zh");
    await capture(page, app, "mobile-light-zh.png", "zh");
  });
});
