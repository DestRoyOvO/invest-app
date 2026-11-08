import { WATCHLIST_VIEW_KEY } from "@/components/watchlist/watchlist-view";
import { WATCHLIST_STORAGE_KEY } from "@/hooks/useWatchlist";
import { DEFAULT_WATCHLIST } from "@/lib/universe";

import { AT_DEFAULT_NOW } from "../support/env";
import { amount, dataRows, expectCells, fetchCalendar, fetchProfiles, fetchQuotes, percent, price, readStored, rowOf, shortDate, toast, valueHoldings } from "../support/personal";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Page } from "../support/test";

// The watchlist page (WL) as an investor uses it: adding symbols (the quote shows up, a symbol already listed is not
// added twice), the notice for a symbol the data source does not know, removing with Undo, reordering with the drag
// handle's keys, Alt+arrows or the phone's row sheet, sorting a column as a view, and the panels beside the list
// (upcoming earnings and ex-dividend dates, allocation by value), each checked against the API answers the page reads.
// Every change is checked in localStorage (investseek:watchlist:v1) and after a reload.

const ADD_FIELD = "Add ticker or company…";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The watchlist panel; its table is located inside it, never by a caption that repeats the panel title. */
function watchlistPanel(page: Page) {
  return page.getByRole("region", { name: "Watchlist", exact: true }).first();
}

/**
 * Row texts that start with each symbol, in this order (and no other rows). A row's text runs the symbol into the
 * company name ("NVDANVIDIA Corporation…"), so the symbols of one list must not start one another, as here.
 */
function inOrder(symbols: readonly string[]): RegExp[] {
  return symbols.map((symbol) => new RegExp(`^${escapeRegExp(symbol)}`));
}

/** The stored watchlist, once it equals `symbols`. */
async function expectStored(page: Page, symbols: readonly string[]): Promise<void> {
  await expect.poll(() => readStored(page, WATCHLIST_STORAGE_KEY)).toEqual(symbols);
}

/** Removes a symbol with the row's own control: the remove button on desktop, the row's action sheet on phones. */
async function removeSymbol(page: Page, phone: boolean, symbol: string): Promise<void> {
  const row = rowOf(watchlistPanel(page).getByRole("table"), symbol);
  if (phone) {
    await row.getByRole("button", { name: `Actions for ${symbol}` }).click();
    await page.getByRole("dialog", { name: `Actions for ${symbol}` }).getByRole("button", { name: "Remove from watchlist" }).click();
  } else {
    await row.getByRole("button", { name: `Remove ${symbol}` }).click();
  }
}

/** The New York date of an instant, YYYY-MM-DD. */
function newYorkDate(instant: string | number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(instant));
}

/** Days from the browser's today to the New York date of `iso` (0 = today), as the Upcoming panel counts them. */
function calendarDays(iso: string, now: number): number {
  const day = (instant: string | number) => Date.parse(`${newYorkDate(instant)}T00:00:00Z`);
  return Math.round((day(iso) - day(now)) / 86_400_000);
}

/** The date `count` sessions after `session` (YYYY-MM-DD), counting weekdays: no NYSE holiday falls in the window checked. */
function sessionsAfter(session: string, count: number): string {
  const date = new Date(`${session}T00:00:00Z`);
  for (let left = count; left > 0; ) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) left--;
  }
  return date.toISOString().slice(0, 10);
}

