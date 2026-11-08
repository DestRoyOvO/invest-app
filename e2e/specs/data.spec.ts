import { readFileSync } from "node:fs";
import path from "node:path";

import { HOLDINGS_STORAGE_KEY } from "@/hooks/useHoldings";
import { WATCHLIST_STORAGE_KEY } from "@/hooks/useWatchlist";
import { META_STORAGE_KEY } from "@/lib/backup";
import { NOTES_STORAGE_KEY } from "@/lib/notes";
import { DEFAULT_WATCHLIST } from "@/lib/universe";

import { cellOf, chooseFile, dataRows, downloadFrom, fetchQuotes, parseCsvText, readStored, rowOf, storedKeys, toast, valueHoldings } from "../support/personal";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Locator, type Page } from "../support/test";

// The data page (DATA): everything personal lives in this browser, so the page exports it (a backup file, CSV files of
// the positions and the watchlist), clears it after a typed confirmation, restores a backup (a preview of what Merge
// and Replace would change, then the restore and its Undo) and imports positions from a broker's CSV export or from
// pasted text through a review that checks every symbol against a quote. Downloads are caught with Playwright's
// download event and read from the test's output folder; uploaded files come from e2e/fixtures/personal or are the
// files the test downloaded.

const FIXTURES = path.join(__dirname, "..", "fixtures", "personal");

function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

function panel(page: Page, title: string): Locator {
  return page.getByRole("region", { name: title, exact: true }).first();
}

/** The browser's local date (YYYY-MM-DD), which names the files the page saves. */
async function browserDate(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
}

/** Every value the app keeps in localStorage, raw. */
async function storageSnapshot(page: Page): Promise<Record<string, string | null>> {
  const keys = await storedKeys(page);
  return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await page.evaluate((k) => window.localStorage.getItem(k), key)] as const)));
}

/** The seeded watchlist, positions and notes, read back from localStorage. */
async function expectStores(page: Page, expected: { watchlist: readonly string[]; holdings: object; notes?: object }): Promise<void> {
  await expect.poll(() => readStored(page, WATCHLIST_STORAGE_KEY)).toEqual(expected.watchlist);
  await expect.poll(() => readStored(page, HOLDINGS_STORAGE_KEY)).toEqual(expected.holdings);
  if (expected.notes) await expect.poll(() => readStored(page, NOTES_STORAGE_KEY)).toEqual(expected.notes);
}

