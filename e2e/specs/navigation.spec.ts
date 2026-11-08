import { tpl } from "@/lib/format";
import { DEFAULT_SYMBOL, FUNCTION_GROUPS, FUNCTIONS, functionByKey, GO_SHORTCUTS, NAV_LAYOUT, suggestForPath } from "@/lib/functions";

import { PINNED_NOW } from "../support/env";
import { expectedNoise, routeCase } from "../support/routes";
import { commandBar, en, escapeRegExp, expectLanded, expectPage, functionHref, functionLabel, mainHeading, panel, stockPath } from "../support/shell";
import { expect, test } from "../support/test";

// Getting around: the desktop nav rail, the phone tab bar and its More sheet, Back and Forward, the 404 page and /help,
// and the keyboard (the "g" sequences, the "?" sheet, Escape). Expected links, labels and pages come from the function
// registry (lib/functions.ts) and the app's messages, so a renamed route or label is followed, and a broken one fails.

const esc = escapeRegExp;

/** How long TerminalShell waits for the second key of a "g" sequence. */
const GO_TIMEOUT_MS = 1_500;

test.describe("navigation", () => {
  test("the nav rail reaches every page and marks the current one", async ({ page, app }) => {
    test.skip(app.isPhone, "Phones navigate with the tab bar and the More sheet.");
    // Thirteen pages in a row: more time on a busy machine.
    test.slow();
    await app.goto("/");
    const rail = page.getByRole("navigation", { name: en.nav.primary });
    const current = rail.locator('[aria-current="page"]');
    const items = FUNCTION_GROUPS.flatMap((group) => NAV_LAYOUT[group].map((key) => functionByKey(key)));
    const link = (key: (typeof items)[number]) => rail.getByRole("link", { name: `${functionLabel(key)} ${key.code}`, exact: true });

    // The rail's functions in order (NAV_LAYOUT), each linking where the registry says.
    await expect(current).toHaveCount(1);
    expect(await rail.getByRole("link").evaluateAll((links) => links.map((a) => [a.textContent, a.getAttribute("href")]))).toEqual(
      items.map((fn) => [`${functionLabel(fn)}${fn.code}`, functionHref(fn)]),
    );
    await expect(link(items[0])).toHaveAttribute("aria-current", "page");
    for (const fn of [...items.slice(1), items[0]]) {
      await link(fn).click();
      await expectPage(page, functionHref(fn));
      await expect(link(fn)).toHaveAttribute("aria-current", "page");
      await expect(current).toHaveCount(1);
    }
  });

  test("the phone tab bar and the More sheet reach every page", async ({ page, app }) => {
    test.skip(!app.isPhone, "The desktop navigates with the nav rail.");
    // Thirteen pages in a row: more time on a busy machine.
    test.slow();
    await app.goto("/");
    const tabs = page.getByRole("navigation", { name: en.nav.primary });
    const market = tabs.getByRole("link", { name: en.nav.market, exact: true });
    const watchlist = tabs.getByRole("link", { name: en.nav.watchlist, exact: true });
    await expect(market).toHaveAttribute("aria-current", "page");
    await watchlist.click();
    await expectPage(page, "/watchlist");
    await expect(watchlist).toHaveAttribute("aria-current", "page");
    await expect(market).not.toHaveAttribute("aria-current", /./);

    // The More sheet lists every function by group (DES opens the same page as QT), each where the registry says.
    const more = tabs.getByRole("button", { name: en.nav.more, exact: true });
    const sheet = page.getByRole("dialog", { name: en.nav.allFunctions });
    const listed = FUNCTIONS.filter((fn) => fn.labelKey !== "des");
    const item = (fn: (typeof listed)[number]) => sheet.getByRole("link", { name: `${fn.code} ${functionLabel(fn)}`, exact: true });
    await more.click();
    await expect(item(functionByKey("wl"))).toHaveAttribute("aria-current", "page");
    const links = new Map(await sheet.getByRole("link").evaluateAll((elements) => elements.map((a) => [a.textContent ?? "", a.getAttribute("href")] as const)));
    for (const fn of listed) expect(links.get(`${fn.code}${functionLabel(fn)}`), `${fn.code} ${functionLabel(fn)} in the More sheet`).toBe(functionHref(fn));
    await expect(sheet.locator('[aria-current="page"]')).toHaveCount(1);
    await sheet.getByRole("button", { name: en.common.close }).click();
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    // Every page, through the sheet: the first function of each page (the other functions open a tab or a part of it).
    const pages = new Map<string, (typeof listed)[number]>();
    for (const fn of listed) {
      const path = new URL(functionHref(fn), "http://localhost").pathname;
      if (!pages.has(path)) pages.set(path, fn);
    }
    pages.delete("/watchlist");
    for (const fn of pages.values()) {
      await more.click();
      await item(fn).click();
      await expect(sheet).toBeHidden();
      await expectPage(page, functionHref(fn));
    }
    await expect(market).not.toHaveAttribute("aria-current", /./);
  });

  test("Back and Forward return to the previous page and quote tab", async ({ page, app }) => {
    test.skip(app.isPhone, "History works the same on phones.");
    await app.goto(stockPath(DEFAULT_SYMBOL));
    const tabs = page.getByRole("navigation", { name: en.stock.tabs.label });
    const overview = tabs.getByRole("link", { name: en.stock.tabs.overview });
    const financials = tabs.getByRole("link", { name: en.stock.tabs.financials });
    const financialsUrl = `${stockPath(DEFAULT_SYMBOL)}?tab=financials`;
    const wl = functionByKey("wl");
    await expect(overview).toHaveAttribute("aria-current", "page");
    await financials.click();
    await expect(page).toHaveURL(financialsUrl);
    await expect(financials).toHaveAttribute("aria-current", "page");
    await expect(panel(page, en.stock.tabs.financials)).toBeVisible();
    await page.getByRole("navigation", { name: en.nav.primary }).getByRole("link", { name: `${functionLabel(wl)} ${wl.code}`, exact: true }).click();
    await expectPage(page, functionHref(wl));

    await page.goBack();
    await expect(page).toHaveURL(financialsUrl);
    await expect(financials).toHaveAttribute("aria-current", "page");
    await expect(panel(page, en.stock.tabs.financials)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(stockPath(DEFAULT_SYMBOL));
    await expect(overview).toHaveAttribute("aria-current", "page");
    await page.goForward();
    await expect(page).toHaveURL(financialsUrl);
    await expect(financials).toHaveAttribute("aria-current", "page");
    await page.goForward();
    await expectPage(page, functionHref(wl));
  });

  test("/no-such-page answers 404 and suggests functions whose links open their pages", async ({ page, app, consoleErrors }) => {
    test.skip(app.isPhone, "The 404 page is the same on phones, without the focused command line.");
    for (const { pattern, reason } of expectedNoise(routeCase("/no-such-page")).console) consoleErrors.allow(pattern, reason);
    const response = await app.goto("/no-such-page");
    expect(response?.status(), "status of the /no-such-page document").toBe(404);
    const notFound = en.shell.notFound;
    await expect(mainHeading(page)).toHaveText(new RegExp(`^${esc(notFound.code)}\\s*${esc(tpl(notFound.unknown, { path: "/no-such-page" }))}$`));

    // The suggestions the registry makes for this path (the market, the watchlist and help when nothing is close).
    const suggested = suggestForPath("/no-such-page", { lastSymbol: DEFAULT_SYMBOL, lastSector: null });
    const expected = [
      ...(suggested.symbol ? [{ name: tpl(notFound.openSymbol, { symbol: suggested.symbol }), href: stockPath(suggested.symbol) }] : []),
      ...suggested.functions.map((match) => ({ name: `${match.fn.code} ${functionLabel(match.fn)}`, href: match.href })),
    ];
    const links = page.getByRole("main").getByRole("list").getByRole("link");
    await expect(links).toHaveCount(expected.length);
    for (const [index, { name, href }] of expected.entries()) {
      await expect(links.nth(index)).toHaveAccessibleName(name);
      await expect(links.nth(index)).toHaveAttribute("href", href);
      // A page, not another 404.
      expect((await page.request.get(href)).status(), `status of ${href}`).toBe(200);
    }

    // The page's command line hands what is typed to the command bar.
    const prompt = page.getByRole("textbox", { name: notFound.prompt });
    await expect(prompt).toBeFocused();
    await page.keyboard.type("w");
    const bar = commandBar(page);
    await expect(bar.input).toBeFocused();
    await expect(bar.input).toHaveValue("w");
    await page.keyboard.type("l");
    await expect(bar.input).toHaveValue("wl");
    await expect(bar.selected).toHaveAccessibleName(new RegExp(`^WL ${esc(functionLabel(functionByKey("wl")))}\\b`));
    await page.keyboard.press("Escape");
    await expect(bar.dialog).toBeHidden();

    const last = expected[expected.length - 1];
    await links.last().click();
    await expectPage(page, last.href);
  });

  test("/help lists every function with its route, and each listed link opens a page", async ({ page, app }) => {
    test.skip(app.isPhone, "Phones leave out the route column.");
    await app.goto("/help");
    const paths = new Set<string>();
    for (const group of FUNCTION_GROUPS) {
      // A row per function of the group, in the registry's order: its code (a link to its route), its name and the route.
      const functions = FUNCTIONS.filter((fn) => fn.group === group);
      const rows = panel(page, en.nav.groups[group]).getByRole("table").getByRole("row").filter({ has: page.getByRole("cell") });
      await expect(rows, `the ${group} functions`).toHaveText(
        functions.map((fn) => new RegExp(`^${esc(fn.code)}\\s+${esc(functionLabel(fn))}\\s[\\s\\S]*\\t${esc(functionHref(fn))}\\t`)),
        { useInnerText: true },
      );
      expect(await rows.getByRole("link").evaluateAll((links) => links.map((a) => [a.textContent, a.getAttribute("href")]))).toEqual(
        functions.map((fn) => [fn.code, functionHref(fn)]),
      );
      for (const fn of functions) paths.add(functionHref(fn).split("#")[0]);
    }
    // Every listed address is a page: the server answers 404 for anything else.
    for (const path of paths) expect((await page.request.get(path)).status(), `status of ${path}`).toBe(200);

    // A listed link opens its page, at the part it names: RISK lands on the risk panel, far down the quote page.
    const risk = functionByKey("risk");
    const href = functionHref(risk);
    await panel(page, en.nav.groups[risk.group]).getByRole("link", { name: risk.code, exact: true }).click();
    await expectPage(page, href);
    await expectLanded(page, href);
    await expect(panel(page, en.risk.title)).toBeInViewport();
  });
});

test("the keyboard: ? lists the page's own keys, / and Ctrl+K open the command bar, Escape gives the focus back, g and a letter go to a function", async ({
  page,
  app,
}) => {
  test.skip(app.isPhone, "Keyboard shortcuts are for keyboards.");
  // The suite installs the browser clock at the server's pinned time; on the real clock (E2E_NOW=real) it is installed here.
  if (PINNED_NOW === null) await page.clock.install();
  await app.goto(stockPath(DEFAULT_SYMBOL));
  // The quote page registers its keys once its quote is in.
  await expect(mainHeading(page)).toHaveText(DEFAULT_SYMBOL);
  const rail = page.getByRole("navigation", { name: en.nav.primary });
  const qt = functionByKey("qt");
  const anchor = rail.getByRole("link", { name: `${functionLabel(qt)} ${qt.code}`, exact: true });
  await anchor.focus();

  // "?" opens the shortcuts sheet with the keys of the page: the chart's and the quote page's own.
  const sheet = page.getByRole("dialog", { name: en.help.shortcuts.title });
  const pageKeys = sheet.getByRole("heading", { name: en.help.shortcuts.page, exact: true }).locator("xpath=following-sibling::*[1]");
  await page.keyboard.press("?");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: en.common.close })).toBeFocused();
  const keys: Array<[string, string]> = [
    ["[", en.chart.prevRange],
    ["]", en.chart.nextRange],
    ["L", en.chart.study.log],
    ["A", en.stock.addToWatchlist],
    ["P", en.stock.actions.editPosition],
    ["N", en.stock.actions.goToNotes],
    ["!", en.stock.actions.setAlert],
    ["W", en.stock.actions.whyMoving],
  ];
  await expect(pageKeys.getByRole("listitem")).toHaveCount(keys.length);
  for (const [key, description] of keys) {
    await expect(pageKeys.getByRole("listitem").filter({ hasText: description })).toHaveText(new RegExp(`^${esc(description)}\\s*${esc(key)}$`));
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(anchor).toBeFocused();

  // "/" and Ctrl+K (Cmd+K on a Mac) open the command bar, empty, with the focus in its input.
  const bar = commandBar(page);
  for (const key of ["/", "ControlOrMeta+k"]) {
    await page.keyboard.press(key);
    await expect(bar.dialog).toBeVisible();
    await expect(bar.input).toBeFocused();
    await expect(bar.input).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(bar.dialog).toBeHidden();
    await expect(anchor).toBeFocused();
  }

  // "g" and a letter: the status bar shows that the letter is awaited, and the quote page's own W (why is it moving,
  // which opens the assistant) stands aside. The clock stands still while the letter is awaited, so a slow machine
  // cannot make it late.
  const pending = page.getByRole("contentinfo").getByText(`G · ${en.shell.goPending}`, { exact: true });
  const pauseClock = async () => page.clock.pauseAt((await page.evaluate(() => Date.now())) + 5_000);
  for (const key of ["w", "p"]) {
    const fn = GO_SHORTCUTS.get(key);
    if (!fn) throw new Error(`No g sequence for ${key}`);
    await pauseClock();
    await page.keyboard.press("g");
    await expect(pending).toBeVisible();
    await page.keyboard.press(key);
    await page.clock.resume();
    await expectPage(page, functionHref(fn));
    await expect(pending).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // Too late: the clock runs past the timeout (instead of the test waiting for it), and "e" is then just a key.
  const at = page.url();
  const entries = await page.evaluate(() => history.length);
  await pauseClock();
  await page.keyboard.press("g");
  await expect(pending).toBeVisible();
  await page.clock.runFor(GO_TIMEOUT_MS + 100);
  await expect(pending).toBeHidden();
  await page.keyboard.press("e");
  await page.clock.resume();
  await app.settle();
  await expect(page).toHaveURL(at);
  expect(await page.evaluate(() => history.length), "no navigation").toBe(entries);

  // The sheet lists the keys of the page it opens on: the portfolio has none of its own.
  await page.keyboard.press("?");
  await expect(sheet).toBeVisible();
  await expect(pageKeys).toHaveText(en.help.shortcuts.pageNone);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