test.describe("adding symbols", () => {
  test("adds a symbol with its quote, ignores one already listed and keeps the list after a reload", async ({ page, app, request }) => {
    const start = ["NVDA", "AAPL", "MSFT"];
    await app.seedStorage({ watchlist: start, holdings: {} });
    await app.goto("/watchlist");
    const panel = watchlistPanel(page);
    const table = panel.getByRole("table");
    await expect(dataRows(table)).toHaveText(inOrder(start));
    const amzn = (await fetchQuotes(request, ["AMZN"])).get("AMZN");
    if (amzn?.price == null) throw new Error("The fixture data has no AMZN quote.");

    // Typed in lowercase and added with the button: the row shows the company and its last price.
    const field = panel.getByRole("combobox", { name: ADD_FIELD });
    await field.fill("amzn");
    await panel.getByRole("button", { name: "Add", exact: true }).click();
    await expect(field).toHaveValue("");
    await expect(dataRows(table)).toHaveText(inOrder([...start, "AMZN"]));
    const row = rowOf(table, "AMZN");
    await expect(row).toContainText(amzn.name);
    await expectCells(table, row, { Last: new RegExp(`^${escapeRegExp(price(amzn.price))}(?:\\s|$)`) });
    await expectStored(page, [...start, "AMZN"]);

    // A symbol that is already listed (in another case, with Enter) is not added a second time.
    await field.fill("aapl");
    await field.press("Enter");
    await expect(field).toHaveValue("");
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(dataRows(table)).toHaveText(inOrder([...start, "AMZN"]));
    await expectStored(page, [...start, "AMZN"]);

    await page.reload();
    await app.settle();
    await expect(dataRows(table)).toHaveText(inOrder([...start, "AMZN"]));
    await expect(rowOf(table, "AMZN")).toContainText(amzn.name);
    await expectStored(page, [...start, "AMZN"]);
  });

  test("flags a stored symbol the data source does not know and removes it from the notice", async ({ page, app }) => {
    test.skip(app.isPhone, "The notice is the same on phones.");
    // A symbol from an old backup or one that was delisted: the list keeps it and says it is not found.
    await app.seedStorage({ watchlist: ["NVDA", "ZZZZ", "AAPL"], holdings: {} });
    await app.goto("/watchlist");
    const panel = watchlistPanel(page);
    const notice = panel.getByRole("status").filter({ hasText: "Not found:" });
    await expect(notice).toHaveText(/^Not found:\s*ZZZZ$/);
    await expect(rowOf(panel.getByRole("table"), "ZZZZ")).toBeVisible();

    await notice.getByRole("button", { name: "Remove ZZZZ" }).click();
    await expect(notice).toHaveCount(0);
    await expect(dataRows(panel.getByRole("table"))).toHaveText(inOrder(["NVDA", "AAPL"]));
    await expectStored(page, ["NVDA", "AAPL"]);
  });

  test("refuses an unknown symbol typed in the add form", async ({ page, app }) => {
    test.skip(app.isPhone, "The add form is the same on phones.");
    await app.seedStorage({ watchlist: ["NVDA", "AAPL"], holdings: {} });
    await app.goto("/watchlist");
    const panel = watchlistPanel(page);
    const field = panel.getByRole("combobox", { name: ADD_FIELD });
    await field.fill("ZZZZ");
    await field.press("Enter");
    // Refused the way the form refuses a malformed symbol (an alert under the field, whatever its words), and not added.
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(rowOf(panel.getByRole("table"), "ZZZZ")).toHaveCount(0);
    await expectStored(page, ["NVDA", "AAPL"]);
  });
});

