import path from "node:path";

import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";

import { ALERTS_STORAGE_KEY, type AlertRule } from "@/lib/alerts";
import { MESSAGES } from "@/lib/i18n/messages";
import { htmlAttributes, PREF_COOKIES, type Density, type UpDown } from "@/lib/prefs";

import { README_IMAGES, type ReadmeImage } from "../screenshots/images";

import { BASE_URL, PINNED_NOW } from "./env";
import { expect, test, type App, type Lang, type StoredData, type Theme } from "./test";

// Helpers of `npm run screenshots` (e2e/screenshots): each README image is a page of the fixture-data server, opened
// with the demo investor's data and display preferences, held still (the browser clock stopped at the server's time,
// reduced motion, every panel loaded, no data request in flight, fonts loaded, no focus ring, no hover) and captured
// at the size of the viewport. docs/testing.md (Screenshots) describes the command.

/** Where the images go: SCREENSHOTS_DIR (absolute, or relative to the repository root), docs/screenshots by default. */
export const SCREENSHOTS_DIR = path.resolve(__dirname, "..", "..", process.env.SCREENSHOTS_DIR?.trim() || path.join("docs", "screenshots"));

/** The display preferences of a shot: theme, language and price colors (intl: green up; cn: red up). */
export interface Look {
  theme: Theme;
  lang: Lang;
  updown: UpDown;
}

/** What the demo investor keeps in the browser: the suite's stores (watchlist, positions, notes) and alert rules. */
export interface DemoData extends StoredData {
  alerts?: readonly AlertRule[];
}

/** A page made ready for its image by stage(). */
export interface Shot {
  /**
   * Scrolls main so that `target` starts at its top edge, or with `slack`, at the offset within that many pixels of
   * it, nearest to it, where the edge cuts no line of text in either column. Waits for the panels' data first.
   */
  scrollToTop(target: Locator, slack?: number): Promise<void>;
  /**
   * Scrolls main down just far enough for `target` to end at its bottom edge (not at all when it already fits), so the
   * fold cuts below a panel rather than through a line of text; but never so far that `keep`, near the top, loses a
   * pixel. Waits for the panels' data first.
   */
  scrollToFit(target: Locator, keep: Locator): Promise<void>;
  /** Captures the viewport into SCREENSHOTS_DIR/<file> once the page holds still; resolves to the file's path. */
  capture(file: ReadmeImage): Promise<string>;
}

/** Every shot shows the default row height. */
const DENSITY: Density = "comfortable";

/**
 * How long a capture waits for the page's data requests to finish. A request still open after it fails the shot,
 * rather than leave its panel half drawn (a sparkline draws nothing until its data arrives, which no skeleton shows).
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** The room scrollToTop keeps between the top edge and the first line of text below it. */
const TEXT_MARGIN_PX = 6;

/** The server's clock: its /api/health time (the screenshot server's clock stands still at E2E_NOW). */
async function serverTime(request: APIRequestContext): Promise<number> {
  const health = (await (await request.get("/api/health")).json()) as { time?: string };
  const time = Date.parse(health.time ?? "");
  if (Number.isNaN(time)) throw new Error("/api/health reported no time.");
  return time;
}

/** Keeps the page's data requests in flight (fetches to /api/), from before its first load on: their paths and queries. */
function trackApiRequests(page: Page): () => string[] {
  const open = new Set<Request>();
  const isApi = (request: Request) => (request.resourceType() === "fetch" || request.resourceType() === "xhr") && new URL(request.url()).pathname.startsWith("/api/");
  page.on("request", (request) => {
    if (isApi(request)) open.add(request);
  });
  page.on("requestfinished", (request) => open.delete(request));
  page.on("requestfailed", (request) => open.delete(request));
  return () => [...open].map((request) => {
    const url = new URL(request.url());
    return `${url.pathname}${url.search}`;
  });
}

/** Waits until no data request is in flight, and fails, naming them, when some are still open after REQUEST_TIMEOUT_MS. */
async function requestsDone(inflight: () => string[]): Promise<void> {
  await expect.poll(inflight, { message: "data requests in flight", timeout: REQUEST_TIMEOUT_MS }).toEqual([]);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Waits until nothing on the page is still arriving or moving: no data request in flight, every declared font face
 * loaded, no skeleton or "Loading" text, no error state, stale-data banner or toast, every image decoded.
 */
async function holdStill(page: Page, app: App, lang: Lang, inflight: () => string[]): Promise<void> {
  await app.settle();
  await requestsDone(inflight);
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((face) => face.load().catch(() => face)));
    await document.fonts.ready;
  });
  const loading = new RegExp([MESSAGES.en.common.loading, MESSAGES.zh.common.loading].map(escapeRegExp).join("|"));
  await expect(page.locator('.animate-pulse, [aria-busy="true"]').filter({ visible: true }), "loading skeletons").toHaveCount(0);
  await expect(page.getByText(loading).filter({ visible: true }), "loading text").toHaveCount(0);
  // ErrorState and the error boundary are alerts; Next.js keeps an empty one of its own for route announcements.
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ visible: true }), "error states").toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: MESSAGES[lang].common.staleData }), "stale-data banners").toHaveCount(0);
  // Toasts sit in a polite live region and carry a close button.
  await expect(page.locator("[aria-live] button").filter({ visible: true }), "toasts").toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete)), { message: "images decoded" }).toBe(true);
  await app.settle();
}

