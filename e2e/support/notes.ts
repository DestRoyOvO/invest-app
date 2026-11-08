import type { APIRequestContext, BrowserContext, Locator, Page } from "@playwright/test";

import type { ChartData, Quote, QuotesResponse, StockDetail } from "@/types/api";

import { BASE_URL } from "./env";

// Helpers of the notes, alerts, settings and AI chat specs: the data the pages read (so expectations come from the same
// API answers), the app's number and date formats written out independently, and the browser storage the features
// keep their state in.

/** A panel by its title: the first region of that name (a table can become a labelled scroll region of its own). */
export function panel(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true }).first();
}

/**
 * The data rows of a table: rows of cells, without the header row and without the one full-width cell (td colspan)
 * the table shows while it loads or when it is empty.
 */
export function dataRows(table: Locator): Locator {
  const page = table.page();
  return table
    .getByRole("row")
    .filter({ has: page.getByRole("cell") })
    .filter({ hasNot: page.locator("td[colspan]") });
}

/**
 * The cell of a data row under the column with this header. Columns are counted among those shown: a column's header
 * and its cells hide together below their breakpoint, so the positions agree on every screen. Fails when no shown
 * column has that header.
 */
export async function cellUnder(table: Locator, row: Locator, header: string): Promise<Locator> {
  const headers = table.getByRole("columnheader");
  await headers.first().waitFor();
  const names = (await headers.allTextContents()).map((text) => text.trim());
  const index = names.indexOf(header);
  if (index < 0) throw new Error(`No column "${header}" is shown; the columns are ${JSON.stringify(names)}`);
  return row.getByRole("cell").nth(index);
}

/** Quotes by symbol, from the route the lists and the alert engine read (/api/quotes). */
export async function listQuotes(request: APIRequestContext, symbols: readonly string[]): Promise<Map<string, Quote>> {
  const response = await request.get(`/api/quotes?symbols=${symbols.map(encodeURIComponent).join(",")}`);
  if (!response.ok()) throw new Error(`/api/quotes answered ${response.status()}`);
  const body = (await response.json()) as QuotesResponse;
  return new Map(body.quotes.map((quote) => [quote.symbol, quote]));
}

/** The quote a quote page shows (/api/stock/<symbol>), with a price. */
export async function pageQuote(request: APIRequestContext, symbol: string): Promise<Quote & { price: number }> {
  const response = await request.get(`/api/stock/${encodeURIComponent(symbol)}`);
  if (!response.ok()) throw new Error(`/api/stock/${symbol} answered ${response.status()}`);
  const { quote } = (await response.json()) as StockDetail;
  if (quote.price === null) throw new Error(`/api/stock/${symbol} has no price`);
  return quote as Quote & { price: number };
}

/** Daily bars of a symbol over a range, from the chart route the alert catch-up replays. */
export async function dailyBars(request: APIRequestContext, symbol: string, range: string): Promise<ChartData> {
  const response = await request.get(`/api/stock/${encodeURIComponent(symbol)}/chart?range=${range}`);
  if (!response.ok()) throw new Error(`/api/stock/${symbol}/chart answered ${response.status()}`);
  return (await response.json()) as ChartData;
}

/** The server's clock now (its /api/health time); the suite started the browser's clock there too. */
export async function serverNow(request: APIRequestContext): Promise<Date> {
  const response = await request.get("/api/health");
  return new Date(((await response.json()) as { time: string }).time);
}

const PRICE_2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PRICE_4 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** A price as the app writes it in English: grouping and two decimals, four below 1 (1,234.56; 0.8123). */
export function price(value: number): string {
  const abs = Math.abs(value);
  return (abs > 0 && abs < 1 ? PRICE_4 : PRICE_2).format(value);
}

