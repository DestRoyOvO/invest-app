import type { APIRequestContext } from "@playwright/test";

import { signedMoneyText } from "@/components/portfolio/money-format";
import { withTrueMinus } from "@/components/ui/delta-utils";
import { stockPath } from "@/lib/api-client";
import { formatChange, formatPercent, formatRatio } from "@/lib/format";
import { DEFAULT_SYMBOL, type FunctionDef } from "@/lib/functions";
import { MESSAGES } from "@/lib/i18n/messages";
import { DEFAULT_WATCHLIST, getSector } from "@/lib/universe";

import { expect, type Locator, type Page, type StoredData } from "./test";

// Helpers of the shell specs (overview, markets, navigation, command bar): the investor data they start from, panels by
// title, the app's own API answers that expectations are computed from, the app's texts (its message catalog, so a
// reworded label does not break a spec) and numbers formatted the way the app formats them.

/** The English messages: specs find controls by the texts the app shows. */
export const en = MESSAGES.en;

export const NEW_YORK = "America/New_York";

/**
 * A returning investor: the default watchlist, whose scheduled events the fixture data fixes (NVDA reports two sessions
 * after the latest one, AAPL goes ex-dividend after three, MSFT reports after four, AAPL after six, GOOGL after eight
 * and AMZN after nine), and eight US positions, enough that My day lists only the largest movers (four rose and four fell
 * in the session before the default E2E_NOW). AAPL, AMZN and MSFT are held as well, so the week ahead mixes holdings,
 * watchlist names and macro releases.
 */
export const SHELL_DATA = {
  watchlist: [...DEFAULT_WATCHLIST],
  holdings: {
    AAPL: { shares: 25, cost: 180 },
    AMZN: { shares: 20, cost: 150 },
    META: { shares: 6, cost: 520 },
    UNH: { shares: 15, cost: 280 },
    MSFT: { shares: 12, cost: 410 },
    ORCL: { shares: 18, cost: 160 },
    HD: { shares: 7, cost: 300 },
    SPY: { shares: 4, cost: 500 },
  },
} satisfies StoredData;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A panel by its title: the first region of that name, since a table inside a panel can become a labelled scroll region
 * of its own when it overflows, after the panel in document order.
 */
export function panel(scope: Page | Locator, name: string | RegExp): Locator {
  return scope.getByRole("region", { name, exact: true }).first();
}

/** The page's main heading. */
export function mainHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 1 });
}

/** The JSON of one of the app's own API routes, the same answer the page reads (the server caches it). */
export async function apiJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

/** The server's clock: the pinned instant (E2E_NOW) plus the time since the server started. */
export async function serverNow(request: APIRequestContext): Promise<number> {
  const { time } = await apiJson<{ time: string }>(request, "/api/health");
  return Date.parse(time);
}

// --- Numbers and dates as the app shows them ---------------------------------------------------------------------------

/** A P&L amount as the app signs it: +1,234.50, −12.00 (a true minus), 0.00. */
export function money(value: number): string {
  return signedMoneyText(value, "en");
}

/** A decimal ratio as a signed percent: 0.0012 -> +0.12%. */
export function signedRatio(value: number, digits = 2): string {
  return withTrueMinus(formatRatio(value, { digits, sign: true }));
}

/** A change in percent units: +1.87%, −0.36%. */
export function signedPercent(value: number | null): string {
  return withTrueMinus(formatPercent(value));
}

/** An absolute change: +1.20, −46.17. */
export function signedChange(value: number | null): string {
  return withTrueMinus(formatChange(value, "en"));
}

/** YYYY-MM-DD of an instant on the clock of a time zone. */
export function dayIn(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Calendar days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / 86_400_000);
}

/**
 * The weekday `count` sessions after a YYYY-MM-DD session. Weekends only: the specs use it for the weeks after the
 * default E2E_NOW, which hold no NYSE holiday.
 */
export function sessionsAfter(day: string, count: number): string {
  let ms = dayMs(day);
  for (let left = count; left > 0; ) {
    ms += 86_400_000;
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/** "Fri" for a YYYY-MM-DD. */
export function weekdayOf(day: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(dayMs(day));
}

/**
 * When a trade happened, on the exchange's own clock: "16:00" when that was today in the exchange's time zone, otherwise
 * with the weekday ("Fri 16:00").
 */
export function localTradeTime(iso: string, timeZone: string, now: number): string {
  const at = Date.parse(iso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  if (dayIn(at, timeZone) === dayIn(now, timeZone)) return time;
  return `${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at)} ${time}`;
}

// --- Functions and pages -------------------------------------------------------------------------------------------------

/** A function's name in the navigation, the command bar and /help. */
export function functionLabel(fn: FunctionDef): string {
  return en.help.functions[fn.labelKey].label;
}

/** Where a function leads in a fresh browser: symbol functions open the default symbol, SECT the default sector. */
export function functionHref(fn: FunctionDef, symbol: string = DEFAULT_SYMBOL): string {
  return fn.scope === "security" ? fn.href(symbol) : fn.href(undefined, { lastSector: null });
}

/** The main heading of the page an address opens, from the app's messages (a quote page is headed by its symbol). */
export function pageHeading(href: string): string {
  const url = new URL(href, "http://localhost");
  const quote = /^\/stock\/([^/]+)$/.exec(url.pathname);
  if (quote) return decodeURIComponent(quote[1]);
  const sector = /^\/sector\/([^/]+)$/.exec(url.pathname);
  if (sector) {
    const def = getSector(decodeURIComponent(sector[1]));
    if (!def) throw new Error(`No sector for ${href}`);
    return def.label.en;
  }
  const headings: Record<string, string> = {
    "/": en.market.title,
    "/markets": en.markets.title,
    "/screener": url.searchParams.get("tab") === "discover" ? en.discover.title : en.screener.title,
    "/watchlist": en.watchlist.title,
    "/portfolio": en.port.title,
    "/calendar": en.calendar.title,
    "/alerts": en.alerts.title,
    "/notes": en.notes.title,
    "/lab": en.lab.title,
    "/data": en.data.title,
    "/help": en.help.page.title,
  };
  const heading = headings[url.pathname];
  if (heading === undefined) throw new Error(`No heading known for ${href}`);
  return heading;
}

/** Waits until the page an address opens is shown: the address and its main heading. */
export async function expectPage(page: Page, href: string): Promise<void> {
  await expect(page).toHaveURL(href);
  await expect(mainHeading(page)).toHaveText(pageHeading(href));
}

export { stockPath };

// --- The command bar -----------------------------------------------------------------------------------------------------

export interface CommandBar {
  dialog: Locator;
  /** The text field (a combobox over the results). */
  input: Locator;
  /** The results, in order. */
  options: Locator;
  /** The highlighted result, which Enter runs. */
  selected: Locator;
  /** What the bar says about the results ("No match ..."). */
  status: Locator;
}

export function commandBar(page: Page): CommandBar {
  const dialog = page.getByRole("dialog", { name: en.command.title });
  return {
    dialog,
    input: dialog.getByRole("combobox", { name: en.command.title }),
    options: dialog.getByRole("option"),
    selected: dialog.getByRole("option", { selected: true }),
    status: dialog.getByRole("status"),
  };
}

/** Opens the command bar with "/" and types a command into it (Enter is left to the test). */
export async function typeCommand(page: Page, text: string): Promise<CommandBar> {
  await page.keyboard.press("/");
  const bar = commandBar(page);
  await expect(bar.input).toBeFocused();
  await bar.input.fill(text);
  return bar;
}
