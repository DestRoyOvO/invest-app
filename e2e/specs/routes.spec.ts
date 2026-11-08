import { readdirSync } from "node:fs";
import path from "node:path";

import { BASE_URL } from "../support/env";
import { ROUTES, SAMPLE_DATA, type RouteCase } from "../support/routes";
import { expect, test, type Page } from "../support/test";

// Every page of the app, on both projects, as a returning investor sees it (a watchlist, positions and a note in the
// browser, SAMPLE_DATA): the document status, no console error or uncaught page error (the suite's collector), no
// same-origin response with an error status, the page's main panel with its data, and no error or stale-data state
// once the page has settled. Expected noise is allowed per route, as narrowly as possible (e2e/support/routes.ts).
//
// A server that tries to reach the network fails the run as a whole (e2e/support/global-setup.ts).

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The page routes of app/ as patterns over URL paths: route groups left out, a dynamic segment matching any segment. */
function appPageRoutes(): Array<{ file: string; pattern: RegExp }> {
  const appDir = path.join(__dirname, "..", "..", "app");
  return readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split(path.sep).join("/"))
    .filter((entry) => /(?:^|\/)page\.(?:tsx?|jsx?|mdx)$/.test(entry))
    .map((entry) => {
      const segments = entry
        .split("/")
        .slice(0, -1)
        .filter((segment) => !/^\(.+\)$/.test(segment) && !segment.startsWith("@"));
      const source = segments
        .map((segment) => {
          if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:/.+)?";
          if (/^\[\.\.\..+\]$/.test(segment)) return "/.+";
          if (/^\[.+\]$/.test(segment)) return "/[^/]+";
          return `/${escapeRegExp(segment)}`;
        })
        .join("");
      return { file: `app/${entry}`, pattern: new RegExp(`^${source || "/"}$`) };
    });
}

/** Same-origin responses with a status of 400 or more, as "status METHOD url", from now on. */
function trackErrorResponses(page: Page): string[] {
  const origin = new URL(BASE_URL).origin;
  const seen: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === origin) seen.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return seen;
}

/** The document status, or the status of a known app bug on this route (noted on the test). */
function expectStatus(route: RouteCase, status: number | undefined): void {
  const expected = route.status ?? 200;
  const known = route.knownStatus;
  if (known && status === known.status && status !== expected) {
    test.info().annotations.push({ type: "known-app-bug", description: `${route.path} answers ${status}, not ${expected}: ${known.reason}` });
    return;
  }
  expect(status, `status of the ${route.path} document`).toBe(expected);
  if (known) test.info().annotations.push({ type: "known-status-unused", description: `${route.path} answers ${expected} now: remove its knownStatus (${known.reason})` });
}

/**
 * No error state on screen: ErrorState and the error boundary are alerts, and StaleBanner is the status line that
 * says older data is shown because a refresh failed. Next.js keeps an empty alert region of its own for announcing
 * client-side navigations (#__next-route-announcer__), which is not an error.
 */
async function expectNoErrorStates(page: Page): Promise<void> {
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Showing the last data received" })).toHaveCount(0);
}

test("every page under app/ has a case in the sweep", async () => {
  test.skip(test.info().project.name !== "desktop", "A file listing: one project is enough.");
  const paths = ROUTES.map((route) => new URL(route.path, BASE_URL).pathname);
  const pages = appPageRoutes();
  expect(pages.length).toBeGreaterThan(10);
  const missing = pages.filter(({ pattern }) => !paths.some((candidate) => pattern.test(candidate))).map(({ file }) => file);
  expect(missing, "pages without a case in e2e/support/routes.ts").toEqual([]);
});

test.describe("every page", () => {
  for (const route of ROUTES) {
    test(`${route.path} renders its data without errors`, async ({ page, app, consoleErrors }) => {
      for (const { pattern, reason } of route.console ?? []) consoleErrors.allow(pattern, reason);
      const errorResponses = trackErrorResponses(page);
      await app.seedStorage(SAMPLE_DATA);

      const response = await app.goto(route.path);
      expectStatus(route, response?.status());
      if (route.finalPath !== undefined) expect(new URL(page.url()).pathname).toBe(route.finalPath);

      await route.ready(page);
      await app.settle();
      await expectNoErrorStates(page);
      const allowed = route.responses ?? [];
      expect(
        errorResponses.filter((entry) => !allowed.some(({ pattern }) => pattern.test(entry))),
        "same-origin responses with an error status",
      ).toEqual([]);
    });
  }
});
