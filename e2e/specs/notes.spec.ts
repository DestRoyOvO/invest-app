import { ALERTS_STORAGE_KEY, type AlertRule } from "@/lib/alerts";
import { NOTES_STORAGE_KEY, sanitizeNotes, type NotesBook, type SymbolNote } from "@/lib/notes";

import { dataRows, escapeRegExp, listQuotes, nyDate, nyDaysTo, pageQuote, panel, price, readLocal, serverNow, signedPct, writtenDate } from "../support/notes";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Page } from "../support/test";

// Thesis notes (lib/notes.ts): written on a quote page (reached from /notes or directly), with a thesis, conviction,
// target and stop levels, a review date, tags and dated entries that keep the price of the moment; edited, deleted
// and restored with Undo; listed on /notes in review order with tag filters. Everything lives in this browser under
// investseek:notes:v1, so each test also reads the store and reloads.
//
// Expected levels, distances and prices come from the quotes the pages themselves read (/api/stock/<symbol> on the
// quote page, /api/quotes on /notes), and dates from the server's clock, which the suite also gave the browser.

/** "target 285.00 · 15.1% above": a level's line under its field, measured from the price. */
function levelLine(kind: "target" | "stop", level: number, last: number): string {
  const distance = (level / last - 1) * 100;
  return `${kind} ${price(level)} · ${Math.abs(distance).toFixed(1)}% ${distance > 0 ? "above" : "below"}`;
}

/** "285.00+15.1%": a level with its signed distance from the price, as the notes list shows it. */
function listedLevel(level: number, last: number): string {
  return `${price(level)}${signedPct((level / last - 1) * 100, 1)}`;
}

/** "in 13 days", "tomorrow", "today", "1 day overdue", "5 days overdue" (components/notes/format.ts). */
function reviewWords(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return days === -1 ? "1 day overdue" : `${-days} days overdue`;
}

function notesStore(page: Page): Promise<NotesBook | null> {
  return readLocal<NotesBook>(page, NOTES_STORAGE_KEY);
}

/** The quote header of a quote page, once the quote is in. */
async function quoteLoaded(page: Page, symbol: string, last: number): Promise<void> {
  await expect(panel(page, symbol)).toContainText(price(last));
}

