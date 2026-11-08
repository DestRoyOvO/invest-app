import { PINNED_NOW } from "../support/env";
import { expect, test } from "../support/test";

// Smoke tests of the harness: the production build serves fixture data on the pinned clock, the shell says so, and
// the main pages render from it. Selectors use roles and accessible names, so they survive layout changes.

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
    // One tile per universe stock, named by symbol, company, price and change.
    await expect(heatmap.getByRole("link", { name: /^NVDA NVIDIA Corporation \d/ })).toBeVisible();
    await expect(heatmap.getByRole("link", { name: /^[A-Z.-]+ .+ [\d,.]+ [+−-]?\d/ })).toHaveCount(78);
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
    test.skip(PINNED_NOW === null, "On the real clock the market state, and with it the extended session, varies.");
    await app.goto("/stock/AAPL");
    const header = page.getByRole("region", { name: "AAPL", exact: true });
    await expect(header.getByText("After hours", { exact: true })).toBeVisible();
  });

  test("shows the not-found page for an unknown symbol", async ({ page, app, consoleErrors }) => {
    // Only the stock API's own answers: a 404 for anything else (a missing script, say) still fails the test.
    consoleErrors.allow(/status of 404 \(Not Found\) \(http:\/\/[^/]+\/api\/stock\/ZZZZ[/?)]/, "The stock API answers 404 for a symbol the data source does not know.");
    await app.goto("/stock/ZZZZ");
    await expect(page.getByRole("heading", { name: "No match for ZZZZ" })).toBeVisible();
  });
});
