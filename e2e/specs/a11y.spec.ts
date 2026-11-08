import { expectedNoise, ROUTES, SAMPLE_DATA } from "../support/routes";
import { expect, test, type KnownViolation, type Page, type Theme } from "../support/test";

// axe-core on every page of the route sweep (e2e/support/routes.ts; the redirect aside), the open command bar and the
// open AI chat drawer, in both themes on both projects: no serious or critical violation of the WCAG 2.0, 2.1 and 2.2
// A and AA rules. The pages start from the sweep's sample data (a watchlist, positions and a note), so the personal
// pages are checked with their tables rather than their empty states, and each page waits for its data first.
//
// A known finding is accepted for its rule and its elements only (every other rule, color contrast included, still
// checks those elements), with the reason and the file and branch that own the fix; docs/testing.md lists them. A known
// finding that no longer occurs is reported as an "axe-known-unused" annotation, the cue to remove it; for a finding
// that depends on the day's data (dataDependent), only at the default E2E_NOW, where it was seen.

const KNOWN: Readonly<Record<string, (page: Page, phone: boolean) => KnownViolation[]>> = {
  // On phones the tiles of this treemap are too small to show their change.
  "/sector/technology": (page, phone) =>
    phone
      ? []
      : [
          {
            rule: "label-content-name-mismatch",
            within: page.getByRole("region", { name: "Sector heatmap" }).getByRole("option", { name: /^\S+ \d+\.\d{2}%$/ }),
            reason:
              'a heatmap tile whose change has no sign ("CSCO 0.00%") shows the symbol and the change in two spans without a space between them, which axe reads as "CSCO0.00%"; components/market/SectorHeatmap.tsx (int/pages)',
            // Only a tile whose price did not move shows it: CSCO on the default instant's Friday, other tiles (or none)
            // on other days, while the bug stays.
            dataDependent: true,
          },
        ],
};

const PAGES = ROUTES.filter((route) => route.finalPath === undefined);

for (const theme of ["dark", "light"] as const satisfies readonly Theme[]) {
  test.describe(`${theme} theme`, () => {
    for (const route of PAGES) {
      test(`${route.path} has no serious accessibility violations`, async ({ page, app, axe, consoleErrors }) => {
        for (const { pattern, reason } of expectedNoise(route).console) consoleErrors.allow(pattern, reason);
        await app.setPrefs({ theme });
        await app.seedStorage(SAMPLE_DATA);
        await app.goto(route.path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await route.ready(page);
        await app.settle();
        await axe.check({ known: KNOWN[route.path]?.(page, app.isPhone) ?? [] });
      });
    }

    test("the open command bar has no serious accessibility violations", async ({ page, app, axe }) => {
      await app.setPrefs({ theme });
      await app.goto("/");
      // "/" opens the command bar from anywhere outside a text field.
      await page.keyboard.press("/");
      const dialog = page.getByRole("dialog", { name: "Command bar" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("option").first()).toBeVisible();
      await axe.check();
      // A company name brings matches from the symbol search (/api/search) next to the functions.
      const search = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/search" && response.status() === 200);
      await dialog.getByRole("combobox", { name: "Command bar" }).fill("apple");
      await search;
      await expect(dialog.getByRole("option", { name: /\bAAPL\b/ }).first()).toBeVisible();
      await app.settle();
      await axe.check();
    });

    test("the open AI chat drawer has no serious accessibility violations", async ({ page, app, axe }) => {
      await app.setPrefs({ theme });
      await app.goto("/");
      await page.getByRole("button", { name: /Open research assistant$/ }).click();
      const drawer = page.getByRole("dialog", { name: "Research assistant" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("textbox")).toBeVisible();
      await axe.check();
    });
  });
}