test.describe("writing a thesis", () => {
  test("a thesis started from /notes keeps every field in the store's format, across a reload", async ({ page, app, request }) => {
    await app.seedStorage({ watchlist: ["NVDA", "AAPL"], notes: {} });
    const now = await serverNow(request);
    const quote = await pageQuote(request, "NVDA");
    const target = Math.round(quote.price * 1.15);
    const stop = Math.round(quote.price * 0.92);
    const reviewBy = nyDate(now, 13);
    const thesis = "Data center demand outruns supply through next year.";
    const entry = "Guidance raised; supply still tight.";

    await app.goto("/notes");
    // No notes yet: the empty list offers the quotes of the watchlist, each opening its notes panel.
    await panel(page, "Notes").getByRole("list", { name: "Open a quote" }).getByRole("link", { name: "NVDA" }).click();
    await expect(page).toHaveURL(/\/stock\/NVDA#notes$/);
    await quoteLoaded(page, "NVDA", quote.price);

    const notes = panel(page, "Notes");
    await expect(notes).toContainText("No thesis for NVDA yet.");
    await notes.getByRole("button", { name: "Write a thesis" }).click();
    const thesisBox = notes.getByRole("textbox", { name: "Thesis" });
    await expect(thesisBox).toBeFocused();
    await thesisBox.fill(thesis);
    await notes.getByRole("radiogroup", { name: "Conviction" }).getByRole("radio", { name: "3" }).click();
    await expect(notes.getByText("3 of 5", { exact: true })).toBeVisible();
    const review = notes.getByRole("textbox", { name: "Review by" });
    await review.fill(reviewBy);
    await review.press("Enter");
    await expect(notes.getByText(reviewWords(13), { exact: true })).toBeVisible();
    const targetBox = notes.getByRole("textbox", { name: "Target" });
    await targetBox.fill(String(target));
    await targetBox.press("Enter");
    await expect(notes.getByText(levelLine("target", target, quote.price), { exact: true })).toBeVisible();
    const stopBox = notes.getByRole("textbox", { name: "Wrong below" });
    await stopBox.fill(String(stop));
    await stopBox.press("Enter");
    await expect(notes.getByText(levelLine("stop", stop, quote.price), { exact: true })).toBeVisible();
    // Tags are kept in lower case; Enter or a comma adds one.
    const tags = notes.getByRole("textbox", { name: "Tags" });
    await tags.fill("AI");
    await tags.press("Enter");
    await tags.fill("Semis");
    await tags.press(",");
    await expect(notes.getByRole("button", { name: "Remove tag ai" })).toBeVisible();
    await expect(notes.getByRole("button", { name: "Remove tag semis" })).toBeVisible();

    // An entry keeps today's date and the price of the moment.
    const entries = notes.getByRole("region", { name: /^Entries/ });
    await entries.getByRole("textbox", { name: "Add entry" }).fill(entry);
    await entries.getByRole("button", { name: "Add entry" }).click();
    const item = entries.getByRole("listitem").filter({ hasText: entry });
    await expect(item.getByRole("time")).toHaveText(writtenDate(nyDate(now)));
    await expect(item).toContainText(`at ${price(quote.price)}`);
    await expect(entries.getByRole("heading")).toHaveText(/^Entries\s*1$/);

    // The store holds the note in lib/notes.ts's format: reading it back changes nothing.
    await expect
      .poll(async () => (await notesStore(page))?.NVDA)
      .toMatchObject({ thesis, conviction: 3, target, stop, reviewBy, tags: ["ai", "semis"], entries: [{ price: quote.price, text: entry, kind: "note" }] });
    const stored = (await notesStore(page)) as NotesBook;
    expect(Object.keys(stored)).toEqual(["NVDA"]);
    expect(sanitizeNotes(stored)).toEqual(stored);
    const at = Date.parse(stored.NVDA.entries[0].at);
    expect(at).toBeGreaterThanOrEqual(now.getTime());
    expect(Date.parse(stored.NVDA.updatedAt)).toBeGreaterThanOrEqual(at);

    await page.reload();
    await quoteLoaded(page, "NVDA", quote.price);
    await expect(thesisBox).toHaveValue(thesis);
    await expect(notes.getByRole("radiogroup", { name: "Conviction" }).getByRole("radio", { name: "3" })).toBeChecked();
    await expect(review).toHaveValue(reviewBy);
    await expect(targetBox).toHaveValue(String(target));
    await expect(stopBox).toHaveValue(String(stop));
    await expect(notes.getByRole("button", { name: /^Remove tag / })).toHaveCount(2);
    await expect(entries.getByRole("listitem")).toHaveCount(1);
    await expect(item).toContainText(`at ${price(quote.price)}`);

    // The notes list measures the levels from its own quote.
    const listed = (await listQuotes(request, ["NVDA"])).get("NVDA");
    if (!listed?.price) throw new Error("No NVDA quote for /notes");
    await notes.getByRole("link", { name: "All notes" }).click();
    await expect(page).toHaveURL(/\/notes$/);
    const row = dataRows(panel(page, "Notes").getByRole("table")).filter({ hasText: thesis });
    await expect(row).toContainText(listedLevel(target, listed.price));
    await expect(row).toContainText(listedLevel(stop, listed.price));
    await expect(row).toContainText(reviewWords(13));
  });

  test("on a quote page, N goes to the notes panel, and a thesis typed there is saved and listed", async ({ page, app, request }) => {
    test.skip(app.isPhone, "A keyboard flow; phones write a note in the test above.");
    await app.seedStorage({ notes: {} });
    const quote = await pageQuote(request, "MSFT");
    const thesis = "Copilot revenue shows up in the cloud numbers.";
    await app.goto("/stock/MSFT");
    await quoteLoaded(page, "MSFT", quote.price);

    await page.keyboard.press("n");
    const notes = panel(page, "Notes");
    await expect(notes.getByRole("button", { name: "Write a thesis" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(notes.getByRole("textbox", { name: "Thesis" })).toBeFocused();
    await page.keyboard.type(thesis);
    // Saved after a pause in typing.
    await expect(notes.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(async () => (await notesStore(page))?.MSFT?.thesis).toBe(thesis);

    await notes.getByRole("link", { name: "All notes" }).click();
    await expect(dataRows(panel(page, "Notes").getByRole("table")).getByRole("link")).toHaveText(["MSFT"]);
    await expect(panel(page, "Notes")).toContainText(thesis);
    await expect(panel(page, "Notes").getByText("1 note", { exact: true })).toBeVisible();
  });
});

test.describe("one note over time", () => {
  test("the sample AAPL note shows on its quote page; entries, edits, deletions and Undo are stored", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The editor works the same on phones; the first test writes a note there.");
    await app.seedStorage(SAMPLE_DATA);
    const now = await serverNow(request);
    const quote = await pageQuote(request, "AAPL");
    const sample = SAMPLE_DATA.notes.AAPL;
    const today = writtenDate(nyDate(now));

    await app.goto("/stock/AAPL");
    await quoteLoaded(page, "AAPL", quote.price);
    const notes = panel(page, "Notes");
    const thesisBox = notes.getByRole("textbox", { name: "Thesis" });
    const conviction = notes.getByRole("radiogroup", { name: "Conviction" });
    await expect(thesisBox).toHaveValue(sample.thesis);
    await expect(conviction.getByRole("radio", { name: String(sample.conviction) })).toBeChecked();
    await expect(notes.getByRole("textbox", { name: "Review by" })).toHaveValue(sample.reviewBy);
    await expect(notes.getByText(reviewWords(nyDaysTo(now, sample.reviewBy)), { exact: true })).toBeVisible();
    await expect(notes.getByText(levelLine("target", sample.target, quote.price), { exact: true })).toBeVisible();
    await expect(notes.getByText(levelLine("stop", sample.stop, quote.price), { exact: true })).toBeVisible();
    await expect(notes.getByRole("button", { name: "Remove tag quality" })).toBeVisible();
    const entries = notes.getByRole("region", { name: /^Entries/ });
    const items = entries.getByRole("listitem");
    const [first] = sample.entries;
    await expect(items).toHaveCount(1);
    await expect(items.first().getByRole("time")).toHaveText(writtenDate(nyDate(new Date(first.at))));
    await expect(items.first()).toContainText(`at ${price(first.price)}`);
    await expect(items.first()).toContainText(first.text);

    // Two new entries, newest first, each with today's date and the price of the moment.
    const added = ["Checked the services margin.", "Waiting for the report."];
    for (const text of added) {
      await entries.getByRole("textbox", { name: "Add entry" }).fill(text);
      await entries.getByRole("button", { name: "Add entry" }).click();
      await expect(items.filter({ hasText: text })).toContainText(`at ${price(quote.price)}`);
      await expect(items.filter({ hasText: text }).getByRole("time")).toHaveText(today);
    }
    await expect(items).toHaveText([new RegExp(escapeRegExp(added[1])), new RegExp(escapeRegExp(added[0])), new RegExp(escapeRegExp(first.text))]);
    await expect(entries.getByRole("heading")).toHaveText(/^Entries\s*3$/);

    // Deleting an entry offers Undo, which puts it back in its place.
    await items.filter({ hasText: added[0] }).getByRole("button", { name: `Delete the entry from ${today}` }).click();
    await expect(items).toHaveCount(2);
    await expect.poll(async () => (await notesStore(page))?.AAPL?.entries.map((e) => e.text)).toEqual([added[1], first.text]);
    await page.locator("[data-toast]").filter({ hasText: "Entry deleted" }).getByRole("button", { name: "Undo" }).click();
    await expect(items).toHaveText([new RegExp(escapeRegExp(added[1])), new RegExp(escapeRegExp(added[0])), new RegExp(escapeRegExp(first.text))]);
    await expect.poll(async () => (await notesStore(page))?.AAPL?.entries.map((e) => e.text)).toEqual([added[1], added[0], first.text]);

    // Edits are saved as they are made.
    const thesis = `${sample.thesis} The installed base keeps paying.`;
    const target = sample.target + 20;
    await thesisBox.fill(thesis);
    await conviction.getByRole("radio", { name: "5" }).click();
    const targetBox = notes.getByRole("textbox", { name: "Target" });
    await targetBox.fill(String(target));
    await targetBox.press("Enter");
    await expect(notes.getByText(levelLine("target", target, quote.price), { exact: true })).toBeVisible();
    await expect(notes.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(async () => (await notesStore(page))?.AAPL).toMatchObject({ thesis, conviction: 5, target, stop: sample.stop, reviewBy: sample.reviewBy, tags: sample.tags });
    const edited = (await notesStore(page))?.AAPL as SymbolNote;
    expect(Date.parse(edited.updatedAt)).toBeGreaterThan(Date.parse(sample.updatedAt));

    // The stop, still below the price, gets an alert in one click, once.
    await notes.getByRole("button", { name: "Alert at stop" }).click();
    await expect(page.locator("[data-toast]").filter({ hasText: `Alert set: AAPL at or below ${price(sample.stop)}` })).toBeVisible();
    await expect
      .poll(async () => ((await readLocal<AlertRule[]>(page, ALERTS_STORAGE_KEY)) ?? []).map((rule) => [rule.symbol, rule.kind, rule.value, rule.note]))
      .toEqual([["AAPL", "below", sample.stop, "Wrong below"]]);
    await notes.getByRole("button", { name: "Alert at stop" }).click();
    await expect(page.locator("[data-toast]").filter({ hasText: `AAPL already has an alert at or below ${price(sample.stop)}.` })).toBeVisible();
    expect(await readLocal<AlertRule[]>(page, ALERTS_STORAGE_KEY)).toHaveLength(1);

    // Deleting the note empties the panel and the store; Undo restores all of it.
    await notes.getByRole("button", { name: "Delete note" }).click();
    await expect(notes).toContainText("No thesis for AAPL yet.");
    await expect.poll(async () => Object.keys((await notesStore(page)) ?? {})).toEqual([]);
    await page.locator("[data-toast]").filter({ hasText: "Note for AAPL deleted" }).getByRole("button", { name: "Undo" }).click();
    await expect(thesisBox).toHaveValue(thesis);
    await expect.poll(async () => (await notesStore(page))?.AAPL).toEqual(edited);

    await page.reload();
    await quoteLoaded(page, "AAPL", quote.price);
    await expect(thesisBox).toHaveValue(thesis);
    await expect(conviction.getByRole("radio", { name: "5" })).toBeChecked();
    await expect(targetBox).toHaveValue(String(target));
    await expect(items).toHaveCount(3);
  });
});

test.describe("the notes list", () => {
  test("puts overdue reviews first, filters by tag and measures levels from the last price", async ({ page, app, request }) => {
    const now = await serverNow(request);
    const note = (fields: Partial<SymbolNote>): SymbolNote => ({
      thesis: "",
      conviction: null,
      target: null,
      stop: null,
      reviewBy: null,
      tags: [],
      entries: [],
      updatedAt: now.toISOString(),
      ...fields,
    });
    // In review order: two overdue (the older first), one due today, one soon, one later, one without a date.
    const plan: Array<{ symbol: string; days: number | null; note: SymbolNote }> = [
      { symbol: "MSFT", days: -5, note: note({ thesis: "Cloud margins hold.", conviction: 4, target: 700, stop: 560, tags: ["cloud", "quality"] }) },
      { symbol: "NVDA", days: -1, note: note({ thesis: "Supply catches up next year.", target: 300, tags: ["semis"] }) },
      { symbol: "AAPL", days: 0, note: note({ thesis: "Services keep growing.", target: 340, stop: 260, tags: ["quality"] }) },
      { symbol: "AMZN", days: 3, note: note({ thesis: "Retail margins recover.", stop: 280, tags: ["cloud"] }) },
      { symbol: "GOOGL", days: 38, note: note({ thesis: "Search keeps its share.", target: 320 }) },
      { symbol: "PLTR", days: null, note: note({ thesis: "Priced for perfection.", tags: ["speculative"] }) },
    ];
    for (const row of plan) row.note.reviewBy = row.days === null ? null : nyDate(now, row.days);
    // Stored in another order, so the list's order is its own.
    const book = Object.fromEntries([...plan].reverse().map((row) => [row.symbol, row.note]));
    await app.seedStorage({ watchlist: ["NVDA"], notes: book });
    const quotes = await listQuotes(request, plan.map((row) => row.symbol));

    await app.goto("/notes");
    const notesPanel = panel(page, "Notes");
    const rows = dataRows(notesPanel.getByRole("table"));
    // Each row starts with a link to the notes of its symbol.
    const symbols = rows.getByRole("link");
    await expect(symbols).toHaveText(plan.map((row) => row.symbol));
    // Three reviews are due: the overdue ones and today's.
    await expect(notesPanel.getByText("6 notes · 3 due for review", { exact: true })).toBeVisible();
    for (const row of plan) {
      const shown = rows.filter({ hasText: row.note.thesis });
      if (row.days === null) await expect(shown).not.toContainText(/overdue|Due today|in \d+ days/);
      else await expect(shown).toContainText(row.days === 0 ? "Due today" : reviewWords(row.days));
      const last = quotes.get(row.symbol)?.price;
      if (!last) throw new Error(`No quote for ${row.symbol}`);
      if (row.note.target !== null) await expect(shown).toContainText(listedLevel(row.note.target, last));
      if (row.note.stop !== null) await expect(shown).toContainText(listedLevel(row.note.stop, last));
    }

    // Tags with their counts, the most used first; a tag keeps the review order of its notes.
    const filter = notesPanel.getByRole("group", { name: "Filter by tag" });
    await expect(filter.getByRole("button")).toHaveText(["All", /^cloud\s*2$/, /^quality\s*2$/, /^semis\s*1$/, /^speculative\s*1$/]);
    await filter.getByRole("button", { name: /^quality/ }).click();
    await expect(filter.getByRole("button", { name: /^quality/ })).toHaveAttribute("aria-pressed", "true");
    await expect(symbols).toHaveText(["MSFT", "AAPL"]);
    await filter.getByRole("button", { name: /^cloud/ }).click();
    await expect(symbols).toHaveText(["MSFT", "AMZN"]);
    await filter.getByRole("button", { name: "All" }).click();
    await expect(rows).toHaveCount(plan.length);
  });
});
