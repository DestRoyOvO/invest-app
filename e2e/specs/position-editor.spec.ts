import { change, escapeRegExp, fixed, inOrder, known, money, panel, price, quoteHeader, ratio, stockDetail, storedHoldings } from "../support/quote";
import { expect, test, type Page } from "../support/test";

// The position editor (shares and average cost per symbol, kept in this browser under investseek:holdings:v1), opened
// from the quote header and from the positions table: adding shares at a price (the weighted average cost), reducing
// (the realized P&L, average cost unchanged), removing with Undo, refusing invalid input without saving, Escape and
// focus, and the sheet on a phone. Expected figures follow from the stored position and the quote route's price.

/** The editor drawer, by its title ("Edit position · AAPL", "Add position for NVDA"). */
function editor(page: Page, title: string) {
  return page.getByRole("dialog", { name: title, exact: true });
}

/** The value of a term in the editor's preview ("Shares after", "Realized P&L"): the definition that follows it. */
function preview(page: Page, title: string, term: string) {
  const name = new RegExp(`^${escapeRegExp(term)}$`);
  return editor(page, title).getByRole("term").filter({ hasText: name }).locator("xpath=following-sibling::*[1]");
}

/** A toast (they stack, newest last) by its message. */
function toast(page: Page, message: string) {
  return page.locator("[data-toast]").filter({ hasText: message });
}

