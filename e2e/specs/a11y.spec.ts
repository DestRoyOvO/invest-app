import { expect, test, type KnownViolation, type Page, type Theme } from "../support/test";

// axe-core on the main pages in both themes: no serious or critical violation of the WCAG 2.0, 2.1 and 2.2 A and AA
// rules.
//
// Three known findings are accepted, each for its rule and its elements only (every other rule, color contrast
// included, still checks those elements), until the feature branches that rewrite the components are merged; fixing
// them here would only conflict with those rewrites. docs/testing.md lists them. A known finding that no longer
// occurs is reported as an "axe-known-unused" annotation, the cue to remove it.

interface PageCase {
  path: string;
  ready: string;
  known: (page: Page) => KnownViolation[];
}

const PAGES: PageCase[] = [
  {
    path: "/",
    ready: "Sector heatmap",
    known: (page) => {
      const heatmap = page.getByRole("region", { name: "Sector heatmap" });
      return [
        {
          rule: "label-content-name-mismatch",
          within: heatmap,
          reason: "the tiles' aria-label puts the company and price between the symbol and the change they show; wave2/overview replaces this heatmap",
        },
        { rule: "target-size", within: heatmap, reason: "small tiles and the 17px sector headers; wave2/overview replaces this heatmap" },
      ];
    },
  },
  {
    path: "/stock/AAPL",
    ready: "AI research note",
    known: (page) => [
      {
        rule: "nested-interactive",
        within: page.locator('[role="img"]').filter({ has: page.locator("canvas") }),
        reason: "the chart container has role=img around lightweight-charts' focusable attribution link; wave2/quote's chart hides the container and drops the link",
      },
    ],
  },
];

for (const theme of ["dark", "light"] as const satisfies readonly Theme[]) {
  for (const { path, ready, known } of PAGES) {
    test(`${path} has no serious accessibility violations in the ${theme} theme`, async ({ page, app, axe }) => {
      await app.setPrefs({ theme });
      await app.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("region", { name: ready, exact: true })).toBeVisible();
      await axe.check({ known: known(page) });
    });
  }
}