/** One row of the restore preview: what the restore adds, changes and removes in a store, and the symbols involved. */
async function expectDiff(table: Locator, store: string, counts: { added: number; changed: number; removed: number }, details: string): Promise<void> {
  const row = rowOf(table, store);
  await expect(await cellOf(table, row, "Added")).toHaveText(String(counts.added));
  await expect(await cellOf(table, row, "Changed")).toHaveText(String(counts.changed));
  await expect(await cellOf(table, row, "Removed")).toHaveText(String(counts.removed));
  await expect(await cellOf(table, row, "Details")).toHaveText(details);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A line of the import review by its line number in the file (the Line column is shown from the sm breakpoint). A
 * rewritten symbol is followed by what the file said ("BRK-B from BRK.B"), set off by a margin rather than a space.
 */
async function expectReviewLine(table: Locator, line: number, expected: { symbol: string; shares?: string; cost?: string; status: string }): Promise<void> {
  const row = rowOf(table, String(line));
  const symbol = new RegExp(`^${escapeRegExp(expected.symbol).replace(" from ", "\\s*from ")}$`);
  await expect(await cellOf(table, row, "Symbol")).toHaveText(symbol, { useInnerText: true });
  if (expected.shares !== undefined) await expect(await cellOf(table, row, "Shares")).toHaveText(expected.shares);
  if (expected.cost !== undefined) await expect(await cellOf(table, row, "Avg cost")).toHaveText(expected.cost);
  await expect(await cellOf(table, row, "Status")).toHaveText(expected.status);
}

/** The selected column of a mapping field in the CSV import. */
function mappedColumn(csv: Locator, field: string): Locator {
  return csv.getByRole("combobox", { name: field, exact: true }).locator("option:checked");
}

test.describe("backup and restore", () => {
  test("exports a backup with the watchlist, positions, notes and display settings in the stores' formats", async ({ page, app }) => {
    test.skip(app.isPhone, "The same panel on phones.");
    await app.setPrefs({ theme: "light" });
    await app.seedStorage(SAMPLE_DATA);
    await app.goto("/data");
    const backup = panel(page, "Backup and restore");
    await expect(backup).toContainText("No backup yet");
    const date = await browserDate(page);
    const now = await page.evaluate(() => Date.now());

    const saved = await downloadFrom(page, backup.getByRole("button", { name: "Export backup" }), (name) => test.info().outputPath(name));
    expect(saved.download.suggestedFilename()).toBe(`investseek-backup-${date}.json`);
    const file = JSON.parse(saved.text) as { app: string; schema: number; exportedAt: string; data: { storage: Record<string, unknown>; text: object; cookies: object } };
    expect(file).toMatchObject({ app: "investseek", schema: 1, data: { cookies: { is_theme: "light" } } });
    expect(file.data.text).toEqual({});
    expect(Math.abs(Date.parse(file.exportedAt) - now)).toBeLessThan(60_000);
    // Each store's own value, as the stores keep it; the browser's backup bookkeeping is not part of the file.
    expect(Object.keys(file.data.storage).sort()).toEqual([HOLDINGS_STORAGE_KEY, NOTES_STORAGE_KEY, WATCHLIST_STORAGE_KEY].sort());
    expect(file.data.storage[WATCHLIST_STORAGE_KEY]).toEqual(SAMPLE_DATA.watchlist);
    expect(file.data.storage[HOLDINGS_STORAGE_KEY]).toEqual(SAMPLE_DATA.holdings);
    expect(file.data.storage[NOTES_STORAGE_KEY]).toEqual(SAMPLE_DATA.notes);

    await expect(toast(page, `Saved investseek-backup-${date}.json.`)).toBeVisible();
    await expect(backup).toContainText("Last backup today");
    await expect.poll(async () => Date.parse((await readStored<{ lastBackupAt: string }>(page, META_STORAGE_KEY))?.lastBackupAt ?? "") - now).toBeLessThan(60_000);
  });

  test("clears all data after its confirmation and brings it back from the exported backup", async ({ page, app }) => {
    test.skip(app.isPhone, "The same panels on phones.");
    await app.seedStorage(SAMPLE_DATA);
    await app.goto("/data");
    const backup = panel(page, "Backup and restore");
    const saved = await downloadFrom(page, backup.getByRole("button", { name: "Export backup" }), (name) => test.info().outputPath(name));
    const fileName = saved.download.suggestedFilename();

    // Clearing waits for the confirmation word.
    const clear = panel(page, "Clear all data");
    const confirm = clear.getByRole("textbox", { name: "Type CLEAR to confirm" });
    const clearButton = clear.getByRole("button", { name: "Clear all data" });
    await expect(clearButton).toBeDisabled();
    await confirm.fill("CLEA");
    await expect(clearButton).toBeDisabled();
    await confirm.fill("CLEAR");
    await clearButton.click();
    await expect(clear.getByRole("status")).toContainText("Cleared all data in this browser.");
    await expect.poll(() => storedKeys(page)).toEqual([]);
    await expect(panel(page, "Stored in this browser")).toContainText("Nothing is stored yet.");

    // The restore preview of the exported file. Without a saved list the page shows the starter watchlist, so that is
    // what the file's list is compared with.
    await chooseFile(page, backup.getByRole("button", { name: "Restore from file" }), saved.path);
    await expect(backup).toContainText(fileName);
    const mode = backup.getByRole("radiogroup", { name: "How to restore" });
    // Nothing is stored here, so moving in starts as a Replace.
    await expect(mode.getByRole("radio", { name: "Replace" })).toBeChecked();
    const added = SAMPLE_DATA.watchlist.filter((symbol) => !DEFAULT_WATCHLIST.includes(symbol));
    const removed = DEFAULT_WATCHLIST.filter((symbol) => !(SAMPLE_DATA.watchlist as readonly string[]).includes(symbol));
    const positions = Object.keys(SAMPLE_DATA.holdings);
    const notes = Object.keys(SAMPLE_DATA.notes);
    const preview = backup.getByRole("table");
    const expectPreview = async () => {
      await expect(dataRows(preview)).toHaveCount(3);
      await expectDiff(preview, "Watchlist", { added: added.length, changed: 0, removed: removed.length }, [...added.map((s) => `+${s}`), ...removed.map((s) => `−${s}`)].join(" "));
      await expectDiff(preview, "Positions", { added: positions.length, changed: 0, removed: 0 }, positions.map((s) => `+${s}`).join(" "));
      await expectDiff(preview, "Notes", { added: notes.length, changed: 0, removed: 0 }, notes.map((s) => `+${s}`).join(" "));
    };
    await expectPreview();
    // With nothing stored, a Merge would change the same.
    await mode.getByRole("radio", { name: "Merge" }).click();
    await expectPreview();
    await mode.getByRole("radio", { name: "Replace" }).click();

    const summary = `${added.length + positions.length + notes.length} added, 0 changed, ${removed.length} removed`;
    await backup.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(backup).toContainText(`Replace this browser's data: ${summary}.`);
    await backup.getByRole("button", { name: "Restore now" }).click();
    await expect(backup.getByRole("status").filter({ hasText: "Restored from" })).toContainText(`Restored from ${fileName}: ${summary}.`);
    await expectStores(page, SAMPLE_DATA);
    const stored = panel(page, "Stored in this browser").getByRole("table");
    await expect(await cellOf(stored, rowOf(stored, "Watchlist"), "Items")).toHaveText(String(SAMPLE_DATA.watchlist.length));
    await expect(await cellOf(stored, rowOf(stored, "Positions"), "Items")).toHaveText(String(positions.length));
    await expect(await cellOf(stored, rowOf(stored, "Notes"), "Items")).toHaveText(String(notes.length));
  });

  test("restores a backup by merge or by replace as its preview says, and Undo takes a restore back", async ({ page, app }) => {
    test.skip(app.isPhone, "The same panel on phones.");
    // This browser: three symbols, two positions and a note newer than the file's. The file (made on another device):
    // AAPL, AMZN and GOOGL, positions in AAPL and GOOGL, an older AAPL note, an MSFT note and the compact density.
    const local = { watchlist: ["NVDA", "AAPL", "MSFT"], holdings: { AAPL: { shares: 10, cost: 150 }, MSFT: { shares: 5, cost: 300 } }, notes: SAMPLE_DATA.notes };
    const file = JSON.parse(readFileSync(fixture("backup.json"), "utf8")) as { data: { storage: Record<string, Record<string, unknown> | string[]> } };
    const fileNotes = file.data.storage[NOTES_STORAGE_KEY] as Record<string, unknown>;
    await app.seedStorage(local);
    await app.goto("/data");
    const before = await storageSnapshot(page);
    const backup = panel(page, "Backup and restore");
    await chooseFile(page, backup.getByRole("button", { name: "Restore from file" }), fixture("backup.json"));
    await expect(backup).toContainText("backup.json");
    await expect(backup).toContainText("Made Oct 1, 2026");

    // Merge (offered first, since this browser has data): the union of the watchlists, the file's positions win per
    // symbol, the newer note wins per symbol.
    const mode = backup.getByRole("radiogroup", { name: "How to restore" });
    await expect(mode.getByRole("radio", { name: "Merge" })).toBeChecked();
    const preview = backup.getByRole("table");
    await expectDiff(preview, "Watchlist", { added: 2, changed: 0, removed: 0 }, "+AMZN +GOOGL");
    await expectDiff(preview, "Positions", { added: 1, changed: 1, removed: 0 }, "+GOOGL ~AAPL");
    await expectDiff(preview, "Notes", { added: 1, changed: 0, removed: 0 }, "+MSFT");
    await expect(backup).toContainText("Kept the newer notes in this browser: AAPL.");
    const settings = backup.getByRole("checkbox", { name: /^Also restore display settings/ });
    await expect(settings).toBeChecked();
    await expect(settings).toHaveAccessibleName(/Density: Comfortable to Compact$/);

    // Replace: this browser becomes the file.
    await mode.getByRole("radio", { name: "Replace" }).click();
    await expect(backup).toContainText("Makes this browser match the file. Anything that is not in the file is removed.");
    await expectDiff(preview, "Watchlist", { added: 2, changed: 0, removed: 2 }, "+AMZN +GOOGL −NVDA −MSFT");
    await expectDiff(preview, "Positions", { added: 1, changed: 1, removed: 1 }, "+GOOGL ~AAPL −MSFT");
    await expectDiff(preview, "Notes", { added: 1, changed: 1, removed: 0 }, "+MSFT ~AAPL");

    // Apply the merge, with the display settings.
    await mode.getByRole("radio", { name: "Merge" }).click();
    await backup.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(backup).toContainText("Merge into this browser: 4 added, 1 changed, 0 removed.");
    await backup.getByRole("button", { name: "Restore now" }).click();
    const result = backup.getByRole("status").filter({ hasText: "Restored from" });
    await expect(result).toContainText("Restored from backup.json: 4 added, 1 changed, 0 removed.");
    await expectStores(page, {
      watchlist: ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL"],
      holdings: { AAPL: { shares: 12, cost: 160 }, MSFT: { shares: 5, cost: 300 }, GOOGL: { shares: 4, cost: 120 } },
      notes: { AAPL: SAMPLE_DATA.notes.AAPL, MSFT: fileNotes.MSFT },
    });
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");

    // Undo puts every store and the display settings back.
    await result.getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, "Restore undone.")).toBeVisible();
    await expect.poll(() => storageSnapshot(page)).toEqual(before);
    await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");

    // Replace, after its confirmation.
    await chooseFile(page, backup.getByRole("button", { name: "Restore from file" }), fixture("backup.json"));
    await mode.getByRole("radio", { name: "Replace" }).click();
    await backup.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(backup).toContainText("Replace this browser's data: 4 added, 2 changed, 3 removed.");
    await backup.getByRole("button", { name: "Restore now" }).click();
    await expect(result).toContainText("Restored from backup.json: 4 added, 2 changed, 3 removed.");
    await expectStores(page, {
      watchlist: file.data.storage[WATCHLIST_STORAGE_KEY] as string[],
      holdings: file.data.storage[HOLDINGS_STORAGE_KEY] as object,
      notes: fileNotes,
    });
  });

  test("refuses a malformed or a damaged backup file and changes nothing", async ({ page, app }) => {
    test.skip(app.isPhone, "The same panel on phones.");
    await app.seedStorage(SAMPLE_DATA);
    await app.goto("/data");
    const before = await storageSnapshot(page);
    const backup = panel(page, "Backup and restore");

    // Cut off in the middle: not JSON at all.
    await chooseFile(page, backup.getByRole("button", { name: "Restore from file" }), fixture("malformed-backup.json"));
    await expect(backup.getByRole("alert")).toHaveText("This file is not valid JSON.");
    await expect(backup.getByRole("table")).toHaveCount(0);
    expect(await storageSnapshot(page)).toEqual(before);

    // An InvestSeek backup with a key that is not the app's: refused as a whole.
    await chooseFile(page, backup.getByRole("button", { name: "Choose another file" }), fixture("damaged-backup.json"));
    await expect(backup.getByRole("alert")).toHaveText("Part of this backup is damaged, so nothing was restored.");
    await expect(backup.getByRole("table")).toHaveCount(0);
    await expect(backup.getByRole("button", { name: "Restore", exact: true })).toHaveCount(0);
    expect(await storageSnapshot(page)).toEqual(before);
  });
});