test.describe("position editor", () => {
  test("adds shares at a price from the positions table: the weighted average cost in the form, the table and storage", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The phone test saves through the sheet; this one follows the desktop table.");
    const held = { shares: 10, cost: 150 };
    await app.seedStorage({ holdings: { AAPL: held, MSFT: { shares: 5, cost: 300 } } });
    const last = known((await stockDetail(request, "AAPL")).quote.price, "price");
    await app.goto("/watchlist");
    const positions = panel(page, "Positions");
    const opener = positions.getByRole("button", { name: "Edit position for AAPL" });
    await opener.click();
    const title = "Edit position · AAPL";
    const dialog = editor(page, title);
    await expect(dialog).toContainText(`Now ${held.shares} sh at ${price(held.cost)}`);

    // Buying 4 more at 212.35 (the field starts at the last price).
    await dialog.getByRole("radio", { name: "Add shares" }).click();
    await expect(dialog.getByRole("radio", { name: "Add shares" })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByLabel("Price paid per share")).toHaveValue(last.toFixed(2));
    await expect(dialog.getByRole("heading", { name: `At the last price ${price(last)}` })).toBeVisible();
    const bought = { shares: 4, price: 212.35 };
    await dialog.getByLabel("Shares to add").fill(String(bought.shares));
    await dialog.getByLabel("Price paid per share").fill(String(bought.price));
    const shares = held.shares + bought.shares;
    const cost = (held.shares * held.cost + bought.shares * bought.price) / shares;
    const value = shares * last;
    const pnl = value - shares * cost;
    await expect(preview(page, title, "Shares after")).toHaveText(String(shares));
    await expect(preview(page, title, "New avg cost")).toHaveText(price(cost));
    await expect(preview(page, title, "Value")).toHaveText(fixed(value));
    await expect(preview(page, title, "P&L")).toHaveText(money(pnl));
    await expect(preview(page, title, "P&L %")).toHaveText(ratio(pnl / (shares * cost)));

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toast(page, "Saved AAPL position")).toBeVisible();
    await expect(opener).toBeFocused();
    // The table values the new position at the quote: its P&L follows from the new average cost.
    const row = positions.getByRole("row", { name: new RegExp(`^AAPL ${shares} `) });
    await expect(row).toContainText(fixed(value));
    await expect(row).toContainText(money(pnl));
    const stored = await storedHoldings(page);
    expect(stored.AAPL.shares).toBe(shares);
    expect(stored.AAPL.cost).toBeCloseTo(cost, 5);
    expect(stored.MSFT).toEqual({ shares: 5, cost: 300 });
  });

  test("reduces from the quote header with the realized P&L, then removes the position and undoes it", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The phone test saves through the sheet; this one follows the desktop header.");
    const held = { shares: 10, cost: 150 };
    await app.seedStorage({ holdings: { AAPL: held } });
    const { quote } = await stockDetail(request, "AAPL");
    const last = known(quote.price, "price");
    await app.goto("/stock/AAPL");
    const header = quoteHeader(page, "AAPL");
    const opener = header.getByRole("button", { name: "Edit position" });
    await opener.click();
    const title = "Edit position · AAPL";
    const dialog = editor(page, title);

    // Selling 4 at 320: the realized P&L is (sale price - average cost) x shares sold, and the average cost stays.
    await dialog.getByRole("radio", { name: "Reduce" }).click();
    await expect(dialog.getByLabel("Sale price per share")).toHaveValue(last.toFixed(2));
    const sold = { shares: 4, price: 320 };
    await dialog.getByLabel("Shares to sell").fill(String(sold.shares));
    await dialog.getByLabel("Sale price per share").fill(String(sold.price));
    const left = held.shares - sold.shares;
    await expect(preview(page, title, "Shares after")).toHaveText(String(left));
    await expect(preview(page, title, "Realized P&L")).toHaveText(money((sold.price - held.cost) * sold.shares));
    await expect(dialog).toContainText(`Average cost stays ${price(held.cost)}.`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(header).toContainText(inOrder([`${left} sh @ ${price(held.cost)}`, `value ${fixed(left * last)}`]));
    expect((await storedHoldings(page)).AAPL).toEqual({ shares: left, cost: held.cost });

    // Removing it leaves an Undo in the toast, which puts the position back as it was. The pointer rests on the toast,
    // which holds its eight-second countdown while the removal is checked.
    await opener.click();
    await dialog.getByRole("button", { name: "Remove position" }).click();
    await expect(dialog).toHaveCount(0);
    const removed = toast(page, "Removed AAPL position");
    await removed.hover();
    await expect(header.getByRole("button", { name: "Add position" })).toBeVisible();
    await expect(header).not.toContainText("Your position");
    expect((await storedHoldings(page)).AAPL).toBeUndefined();
    await removed.getByRole("button", { name: "Undo" }).click();
    await expect(header.getByRole("button", { name: "Edit position" })).toBeVisible();
    await expect(header).toContainText(inOrder([`${left} sh @ ${price(held.cost)}`, `value ${fixed(left * last)}`, `today ${change(left * known(quote.change, "change"))}`]));
    expect((await storedHoldings(page)).AAPL).toEqual({ shares: left, cost: held.cost });
  });

  test("refuses zero, negative, non-numeric and oversold input without saving; Escape returns focus to the opener", async ({ page, app }) => {
    test.skip(app.isPhone, "Keyboard focus and Escape are desktop concerns; the phone test saves through the sheet.");
    const held = { shares: 10, cost: 150 };
    await app.seedStorage({ holdings: { AAPL: held } });
    await app.goto("/stock/AAPL");
    const opener = quoteHeader(page, "AAPL").getByRole("button", { name: "Edit position" });
    await opener.click();
    const dialog = editor(page, "Edit position · AAPL");
    const save = dialog.getByRole("button", { name: "Save" });
    const sharesField = dialog.getByLabel("Shares", { exact: true });
    const costField = dialog.getByLabel("Avg cost", { exact: true });
    // The form opens on the shares field.
    await expect(sharesField).toBeFocused();

    for (const typed of ["0", "-5", "abc"]) {
      await sharesField.fill(typed);
      await save.click();
      await expect(dialog.getByRole("alert")).toHaveText("Enter a number of shares above 0.");
      await expect(sharesField).toHaveAttribute("aria-invalid", "true");
      await expect(sharesField).toBeFocused();
      expect((await storedHoldings(page)).AAPL).toEqual(held);
    }
    await sharesField.fill("12");
    await costField.fill("0");
    await save.click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter an average cost above 0.");
    await expect(costField).toBeFocused();
    expect((await storedHoldings(page)).AAPL).toEqual(held);

    // Selling more shares than are held.
    await dialog.getByRole("radio", { name: "Reduce" }).click();
    const sell = dialog.getByLabel("Shares to sell");
    await sell.fill(String(held.shares + 1));
    await save.click();
    await expect(dialog.getByRole("alert")).toHaveText(`You hold ${held.shares} shares. Sell ${held.shares} or fewer.`);
    await expect(sell).toHaveAttribute("aria-invalid", "true");
    expect((await storedHoldings(page)).AAPL).toEqual(held);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect((await storedHoldings(page)).AAPL).toEqual(held);
  });

  test("opens as a sheet on a phone and saves a new position", async ({ page, app, request }) => {
    test.skip(!app.isPhone, "The phone layout: the desktop tests cover the editor's arithmetic.");
    await app.seedStorage({ holdings: { AAPL: { shares: 10, cost: 150 } } });
    const last = known((await stockDetail(request, "NVDA")).quote.price, "price");
    await app.goto("/stock/NVDA");
    const header = quoteHeader(page, "NVDA");
    await header.getByRole("button", { name: "Add position" }).click();
    const dialog = editor(page, "Add position for NVDA");
    await expect(dialog).toBeInViewport();
    // A new position has no change modes, only its shares and average cost.
    await expect(dialog.getByRole("radiogroup", { name: "Change" })).toHaveCount(0);
    const added = { shares: 3, cost: 180.5 };
    await dialog.getByLabel("Shares", { exact: true }).fill(String(added.shares));
    await dialog.getByLabel("Avg cost", { exact: true }).fill(String(added.cost));
    await expect(preview(page, "Add position for NVDA", "Value")).toHaveText(fixed(added.shares * last));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toast(page, "Saved NVDA position")).toBeVisible();
    const value = added.shares * last;
    const basis = added.shares * added.cost;
    await expect(header).toContainText(inOrder([`${added.shares} sh @ ${price(added.cost)}`, `value ${fixed(value)}`]));
    await expect(header).toContainText(`total ${change(value - basis)} (${ratio((value - basis) / basis)})`);
    await expect(header.getByRole("button", { name: "Edit position" })).toBeVisible();
    expect(await storedHoldings(page)).toEqual({ AAPL: { shares: 10, cost: 150 }, NVDA: added });
  });
});
