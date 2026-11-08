import { randomInt } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { BASE_URL, PINNED_NOW } from "./env";

// The suite's `test`: Playwright's, plus
// - its own client address per test (X-Forwarded-For; the server trusts it), so per-client limits such as the 20 AI
//   notes per 10 minutes apply to each test, as to separate visitors, rather than to the whole suite;
// - the browser clock set to the server's pinned clock (E2E_NOW), so pages compute "today" and "in 3 days" for the
//   same moment the data was made for;
// - consoleErrors (automatic): fails a test on any console error or uncaught page error (CSP violations and failed
//   requests show up as console errors), unless the test allows that message explicitly;
// - axe: runs axe-core and fails on serious or critical WCAG violations, with readable details;
// - app: navigation that waits for the app to settle, and the stored display preferences (theme, language).

export interface ConsoleErrors {
  /**
   * Allows console errors whose text or source URL matches, for this test only. Give a reason: the allowlist is the
   * place where expected noise (an intentional 404) is documented.
   */
  allow(pattern: RegExp | string, reason: string): void;
  /** Errors seen so far that no allowance covers. */
  unexpected(): string[];
}

/** A finding axe may report for these elements until the change that fixes it lands. */
export interface KnownViolation {
  /** The axe rule id, e.g. "target-size". */
  rule: string;
  /** The elements it is known for, or their containers: the rule is skipped for them and everything inside. */
  within: Locator;
  /** Why it is accepted for now and what removes it. */
  reason: string;
}

export interface A11yOptions {
  /** Limit the scan to these selectors (default: the whole page). */
  include?: string[];
  /** Known findings: only these rules, only on these elements. Every other rule still checks them. */
  known?: KnownViolation[];
}

export interface Axe {
  /** Fails when axe finds serious or critical violations of the WCAG 2.0, 2.1 or 2.2 A and AA rules. */
  check(options?: A11yOptions): Promise<void>;
}

export type Theme = "dark" | "light";
export type Lang = "en" | "zh";

export interface App {
  /** Opens a path and waits until the shell has rendered, the network is quiet and fonts are loaded. */
  goto(path: string): Promise<void>;
  /** Waits until the network is quiet and fonts are loaded. */
  settle(): Promise<void>;
  /** Stores display preferences the way the app does (cookies read on the server for the first paint). */
  setPrefs(prefs: { theme?: Theme; lang?: Lang }): Promise<void>;
  /** True in the phone project. */
  isPhone: boolean;
}

/**
 * WCAG 2.0, 2.1 and 2.2 at levels A and AA. 2.2 is included on purpose: its target-size rule (2.5.8, 24 by 24 CSS
 * pixels) is the minimum docs/design-system.md sets for every control.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/**
 * Pages the navigation already links to that arrive with feature branches not merged yet: /markets (wave2/overview),
 * /screener (wave2/screener), /portfolio (wave2/portfolio) and /calendar (wave2/calendar). Next prefetches every
 * visible link, and those prefetches answer 404 until the pages exist. Remove each entry when its branch is merged.
 */
const PENDING_PAGES = ["markets", "screener", "portfolio", "calendar"];
const PENDING_PAGE_PREFETCH = new RegExp(`status of 404 \\(Not Found\\) \\(https?://[^/]+/(${PENDING_PAGES.join("|")})\\?_rsc=`);

const QUIET_MS = 500;
const SETTLE_TIMEOUT_MS = 10_000;

/** A private address of its own for each test (10.0.0.0/8), sent as X-Forwarded-For. */
function clientAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** The server's clock now: its /api/health time (pinned at E2E_NOW and running since the server started). */
async function serverNow(request: APIRequestContext): Promise<number> {
  const response = await request.get("/api/health");
  const time = Date.parse(((await response.json()) as { time?: string }).time ?? "");
  if (Number.isNaN(time)) throw new Error("/api/health reported no time.");
  return time;
}

/**
 * Counts the app's data requests in flight (fetches to /api/). Route prefetches are left out: Playwright's own
 * "networkidle" waits for them too, and a prefetch of a missing page can stay open.
 */
function trackApiRequests(page: Page): { inflight: () => number; lastChange: () => number } {
  let inflight = 0;
  let lastChange = Date.now();
  const isApi = (url: string, type: string) => (type === "fetch" || type === "xhr") && new URL(url).pathname.startsWith("/api/");
  const done = (request: { url(): string; resourceType(): string }) => {
    if (!isApi(request.url(), request.resourceType())) return;
    inflight = Math.max(0, inflight - 1);
    lastChange = Date.now();
  };
  page.on("request", (request) => {
    if (!isApi(request.url(), request.resourceType())) return;
    inflight++;
    lastChange = Date.now();
  });
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return { inflight: () => inflight, lastChange: () => lastChange };
}

async function settle(page: Page, api: ReturnType<typeof trackApiRequests>): Promise<void> {
  await page.waitForLoadState("load");
  // The app keeps polling, so "idle" means no data request in flight for half a second, within 10 seconds.
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline && (api.inflight() > 0 || Date.now() - api.lastChange() < QUIET_MS)) {
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function setPrefs(context: BrowserContext, prefs: { theme?: Theme; lang?: Lang }): Promise<void> {
  const cookies = [
    ...(prefs.theme ? [{ name: "is_theme", value: prefs.theme }] : []),
    ...(prefs.lang ? [{ name: "is_lang", value: prefs.lang }] : []),
  ];
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: BASE_URL, sameSite: "Lax" as const })));
}

