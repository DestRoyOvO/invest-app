import { expect, test } from "../support/test";

// Smoke tests of the harness: the production build serves fixture data, the shell says so, and the main pages render
// from it. Selectors use roles and accessible names, so they survive layout changes.

test.describe("fixture data", () => {
  test("the server reports the fixture data source", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ ok: true, dataSource: "fixtures", aiConfigured: true });
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
    await expect(page.locator("footer").filter({ hasText: "Fixture data" })).toBeVisible();
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

  test("shows the not-found page for an unknown symbol", async ({ page, app, consoleErrors }) => {
    consoleErrors.allow(/status of 404/, "The stock API answers 404 for a symbol the data source does not know.");
    await app.goto("/stock/ZZZZ");
    await expect(page.getByRole("heading", { name: "No match for ZZZZ" })).toBeVisible();
  });
});
