import { expect, test, type Locator, type Page, type Theme } from "../support/test";

// axe-core on the main pages in both themes: no serious or critical WCAG 2.x A/AA violation.
//
// Two known findings are excluded until the feature branches that rewrite their components are merged (fixing them
// here would only conflict with those rewrites); docs/testing.md lists them:
// - "/": the heatmap tiles' aria-label puts the company and price between the symbol and the change they show
//   (label-content-name-mismatch), and small tiles and sector headers are under 24px (target-size). wave2/overview
//   replaces this heatmap.
// - "/stock/AAPL": the chart container has role="img" around lightweight-charts' focusable attribution link
//   (nested-interactive). wave2/quote's chart hides the container from assistive technology and drops the link.

interface PageCase {
  path: string;
  ready: string;
  known: (page: Page) => Locator[];
}

const PAGES: PageCase[] = [
  { path: "/", ready: "Sector heatmap", known: (page) => [page.getByRole("region", { name: "Sector heatmap" }).getByRole("link")] },
  { path: "/stock/AAPL", ready: "AI research note", known: (page) => [page.locator('[role="img"]').filter({ has: page.locator("canvas") })] },
];

for (const theme of ["dark", "light"] as const satisfies readonly Theme[]) {
  for (const { path, ready, known } of PAGES) {
    test(`${path} has no serious accessibility violations in the ${theme} theme`, async ({ page, app, axe }) => {
      await app.setPrefs({ theme });
      await app.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("region", { name: ready, exact: true })).toBeVisible();
      await axe.check({ exclude: known(page) });
    });
  }
}
