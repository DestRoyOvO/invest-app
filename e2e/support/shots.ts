import path from "node:path";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { ALERTS_STORAGE_KEY, type AlertRule } from "@/lib/alerts";
import { MESSAGES } from "@/lib/i18n/messages";
import { PREF_COOKIES, type UpDown } from "@/lib/prefs";

import { BASE_URL, PINNED_NOW } from "./env";
import { expect, type App, type Lang, type StoredData, type Theme } from "./test";

// Helpers of `npm run screenshots` (e2e/screenshots): each README image is a page of the fixture-data server, opened
// with the demo investor's data and display preferences, held still (the browser clock stopped at the server's time,
// reduced motion, every panel loaded, fonts loaded, no focus ring, no hover) and captured at the size of the viewport.
// docs/testing.md (Screenshots) describes the command.

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

/** The server's clock: its /api/health time (the screenshot server's clock stands still at E2E_NOW). */
async function serverTime(request: APIRequestContext): Promise<number> {
  const health = (await (await request.get("/api/health")).json()) as { time?: string };
  const time = Date.parse(health.time ?? "");
  if (Number.isNaN(time)) throw new Error("/api/health reported no time.");
  return time;
}

/**
 * Prepares the page before its first load: the display preferences as cookies (the server renders the first paint
 * from them), the demo data in localStorage under the stores' own keys (alert rules the same way as app.seedStorage
 * writes the others: once per tab, before any script of the page), and the browser clock stopped at the server's time,
 * so the market clock, "today" and "in 3 days" read the same in every run while timers keep running.
 */
export async function stage(page: Page, app: App, request: APIRequestContext, { look, data }: { look: Look; data: DemoData }): Promise<void> {
  await app.setPrefs({ theme: look.theme, lang: look.lang });
  await page.context().addCookies(
    [
      { name: PREF_COOKIES.updown, value: look.updown },
      { name: PREF_COOKIES.density, value: "comfortable" },
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
}

/** Scrolls the page's scroll container (main) so that `target` starts at its top edge. */
export async function scrollToTop(target: Locator): Promise<void> {
  await target.evaluate((element) => {
    const main = element.closest("main");
    if (!main) throw new Error("The element is not inside main.");
    main.scrollTop += element.getBoundingClientRect().top - main.getBoundingClientRect().top;
  });
}

/**
 * Scrolls main down just far enough for `target` to end at its bottom edge (not at all when it already fits), so the
 * fold cuts below a panel rather than through a line of text; but never so far that `keep`, near the top, loses a pixel.
 */
export async function scrollToFit(target: Locator, keep: Locator): Promise<void> {
  const keepTop = await keep.evaluate((element) => element.getBoundingClientRect().top);
  await target.evaluate((element, keepTop) => {
    const main = element.closest("main");
    if (!main) throw new Error("The element is not inside main.");
    const box = main.getBoundingClientRect();
    main.scrollTop += Math.max(0, Math.min(element.getBoundingClientRect().bottom - box.bottom, keepTop - box.top));
  }, keepTop);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Waits until nothing on the page is still arriving or moving: no data request in flight, every declared font face
 * loaded, no skeleton or "Loading" text, no error state, stale-data banner or toast, every image decoded.
 */
async function holdStill(page: Page, app: App, lang: Lang): Promise<void> {
  await app.settle();
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

/**
 * Captures the viewport into SCREENSHOTS_DIR/<file> once the page holds still, with no element focused and the mouse
 * outside the page (so no hover state, tooltip or focus ring shows). Animations are finished and the caret hidden.
 */
export async function capture(page: Page, app: App, file: string, lang: Lang): Promise<string> {
  await holdStill(page, app, lang);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(-10, -10);
  await expect.poll(() => page.evaluate(() => document.querySelectorAll(":hover").length), { message: "elements under the mouse" }).toBe(0);
  const target = path.join(SCREENSHOTS_DIR, file);
  await page.screenshot({ path: target, animations: "disabled", caret: "hide", scale: "device" });
  return target;
}