/** One line per failing element (at most eight per rule) with axe's summary of what to fix. */
function axeReport(url: string, violations: ReadonlyArray<{ id: string; impact?: string | null; help: string; helpUrl: string; nodes: ReadonlyArray<{ target: unknown[]; failureSummary?: string }> }>): string {
  const rules = violations.map((violation) => {
    const nodes = violation.nodes
      .slice(0, 8)
      .map((node) => `    - ${node.target.join(" ")}\n      ${(node.failureSummary ?? "").replace(/\n/g, "\n      ")}`)
      .join("\n");
    const more = violation.nodes.length > 8 ? `\n    ... and ${violation.nodes.length - 8} more` : "";
    return `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.helpUrl}\n${nodes}${more}`;
  });
  return `Serious or critical accessibility violations on ${url}:\n\n${rules.join("\n\n")}`;
}

export const test = base.extend<{ consoleErrors: ConsoleErrors; axe: Axe; app: App }>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    await provide({ ...extraHTTPHeaders, "x-forwarded-for": clientAddress() });
  },

  context: async ({ context, request }, provide) => {
    // The clock runs on from the server's current time, like the server's own (Playwright's clock flows in real time).
    if (PINNED_NOW !== null) await context.clock.install({ time: await serverNow(request) });
    await provide(context);
  },

  consoleErrors: [
    async ({ page }, provide, testInfo) => {
      const seen: string[] = [];
      const allowances: Array<{ pattern: RegExp | string; reason: string }> = [
        { pattern: PENDING_PAGE_PREFETCH, reason: "Navigation prefetches of pages that are not merged yet." },
      ];
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const url = message.location().url;
        seen.push(`${message.text()}${url ? ` (${url})` : ""}`);
      });
      page.on("pageerror", (error) => seen.push(`Uncaught ${error.name}: ${error.message}`));
      const matches = (entry: string) =>
        allowances.some(({ pattern }) => (typeof pattern === "string" ? entry.includes(pattern) : pattern.test(entry)));
      const errors: ConsoleErrors = {
        allow: (pattern, reason) => allowances.push({ pattern, reason }),
        unexpected: () => seen.filter((entry) => !matches(entry)),
      };
      await provide(errors);
      const unexpected = errors.unexpected();
      if (unexpected.length > 0) {
        await testInfo.attach("console-errors.txt", { body: seen.join("\n"), contentType: "text/plain" });
        throw new Error(`Unexpected console errors:\n- ${unexpected.join("\n- ")}`);
      }
    },
    { auto: true },
  ],

  axe: async ({ page }, provide, testInfo) => {
    await provide({
      async check(options: A11yOptions = {}) {
        const known = options.known ?? [];
        // Mark each known finding's elements, so the violations axe reports can be matched to them afterwards.
        for (const [index, finding] of known.entries()) {
          await finding.within.evaluateAll((elements, mark) => {
            for (const element of elements) element.setAttribute("data-axe-known", `${element.getAttribute("data-axe-known") ?? ""} ${mark}`.trim());
          }, `k${index}`);
        }
        // @axe-core/playwright types its page with its own playwright-core peer (npm installed a newer one); at run
        // time it only calls the page's public methods, so the test runner's page is what it needs.
        let builder = new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(WCAG_TAGS);
        for (const selector of options.include ?? []) builder = builder.include(selector);
        const results = await builder.analyze();
        await testInfo.attach("axe-violations.json", { body: JSON.stringify(results.violations, null, 2), contentType: "application/json" });

        const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
        // For each node, whether it lies inside an element marked for a known finding of the same rule.
        const targets = serious.flatMap((violation) => violation.nodes.map((node) => ({ rule: violation.id, target: node.target })));
        const marks = known.map((finding, index) => ({ rule: finding.rule, mark: `k${index}` }));
        const covered = await page.evaluate(
          ({ targets, marks }) =>
            targets.map(({ rule, target }) => {
              // Nodes inside frames or shadow roots have nested selectors; the app has none, and they are never known.
              if (target.length !== 1 || typeof target[0] !== "string") return false;
              const element = document.querySelector(target[0]);
              return marks.some((entry) => entry.rule === rule && element?.closest(`[data-axe-known~="${entry.mark}"]`) != null);
            }),
          { targets: targets.map(({ rule, target }) => ({ rule, target: target as unknown[] })), marks },
        );
        let position = 0;
        const blocking = serious
          .map((violation) => ({ ...violation, nodes: violation.nodes.filter(() => !covered[position++]) }))
          .filter((violation) => violation.nodes.length > 0);

        const used = new Set(targets.filter((_, i) => covered[i]).map(({ rule }) => rule));
        for (const finding of known.filter((entry) => !used.has(entry.rule))) {
          testInfo.annotations.push({ type: "axe-known-unused", description: `${finding.rule} no longer occurs on ${page.url()}: remove it (${finding.reason})` });
        }
        if (blocking.length > 0) throw new Error(axeReport(page.url(), blocking));
      },
    });
  },

  app: async ({ page, context }, provide, testInfo) => {
    const api = trackApiRequests(page);
    await provide({
      async goto(path: string) {
        await page.goto(path);
        await expect(page.locator("main#main, main").first()).toBeVisible();
        await settle(page, api);
      },
      settle: () => settle(page, api),
      setPrefs: (prefs) => setPrefs(context, prefs),
      isPhone: testInfo.project.name === "phone",
    });
  },
});

export { expect };
export type { Locator, Page };