test.describe("importing positions", () => {
  test("imports a broker's CSV export with English headers through the review", async ({ page, app }) => {
    test.skip(app.isPhone, "The review shows every column from the sm breakpoint; the paste test covers phones.");
    await app.seedStorage({ holdings: { AAPL: { shares: 10, cost: 140 }, NVDA: { shares: 5, cost: 100 } } });
    await app.goto("/data");
    const csv = panel(page, "Import CSV");
    await chooseFile(page, csv.getByRole("button", { name: "Choose CSV file" }), fixture("broker-positions-en.csv"));
    await expect(csv).toContainText("broker-positions-en.csv");

    // The columns are found by their names.
    await expect(mappedColumn(csv, "Symbol")).toHaveText("Symbol");
    await expect(mappedColumn(csv, "Shares")).toHaveText("Quantity");
    await expect(mappedColumn(csv, "Average cost per share")).toHaveText("Average Cost Basis");
    await expect(mappedColumn(csv, "Total cost")).toHaveText("Cost Basis Total");
    await expect(mappedColumn(csv, "Name")).toHaveText("Description");

    // Every line with its outcome: positions checked against a quote, cash, money market and options skipped, and the
    // symbol the data source does not know held back.
    await expect(csv).toContainText("3 ready · 3 skipped · 1 to fix");
    const review = csv.getByRole("table");
    await expectReviewLine(review, 2, { symbol: "AAPL", shares: "15", cost: "150.00", status: "Ready" });
    await expectReviewLine(review, 3, { symbol: "MSFT", shares: "8", cost: "350.00", status: "Ready" });
    await expectReviewLine(review, 4, { symbol: "BRK-B from BRK.B", shares: "4", cost: "400.00", status: "Ready" });
    await expectReviewLine(review, 5, { symbol: "SPAXX**", status: "Skipped: money market" });
    await expectReviewLine(review, 6, { symbol: "-AAPL261218C300", status: "Skipped: option" });
    await expectReviewLine(review, 7, { symbol: "ZZZQ", shares: "10", cost: "5.00", status: "Unknown symbol" });
    await expectReviewLine(review, 8, { symbol: "Pending Activity", status: "Skipped: cash" });
    await expect(csv.getByRole("list", { name: "Rows not imported" }).getByRole("listitem").filter({ visible: true })).toHaveText([
      /^Line 7\s*ZZZQ\s*Unknown symbol\s*No close match\. Check the symbol as written\.$/,
    ]);

    // Merge: the file's positions win for their symbols, the others stay.
    await expect(csv).toContainText("Adds 2 and updates 1. Other positions stay.");
    await csv.getByRole("button", { name: "Import 3 positions" }).click();
    await expect(csv.getByRole("status")).toContainText("Positions imported: 3.");
    await expect.poll(() => readStored(page, HOLDINGS_STORAGE_KEY)).toEqual({
      AAPL: { shares: 15, cost: 150 },
      NVDA: { shares: 5, cost: 100 },
      MSFT: { shares: 8, cost: 350 },
      "BRK-B": { shares: 4, cost: 400 },
    });
  });

  test("imports a broker's CSV export with Chinese headers through the review", async ({ page, app }) => {
    test.skip(app.isPhone, "The review shows every column from the sm breakpoint; the paste test covers phones.");
    await app.seedStorage({ holdings: { AAPL: { shares: 10, cost: 150 } } });
    await app.goto("/data");
    const csv = panel(page, "Import CSV");
    await chooseFile(page, csv.getByRole("button", { name: "Choose CSV file" }), fixture("broker-positions-zh.csv"));
    await expect(csv).toContainText("broker-positions-zh.csv");

    // Chinese column names (UTF-8 with a byte order mark, as Excel saves it).
    await expect(mappedColumn(csv, "Symbol")).toHaveText("证券代码");
    await expect(mappedColumn(csv, "Shares")).toHaveText("持仓数量");
    await expect(mappedColumn(csv, "Average cost per share")).toHaveText("成本价");
    await expect(mappedColumn(csv, "Total cost")).toHaveText("Not in file");
    await expect(mappedColumn(csv, "Name")).toHaveText("证券名称");

    // Mainland codes get their exchange (a spreadsheet's ="600519" unwrapped), a Hong Kong code its Yahoo form; the money
    // market fund and the total row are skipped.
    await expect(csv).toContainText("3 ready · 2 skipped · 0 to fix");
    const review = csv.getByRole("table");
    await expectReviewLine(review, 2, { symbol: "600519.SS from 600519", shares: "100", cost: "1,520.00", status: "Ready" });
    await expectReviewLine(review, 3, { symbol: "000001.SZ from 000001", shares: "500", cost: "10.20", status: "Ready" });
    await expectReviewLine(review, 4, { symbol: "0700.HK from 00700", shares: "200", cost: "320.50", status: "Ready" });
    await expectReviewLine(review, 5, { symbol: "511990", status: "Skipped: money market" });
    await expectReviewLine(review, 6, { symbol: "合计", status: "Skipped: total row" });

    await expect(csv).toContainText("Adds 3 and updates 0. Other positions stay.");
    await csv.getByRole("button", { name: "Import 3 positions" }).click();
    await expect(csv.getByRole("status")).toContainText("Positions imported: 3.");
    await expect.poll(() => readStored(page, HOLDINGS_STORAGE_KEY)).toEqual({
      AAPL: { shares: 10, cost: 150 },
      "600519.SS": { shares: 100, cost: 1520 },
      "000001.SZ": { shares: 500, cost: 10.2 },
      "0700.HK": { shares: 200, cost: 320.5 },
    });
  });

  test("imports pasted positions, replacing the old ones after a confirmation, and Undo brings them back", async ({ page, app }) => {
    const seeded = { NVDA: { shares: 5, cost: 100 }, AAPL: { shares: 10, cost: 150 } };
    await app.seedStorage({ holdings: seeded });
    await app.goto("/data");
    const paste = panel(page, "Paste positions");
    await paste.getByRole("textbox", { name: "Positions, one per line" }).fill(["AAPL, 25, 201.30", "msft 10 415", "BRK.B, 3, 480", "ZZZQ, 1, 10", "TSLA, many, 100"].join("\n"));

    await expect(paste).toContainText("3 ready · 0 skipped · 2 to fix");
    const review = paste.getByRole("table");
    const line = (symbol: string) => dataRows(review).filter({ hasText: symbol });
    // The status words are a column from the sm breakpoint and an icon's label on phones; both name the row.
    await expect(line("AAPL")).toHaveAccessibleName(/\bReady\b/);
    await expect(line("AAPL")).toHaveAccessibleName(/\b25 201\.30\b/);
    await expect(line("MSFT")).toHaveAccessibleName(/\bReady\b/);
    await expect(line("MSFT")).toHaveAccessibleName(/\b10 415\.00\b/);
    await expect(line("BRK-B")).toHaveAccessibleName(/\bReady\b/);
    await expect(line("ZZZQ")).toHaveAccessibleName(/\bUnknown symbol\b/);
    await expect(line("TSLA")).toHaveAccessibleName(/\bNo valid shares\b/);

    // Replace: the list becomes the pasted positions, after saying which position goes.
    await paste.getByRole("radiogroup", { name: "How to import" }).getByRole("radio", { name: "Replace" }).click();
    await expect(paste).toContainText("Positions become this list: 2 added, 1 updated, 1 removed.");
    await paste.getByRole("button", { name: "Import 3 positions" }).click();
    await expect(paste).toContainText("This removes positions that are not in the list: NVDA.");
    await paste.getByRole("button", { name: "Replace positions" }).click();
    const done = paste.getByRole("status").filter({ hasText: "Positions imported" });
    await expect(done).toContainText("Positions imported: 3.");
    await expect(paste.getByRole("textbox", { name: "Positions, one per line" })).toHaveValue("");
    await expect.poll(() => readStored(page, HOLDINGS_STORAGE_KEY)).toEqual({ AAPL: { shares: 25, cost: 201.3 }, MSFT: { shares: 10, cost: 415 }, "BRK-B": { shares: 3, cost: 480 } });

    await done.getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, "Import undone.")).toBeVisible();
    await expect.poll(() => readStored(page, HOLDINGS_STORAGE_KEY)).toEqual(seeded);
  });
});

