import { getSector, SECTORS, UNIVERSE_STOCKS } from "@/lib/universe";

import { DEFAULT_NOW, E2E_NOW, PINNED_NOW } from "../support/env";
import { expectedNoise, routeCase } from "../support/routes";
import { expect, test } from "../support/test";

// Smoke tests of the harness: the production build serves fixture data on the pinned clock, the shell says so, and
// the main pages render from it. Selectors use roles and accessible names, so they survive layout changes.

/** A change in percent as the app writes it: +0.39%, −0.36% (a true minus), 0.00%. */
const CHANGE = String.raw`[+−]?\d+\.\d{2}%`;

/** Names that start with one of the symbols, followed by `rest` (a regular expression source). */
function symbolsPattern(symbols: readonly string[], rest: string): RegExp {
  return new RegExp(`^(?:${symbols.map((symbol) => symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})${rest}`);
}

test.describe("fixture data", () => {
  test("the server reports the fixture data source", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ ok: true, dataSource: "fixtures", aiConfigured: true });
  });

  test("the browser and the server share the pinned clock", async ({ page, request }) => {
    test.skip(PINNED_NOW === null, "E2E_NOW=real runs on the real clock.");
    const server = Date.parse(((await (await request.get("/api/health")).json()) as { time: string }).time);
    await page.goto("/api/health");
    const browser = await page.evaluate(() => Date.now());
    expect(server).toBeGreaterThanOrEqual(PINNED_NOW!);
    expect(Math.abs(browser - server)).toBeLessThan(60_000);
  });

  test("the overview renders the sector heatmap from fixture data", async ({ page, app }) => {
    await app.goto("/");
    const heatmap = page.getByRole("region", { name: "Sector heatmap" });
    await expect(heatmap).toBeVisible();
    if (app.isPhone) {
      // Phones get the sectors as a list, each expanding to its stocks (largest first) with name, price and change.
      await expect(heatmap.getByRole("button", { expanded: false })).toHaveCount(SECTORS.length);
      const technology = heatmap.getByRole("button", { name: new RegExp(`^Information Technology ${CHANGE}$`) });
      await technology.click();
      await expect(technology).toHaveAttribute("aria-expanded", "true");
      const constituents = heatmap.getByRole("list", { name: "Information Technology constituents" });
      await expect(constituents.getByRole("link", { name: new RegExp(`^NVDA .* [\\d,]+\\.\\d{2} ${CHANGE}$`) })).toBeVisible();
      const stocks = getSector("technology")?.stocks ?? [];
      await expect(constituents.getByRole("link", { name: symbolsPattern(stocks, " ") })).toHaveCount(stocks.length);
    } else {
      // The treemap is one listbox: an option per universe stock named "<symbol> <change>", plus the sector headers.
      const treemap = heatmap.getByRole("listbox", { name: /^Sector heatmap\./ });
      await expect(treemap.getByRole("option", { name: new RegExp(`^NVDA ${CHANGE}$`) })).toBeVisible();
      await expect(treemap.getByRole("option", { name: symbolsPattern(UNIVERSE_STOCKS, ` ${CHANGE}$`) })).toHaveCount(UNIVERSE_STOCKS.length);
    }
  });

  test("the status bar says the data is fixture data", async ({ page, app }) => {
    test.skip(app.isPhone, "The status bar is a tablet and desktop element.");
    await app.goto("/");
    await expect(page.locator("footer").getByText("Fixture data", { exact: true })).toBeVisible();
    await expect(page.getByText("Yahoo Finance · delayed")).toHaveCount(0);
  });
});

test.describe("quote page", () => {
  test("shows a price and a chart for AAPL", async ({ page, app }) => {
    await app.goto("/stock/AAPL");
    const header = page.getByRole("region", { name: "AAPL", exact: true });
    await expect(header).toContainText("Apple Inc.");
    await expect(header.getByText(/^\d{1,3}(,\d{3})*\.\d{2}$/).first()).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  test("shows Friday's after-hours trade on the pinned Saturday", async ({ page, app }) => {
    test.skip(E2E_NOW !== DEFAULT_NOW, "Written for the default E2E_NOW, a Saturday; at other times the extended session differs.");
    await app.goto("/stock/AAPL");
    const header = page.getByRole("region", { name: "AAPL", exact: true });
    await expect(header.getByText("After hours", { exact: true })).toBeVisible();
  });

  test("shows the not-found page for an unknown symbol", async ({ page, app, consoleErrors }) => {
    // The sweep's allowances for this page: the 404s of the stock API and of the document itself (once the page answers
    // 404, see e2e/support/routes.ts). A 404 for anything else (a missing script, say) still fails the test.
    for (const { pattern, reason } of expectedNoise(routeCase("/stock/ZZZZ")).console) consoleErrors.allow(pattern, reason);
    await app.goto("/stock/ZZZZ");
    await expect(page.getByRole("heading", { name: "No match for ZZZZ" })).toBeVisible();
  });
});
