import { readdirSync } from "node:fs";
import path from "node:path";

import { MESSAGES } from "@/lib/i18n/messages";

import { BASE_URL } from "../support/env";
import { expectedNoise, ROUTES, SAMPLE_DATA, type RouteCase } from "../support/routes";
import { expect, test, type Page } from "../support/test";

// Every page of the app, on both projects, as a returning investor sees it (a watchlist, positions and a note in the
// browser, SAMPLE_DATA): the document status, no console error or uncaught page error (the suite's collector), no
// same-origin response with an error status, the page's main panel with its data, no error or stale-data state once
// the page has settled, and the API routes the page is known to read answering 200 (every panel route of the quote
// page among them). Expected noise is allowed per route, as narrowly as possible (e2e/support/routes.ts,
// expectedNoise: a not-found page's own 404 follows from the status the case expects).
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

/**
 * Same-origin responses from now on: those with a status of 400 or more, as "status METHOD url", and the paths of the
 * API routes that answered 200.
 */
function trackResponses(page: Page): { errors: string[]; loadedApis: Set<string> } {
  const origin = new URL(BASE_URL).origin;
  const errors: string[] = [];
  const loadedApis = new Set<string>();
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin) return;
    if (response.status() >= 400) errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    else if (response.status() === 200 && url.pathname.startsWith("/api/")) loadedApis.add(url.pathname);
  });
  return { errors, loadedApis };
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
 * says older data is shown because a refresh failed (its text comes from the app's own messages, so a reworded banner
 * is still found). Next.js keeps an empty alert region of its own for announcing client-side navigations
 * (#__next-route-announcer__), which is not an error.
 */
async function expectNoErrorStates(page: Page): Promise<void> {
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: MESSAGES.en.common.staleData })).toHaveCount(0);
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
      const noise = expectedNoise(route);
      for (const { pattern, reason } of noise.console) consoleErrors.allow(pattern, reason);
      const responses = trackResponses(page);
      await app.seedStorage(SAMPLE_DATA);

      const response = await app.goto(route.path);
      expectStatus(route, response?.status());
      if (route.finalPath !== undefined) expect(new URL(page.url()).pathname).toBe(route.finalPath);

      await route.ready(page);
      await app.settle();
      await expectNoErrorStates(page);
      expect(
        responses.errors.filter((entry) => !noise.responses.some(({ pattern }) => pattern.test(entry))),
        "same-origin responses with an error status",
      ).toEqual([]);
      expect((route.apis ?? []).filter((api) => !responses.loadedApis.has(api)), "API routes the page did not load with status 200").toEqual([]);
    });
  }
});