test.describe("CSV export", () => {
  test("exports the positions and the watchlist as CSV files that match the holdings and their quotes", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The same panel on phones.");
    await app.seedStorage(SAMPLE_DATA);
    await app.goto("/data");
    const date = await browserDate(page);
    const quotes = await fetchQuotes(request, [...Object.keys(SAMPLE_DATA.holdings), ...SAMPLE_DATA.watchlist]);
    const valued = valueHoldings(SAMPLE_DATA.holdings, quotes);
    const exports = panel(page, "Export CSV");
    const near = (cell: string, expected: number, digits: number) => expect(Math.abs(Number(cell) - expected), `${cell} vs ${expected}`).toBeLessThanOrEqual(0.5 * 10 ** -digits + 1e-9);

    // Positions: largest value first, with the quote's last price and what it makes of the shares and cost.
    const positions = await downloadFrom(page, exports.getByRole("button", { name: "Download Positions as CSV" }), (name) => test.info().outputPath(name));
    expect(positions.download.suggestedFilename()).toBe(`investseek-positions-${date}.csv`);
    expect(positions.text.startsWith("﻿"), "a byte order mark for Excel").toBe(true);
    const [head, ...rows] = parseCsvText(positions.text).filter((row) => row.some((cell) => cell !== ""));
    expect(head).toEqual(["Symbol", "Shares", "Average cost", "Currency", "Last", "Value", "Weight %", "Unrealized P&L", "Unrealized P&L %"]);
    expect(rows.map((row) => row[0])).toEqual(valued.rows.map((row) => row.symbol));
    for (const [index, row] of valued.rows.entries()) {
      const cells = rows[index];
      expect(cells.slice(0, 4), row.symbol).toEqual([row.symbol, String(row.shares), String(row.cost), row.currency]);
      near(cells[4], row.price, 4);
      near(cells[5], row.value, 2);
      near(cells[6], (row.weight as number) * 100, 2);
      near(cells[7], row.pnl, 2);
      near(cells[8], row.pnlRatio * 100, 2);
    }
    await expect(toast(page, `Saved investseek-positions-${date}.csv.`)).toBeVisible();

    // The watchlist in its own order, with names, currencies, last prices and changes.
    const watchlist = await downloadFrom(page, exports.getByRole("button", { name: "Download Watchlist as CSV" }), (name) => test.info().outputPath(name));
    expect(watchlist.download.suggestedFilename()).toBe(`investseek-watchlist-${date}.csv`);
    const [watchHead, ...watchRows] = parseCsvText(watchlist.text).filter((row) => row.some((cell) => cell !== ""));
    expect(watchHead).toEqual(["Symbol", "Name", "Currency", "Last", "Change %"]);
    expect(watchRows.map((row) => row[0])).toEqual([...SAMPLE_DATA.watchlist]);
    for (const [index, symbol] of SAMPLE_DATA.watchlist.entries()) {
      const quote = quotes.get(symbol);
      expect(watchRows[index].slice(0, 3), symbol).toEqual([symbol, quote?.name, quote?.currency]);
      near(watchRows[index][3], quote?.price as number, 4);
      near(watchRows[index][4], quote?.changePercent as number, 2);
    }
  });
});