test.describe("editing the list", () => {
  test("removes a symbol, and Undo puts it back in its place", async ({ page, app }) => {
    const start = ["NVDA", "AAPL", "MSFT", "AMZN"];
    await app.seedStorage({ watchlist: start, holdings: {} });
    await app.goto("/watchlist");
    const table = watchlistPanel(page).getByRole("table");
    await expect(dataRows(table)).toHaveText(inOrder(start));

    await removeSymbol(page, app.isPhone, "MSFT");
    await expect(dataRows(table)).toHaveText(inOrder(["NVDA", "AAPL", "AMZN"]));
    await expectStored(page, ["NVDA", "AAPL", "AMZN"]);
    await toast(page, "Removed MSFT").getByRole("button", { name: "Undo" }).click();
    await expect(dataRows(table)).toHaveText(inOrder(start));
    await expectStored(page, start);

    // Removed for good: a reload does not bring it back.
    await removeSymbol(page, app.isPhone, "NVDA");
    await expect(dataRows(table)).toHaveText(inOrder(["AAPL", "MSFT", "AMZN"]));
    await expectStored(page, ["AAPL", "MSFT", "AMZN"]);
    await page.reload();
    await app.settle();
    await expect(dataRows(table)).toHaveText(inOrder(["AAPL", "MSFT", "AMZN"]));
    await expectStored(page, ["AAPL", "MSFT", "AMZN"]);
  });

  test("reorders the list with the row's own controls and keeps the order after a reload", async ({ page, app }) => {
    const start = ["NVDA", "AAPL", "MSFT", "AMZN"];
    await app.seedStorage({ watchlist: start, holdings: {} });
    await app.goto("/watchlist");
    const panel = watchlistPanel(page);
    const table = panel.getByRole("table");
    await expect(dataRows(table)).toHaveText(inOrder(start));

    let expected: string[];
    if (app.isPhone) {
      // Phones: the row's action sheet moves it up or down.
      await rowOf(table, "MSFT").getByRole("button", { name: "Actions for MSFT" }).click();
      await page.getByRole("dialog", { name: "Actions for MSFT" }).getByRole("button", { name: "Move up" }).click();
      await expect(dataRows(table)).toHaveText(inOrder(["NVDA", "MSFT", "AAPL", "AMZN"]));
      await rowOf(table, "NVDA").getByRole("button", { name: "Actions for NVDA" }).click();
      await page.getByRole("dialog", { name: "Actions for NVDA" }).getByRole("button", { name: "Move down" }).click();
      expected = ["MSFT", "NVDA", "AAPL", "AMZN"];
    } else {
      // The drag handle moves its row with the arrow keys, and says where the row went.
      await rowOf(table, "AAPL").getByRole("button", { name: "Move AAPL", exact: true }).focus();
      await page.keyboard.press("ArrowUp");
      await expect(dataRows(table)).toHaveText(inOrder(["AAPL", "NVDA", "MSFT", "AMZN"]));
      await expect(panel.getByText("AAPL moved to 1 of 4", { exact: true })).toBeAttached();
      await expect(rowOf(table, "AAPL").getByRole("button", { name: "Move AAPL", exact: true })).toBeFocused();
      // Alt+Down on a row's link moves that row.
      await rowOf(table, "NVDA").getByRole("link").first().focus();
      await page.keyboard.press("Alt+ArrowDown");
      await expect(dataRows(table)).toHaveText(inOrder(["AAPL", "MSFT", "NVDA", "AMZN"]));
      await page.keyboard.press("Alt+ArrowDown");
      expected = ["AAPL", "MSFT", "AMZN", "NVDA"];
    }
    await expect(dataRows(table)).toHaveText(inOrder(expected));
    await expectStored(page, expected);

    await page.reload();
    await app.settle();
    await expect(dataRows(table)).toHaveText(inOrder(expected));
    await expectStored(page, expected);
  });

  test("sorts by a column as a view, leaving the stored order alone", async ({ page, app, request }) => {
    const start = SAMPLE_DATA.watchlist;
    await app.seedStorage({ watchlist: start, holdings: {} });
    await app.goto("/watchlist");
    const panel = watchlistPanel(page);
    const table = panel.getByRole("table");
    await expect(dataRows(table)).toHaveText(inOrder(start));
    const quotes = await fetchQuotes(request, start);
    const last = (symbol: string) => quotes.get(symbol)?.price ?? Number.NaN;
    const byPrice = [...start].sort((a, b) => last(b) - last(a));
    const head = table.getByRole("columnheader", { name: "Last" });

    // A number column sorts high to low first, then low to high.
    await head.getByRole("button").click();
    await expect(head).toHaveAttribute("aria-sort", "descending");
    await expect(dataRows(table)).toHaveText(inOrder(byPrice));
    await expect(panel.getByText("Sorted by Last", { exact: true }).filter({ visible: true })).toBeVisible();
    if (!app.isPhone) await expect(table.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await head.getByRole("button").click();
    await expect(head).toHaveAttribute("aria-sort", "ascending");
    await expect(dataRows(table)).toHaveText(inOrder([...byPrice].reverse()));

    // The sort is a view: the stored order stays the investor's, and the view itself is remembered.
    await expectStored(page, start);
    await expect.poll(() => readStored(page, WATCHLIST_VIEW_KEY)).toEqual({ sort: { key: "last", direction: "asc" } });
    await page.reload();
    await app.settle();
    await expect(head).toHaveAttribute("aria-sort", "ascending");
    await expect(dataRows(table)).toHaveText(inOrder([...byPrice].reverse()));

    await panel.getByRole("button", { name: "My order" }).filter({ visible: true }).click();
    await expect(head).not.toHaveAttribute("aria-sort", /./);
    await expect(dataRows(table)).toHaveText(inOrder(start));
    await expect.poll(() => readStored(page, WATCHLIST_VIEW_KEY)).toEqual({ sort: null });
    await expectStored(page, start);
  });
});

test.describe("panels beside the list", () => {
  test("upcoming events and allocation follow the watchlist and the positions", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The same panels follow the list on phones.");
    const holdings = SAMPLE_DATA.holdings;
    const watchlist = DEFAULT_WATCHLIST;
    await app.seedStorage({ watchlist, holdings });
    await app.goto("/watchlist");
    const symbols = [...new Set([...Object.keys(holdings), ...watchlist])];
    const [calendar, quotes, profiles] = await Promise.all([fetchCalendar(request, symbols, 14), fetchQuotes(request, symbols), fetchProfiles(request, ["PLTR"])]);
    const valued = valueHoldings(holdings, quotes);
    const weightOf = new Map(valued.rows.map((row) => [row.symbol, row.weight as number]));
    const now = await page.evaluate(() => Date.now());

    // Upcoming: the earnings and ex-dividend dates of the held and watched symbols in the next 14 days, soonest first
    // (sorted here, not taken in the API's order), with the weight of each held symbol.
    const upcoming = page.getByRole("region", { name: "Upcoming", exact: true }).first().getByRole("table");
    const events = calendar.events
      .filter((event) => event.symbol !== null && symbols.includes(event.symbol) && (event.kind === "earnings" || event.kind === "dividend"))
      .map((event) => ({ event, days: calendarDays(event.at, now) }))
      .filter(({ days }) => days >= 0 && days <= 14)
      .sort((a, b) => Date.parse(a.event.at) - Date.parse(b.event.at) || a.event.id.localeCompare(b.event.id));
    expect(events.length).toBeGreaterThan(1);
    // Each row reads symbol (with the weight of a held one), event (with the amount of a dividend), then date and days left.
    await expect(dataRows(upcoming)).toHaveText(
      events.map(({ event, days }) => {
        const weight = weightOf.get(event.symbol as string);
        const parts = [
          escapeRegExp(event.symbol as string),
          weight === undefined ? null : `Weight ${escapeRegExp(percent(weight))}`,
          event.kind === "earnings" ? "Earnings" : "Ex-div",
          event.kind === "dividend" && event.amount !== null ? `${escapeRegExp(price(event.amount))}/sh` : null,
          `${escapeRegExp(shortDate(event.at))}${days === 0 ? "Today" : `${days}d`}$`,
        ];
        return new RegExp(`^${parts.filter((part) => part !== null).join(".*")}`);
      }),
    );

    // The fixture data's fixed dates for the default watchlist, counted in sessions after the latest one: NVDA reports in
    // 2, MSFT 4, AAPL 6, GOOGL 8, AMZN 9; AAPL goes ex-dividend in 3 (docs/testing.md, Upcoming events).
    if (AT_DEFAULT_NOW) {
      const latest = newYorkDate(quotes.get("AAPL")?.regularMarketTime ?? "");
      const dates = new Map(events.map(({ event }) => [`${event.kind}:${event.symbol}`, newYorkDate(event.at)]));
      expect(Object.fromEntries(["earnings:NVDA", "dividend:AAPL", "earnings:MSFT", "earnings:AAPL", "earnings:GOOGL", "earnings:AMZN"].map((key) => [key, dates.get(key)]))).toEqual({
        "earnings:NVDA": sessionsAfter(latest, 2),
        "dividend:AAPL": sessionsAfter(latest, 3),
        "earnings:MSFT": sessionsAfter(latest, 4),
        "earnings:AAPL": sessionsAfter(latest, 6),
        "earnings:GOOGL": sessionsAfter(latest, 8),
        "earnings:AMZN": sessionsAfter(latest, 9),
      });
    }

    // Allocation by position value: each slice's value and share, largest first, and the three largest positions' share.
    // The groups are facts of the fixture data, not the app's mapping: AAPL and MSFT are technology stocks of the
    // universe, PLTR is outside it and grouped by its profile's sector, Technology, and SPY is a fund.
    expect(profiles.profiles.PLTR?.sector).toBe("Technology");
    const groups: Readonly<Record<string, string>> = { AAPL: "Information Technology", MSFT: "Information Technology", PLTR: "Information Technology", SPY: "ETFs and funds" };
    const groupOf = (symbol: string) => groups[symbol] ?? `(no group for ${symbol})`;
    const slices = new Map<string, number>();
    for (const row of valued.rows) slices.set(groupOf(row.symbol), (slices.get(groupOf(row.symbol)) ?? 0) + row.value);
    const ordered = [...slices].sort((a, b) => b[1] - a[1]);
    const allocation = page.getByRole("region", { name: "Allocation", exact: true }).first();
    await expect(allocation).toContainText("By position value");
    await expect(allocation.getByRole("listitem")).toHaveText(
      ordered.map(([label, value]) => new RegExp(`^${escapeRegExp(label)}\\s*${escapeRegExp(amount(value, 0))}\\s*${escapeRegExp(percent(value / valued.totals.value, 0))}$`)),
      { useInnerText: true },
    );
    const top3 = valued.rows.slice(0, 3).reduce((sum, row) => sum + row.value, 0) / valued.totals.value;
    await expect(allocation).toContainText(`Top 3 positions: ${percent(top3, 0)} of value`);
  });
});