/** A signed percent as the app writes changes and distances, with a true minus: +9.5%, −16.3%, 0.0%. */
export function signedPct(value: number, digits = 2): string {
  const fixed = Math.abs(value).toFixed(digits);
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${fixed}%`;
}

/** Escapes text for use inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** The New York calendar date (YYYY-MM-DD) of an instant, moved by `days`; the browser's calendar in the suite. */
export function nyDate(at: Date, days = 0): string {
  const [y, m, d] = NY_DATE.format(at).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Calendar days from the New York date of `now` to a calendar date (YYYY-MM-DD): 0 on the day, negative after it. */
export function nyDaysTo(now: Date, isoDate: string): number {
  return Math.round((Date.parse(isoDate) - Date.parse(nyDate(now))) / 86_400_000);
}

/** A calendar date (YYYY-MM-DD) as the app writes dates in English: "Nov 7, 2026", or "Nov 7" when short. */
export function writtenDate(isoDate: string, { short = false }: { short?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-US", { year: short ? undefined : "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate}T12:00:00Z`));
}

/**
 * Writes localStorage keys before the first page load of the test, in the app's own formats, for stores
 * app.seedStorage does not cover (alerts, the alert log, AI chats and settings). Like app.seedStorage it writes once
 * per tab, so what the page changes afterwards survives a reload.
 */
export async function seedLocal(context: BrowserContext, entries: Record<string, unknown>): Promise<void> {
  const items = Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)] as [string, string]);
  await context.addInitScript((pairs: Array<[string, string]>) => {
    const marker = "e2e:notes-seeded";
    try {
      if (window.sessionStorage.getItem(marker)) return;
      for (const [key, value] of pairs) window.localStorage.setItem(key, value);
      window.sessionStorage.setItem(marker, "1");
    } catch {
      // Storage unavailable (an opaque origin such as about:blank): nothing to seed there.
    }
  }, items);
}

/** A localStorage value of the page, parsed (null when the key is missing). */
export async function readLocal<T>(page: Page, key: string): Promise<T | null> {
  const raw = await page.evaluate((name) => window.localStorage.getItem(name), key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

/**
 * The computed value of a CSS color (or any color expression, such as var(--green)) on the page, as the browser
 * resolves it for an element at the root: rgb(47, 191, 113).
 */
export async function resolvedColor(page: Page, color: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, color);
}

/** The computed text color of an element. */
export async function colorOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).color);
}

interface NotificationProbe {
  __e2eNotificationRequests?: number;
  __e2eAllowNotifications?: () => Promise<void>;
}

/**
 * Counts the page's calls of Notification.requestPermission (per document). With `allow`, each call first grants the
 * permission to the app's origin, as an investor who answers the browser's prompt with Allow; otherwise the browser
 * answers on its own (headless Chrome denies).
 */
export async function watchNotificationRequests(context: BrowserContext, { allow = false }: { allow?: boolean } = {}): Promise<void> {
  if (allow) await context.exposeFunction("__e2eAllowNotifications", () => context.grantPermissions(["notifications"], { origin: BASE_URL }));
  await context.addInitScript((grant: boolean) => {
    if (typeof Notification === "undefined") return;
    const probe = window as unknown as NotificationProbe;
    const ask = Notification.requestPermission.bind(Notification);
    probe.__e2eNotificationRequests = 0;
    Notification.requestPermission = async (...args: Parameters<typeof Notification.requestPermission>) => {
      probe.__e2eNotificationRequests = (probe.__e2eNotificationRequests ?? 0) + 1;
      if (grant) await probe.__e2eAllowNotifications?.();
      return ask(...args);
    };
  }, allow);
}

/** How often this document asked for the notification permission, and the permission now. */
export async function notificationState(page: Page): Promise<{ requests: number; permission: string }> {
  return page.evaluate(() => ({
    requests: (window as unknown as NotificationProbe).__e2eNotificationRequests ?? 0,
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  }));
}

/**
 * What a tap or click at the middle of an element reaches: "itself" (the element or something inside it), otherwise
 * the text of the toast in the way, or the tag name of whatever else covers it.
 */
export async function hitAtCenter(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (hit && element.contains(hit)) return "itself";
    return hit?.closest("[data-toast]")?.textContent ?? hit?.tagName ?? "nothing";
  });
}