/** See Shot.scrollToTop. */
async function scrollMainToTop(target: Locator, slack: number): Promise<void> {
  const offset = await target.evaluate(
    (element, { slack, margin }) => {
      const main = element.closest("main");
      if (!main) throw new Error("The element is not inside main.");
      // Positions in main's scroll content: the target's top, and every line of text the reader can see.
      const origin = main.getBoundingClientRect().top - main.scrollTop;
      const anchor = Math.round(element.getBoundingClientRect().top - origin);
      const lines: Array<[number, number]> = [];
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        const box = parent?.getBoundingClientRect();
        // Blank text, hidden text, and text for screen readers only (a box of one pixel) take no room on screen.
        if (!node.textContent?.trim() || !parent || !box || box.width <= 1 || box.height <= 1 || !parent.checkVisibility({ visibilityProperty: true })) continue;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) lines.push([rect.top - origin, rect.bottom - origin]);
      }
      // An offset is clear when no line straddles it and the next one starts at least `margin` pixels below it.
      const clear = (y: number) => !lines.some(([top, bottom]) => top - margin < y && y < bottom);
      for (let distance = 0; distance <= slack; distance++) {
        for (const y of distance === 0 ? [anchor] : [anchor - distance, anchor + distance]) {
          if (!clear(y)) continue;
          main.scrollTop = y;
          if (Math.abs(main.scrollTop - y) > 1) throw new Error(`main cannot scroll to ${y}px (it stops at ${main.scrollTop}px).`);
          return y;
        }
      }
      return null;
    },
    { slack, margin: TEXT_MARGIN_PX },
  );
  if (offset === null) throw new Error(`Within ${slack}px of the top of ${String(target)}, every offset cuts through a line of text: choose another target or more slack.`);
}

/** See Shot.scrollToFit. */
async function scrollMainToFit(target: Locator, keep: Locator): Promise<void> {
  const keepTop = await keep.evaluate((element) => element.getBoundingClientRect().top);
  await target.evaluate((element, keepTop) => {
    const main = element.closest("main");
    if (!main) throw new Error("The element is not inside main.");
    const box = main.getBoundingClientRect();
    main.scrollTop += Math.max(0, Math.min(element.getBoundingClientRect().bottom - box.bottom, keepTop - box.top));
  }, keepTop);
}

/**
 * Prepares the page before its first load: the display preferences as cookies (the server renders the first paint
 * from them), the demo data in localStorage under the stores' own keys (alert rules the same way as app.seedStorage
 * writes the others: once per tab, before any script of the page), the browser clock stopped at the server's time, so
 * the market clock, "today" and "in 3 days" read the same in every run while timers keep running, and a watch on the
 * page's data requests, so the capture can wait for every one.
 */
export async function stage(page: Page, app: App, request: APIRequestContext, { look, data }: { look: Look; data: DemoData }): Promise<Shot> {
  const inflight = trackApiRequests(page);
  await app.setPrefs({ theme: look.theme, lang: look.lang });
  await page.context().addCookies(
    [
      { name: PREF_COOKIES.updown, value: look.updown },
      { name: PREF_COOKIES.density, value: DENSITY },
    ].map((cookie) => ({ ...cookie, url: BASE_URL, sameSite: "Lax" as const })),
  );
  const { alerts, ...stores } = data;
  await app.seedStorage(stores);
  if (alerts) {
    await page.context().addInitScript(
      ([key, value]: [string, string]) => {
        const marker = "shots:alerts-seeded";
        try {
          if (window.sessionStorage.getItem(marker)) return;
          window.localStorage.setItem(key, value);
          window.sessionStorage.setItem(marker, "1");
        } catch {
          // Storage unavailable (an opaque origin such as about:blank): nothing to seed there.
        }
      },
      [ALERTS_STORAGE_KEY, JSON.stringify(alerts)] as [string, string],
    );
  }
  if (PINNED_NOW !== null) await page.clock.setFixedTime(await serverTime(request));

  return {
    async scrollToTop(target, slack = 0) {
      await holdStill(page, app, look.lang, inflight);
      await scrollMainToTop(target, slack);
    },
    async scrollToFit(target, keep) {
      await holdStill(page, app, look.lang, inflight);
      await scrollMainToFit(target, keep);
    },
    async capture(file) {
      // The phone image is a page of the phone project, the others of the desktop project (images.ts).
      expect(test.info().project.name, `the project that captures ${file}`).toBe(README_IMAGES[file]);
      // The page wears the look the image promises: language, theme, price colors and density, as <html> carries them.
      for (const [name, value] of Object.entries(htmlAttributes({ ...look, density: DENSITY }))) {
        await expect(page.locator("html"), `<html ${name}>`).toHaveAttribute(name, value);
      }
      await holdStill(page, app, look.lang, inflight);
      // No focus ring, and the mouse outside the page, so no hover state or tooltip shows.
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.mouse.move(-10, -10);
      await expect.poll(() => page.evaluate(() => document.querySelectorAll(":hover").length), { message: "elements under the mouse" }).toBe(0);
      await requestsDone(inflight);
      const target = path.join(SCREENSHOTS_DIR, file);
      await page.screenshot({ path: target, animations: "disabled", caret: "hide", scale: "device" });
      return target;
    },
  };
}
