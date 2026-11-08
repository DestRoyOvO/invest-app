import { tpl } from "@/lib/format";
import { functionByKey, functionsByCode } from "@/lib/functions";
import { CHINESE_NAMES } from "@/lib/names-zh";
import type { SearchResponse } from "@/types/api";

import { apiJson, commandBar, en, escapeRegExp, expectPage, functionHref, functionLabel, mainHeading, panel, stockPath, typeCommand } from "../support/shell";
import { expect, test } from "../support/test";

// The command bar: function codes, the TICKER CODE grammar in both orders, COMP, Chinese company names, the symbol search
// with keyboard selection, unknown input, and questions for the assistant. Expected pages and labels come from the
// function registry (lib/functions.ts); listed matches are compared with the app's own /api/search answer. The bar opens
// with "/" on the desktop and from its button on phones.

const esc = escapeRegExp;

/** The function a code names on its own (NOTE names two; the codes used here name one). */
function byCode(code: string) {
  const [fn] = functionsByCode(code);
  if (!fn) throw new Error(`No function ${code}`);
  return fn;
}

/** A result row of a function: its code, its name, then the symbol it applies to. */
function functionRow(code: string, symbol?: string): RegExp {
  return new RegExp(`^${esc(code)} ${esc(functionLabel(byCode(code)))}${symbol ? ` ${esc(symbol)}` : ""}(?: |$)`);
}

/** The Chinese name the app knows a symbol by. */
function chineseName(symbol: string): string {
  const name = CHINESE_NAMES.find((entry) => entry.symbol === symbol)?.names[0];
  if (!name) throw new Error(`No Chinese name for ${symbol}`);
  return name;
}

test.describe("desktop", () => {
  test.beforeEach(({ app }) => {
    test.skip(app.isPhone, "Opened with the / key; on phones the assistant test opens the bar from its button.");
  });

  test("function codes open their pages", async ({ page, app }) => {
    // Eleven pages in a row: more time on a busy machine.
    test.slow();
    await app.goto("/");
    for (const code of ["WL", "PORT", "EVTS", "EQS", "MOST", "MKT", "WEI", "GC", "LAB", "DATA", "HELP"]) {
      const bar = await typeCommand(page, code);
      await expect(bar.selected).toHaveAccessibleName(functionRow(code));
      await page.keyboard.press("Enter");
      await expectPage(page, functionHref(byCode(code)));
      // GC is a part of the world markets page (open already, after WEI): the page scrolls to it.
      if (code === "GC") await expect(panel(page, en.markets.rates.title)).toBeInViewport();
    }
  });

  test("a symbol and a function open that quote tab in either order, also by a Chinese name, and COMP opens the comparison", async ({ page, app }) => {
    // Seven quote pages in a row: more time on a busy machine.
    test.slow();
    await app.goto("/");
    const cases: Array<{ text: string; code: string; symbol: string; tab: string }> = [
      { text: "NVDA GP", code: "GP", symbol: "NVDA", tab: en.stock.tabs.overview },
      { text: "GP MSFT", code: "GP", symbol: "MSFT", tab: en.stock.tabs.overview },
      { text: "NVDA FA", code: "FA", symbol: "NVDA", tab: en.stock.tabs.financials },
      { text: "ERN AAPL", code: "ERN", symbol: "AAPL", tab: en.stock.tabs.earnings },
      // A Chinese company name works as the symbol.
      { text: `${chineseName("NVDA")} GP`, code: "GP", symbol: "NVDA", tab: en.stock.tabs.overview },
    ];
    for (const { text, code, symbol, tab } of cases) {
      const bar = await typeCommand(page, text);
      await expect(bar.selected).toHaveAccessibleName(functionRow(code, symbol));
      await page.keyboard.press("Enter");
      await expectPage(page, functionHref(byCode(code), symbol));
      await expect(page.getByRole("navigation", { name: en.stock.tabs.label }).getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
      // GP lands on the chart.
      if (code === "GP") await expect(panel(page, en.stock.chart)).toBeInViewport();
    }

    // A Chinese name alone offers its quote first ("Open AAPL"), before the symbol's actions.
    let bar = await typeCommand(page, chineseName("AAPL"));
    await expect(bar.selected).toHaveAccessibleName(new RegExp(`^${esc(en.command.open)} AAPL\\b`));
    await page.keyboard.press("Enter");
    await expectPage(page, stockPath("AAPL"));

    // COMP compares the first symbol with the others on its chart.
    const comp = functionByKey("comp");
    bar = await typeCommand(page, "COMP AAPL MSFT SPY");
    await expect(bar.selected).toHaveAccessibleName(new RegExp(`^COMP ${esc(functionLabel(comp))} AAPL ${esc(tpl(en.command.compareWith, { symbols: "MSFT SPY" }))}$`));
    await page.keyboard.press("Enter");
    await expectPage(page, comp.href("AAPL", { compare: ["MSFT", "SPY"] }));
    const chart = panel(page, en.stock.chart);
    for (const symbol of ["MSFT", "SPY"]) await expect(chart.getByRole("button", { name: tpl(en.chart.remove, { symbol }) })).toBeVisible();
  });

  test("arrow keys and Enter pick from the symbol search results, and unknown input says so instead of opening anything", async ({ page, app }) => {
    await app.goto("/");
    // A ticker the data source does not know: the search finds nothing, and the bar says so while offering the text as
    // typed (Enter would open its not-found quote page).
    const searched = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/search" && url.searchParams.get("q") === "ZZZZ";
    });
    const bar = await typeCommand(page, "ZZZZ");
    expect((await (await searched).json()) as SearchResponse).toEqual({ results: [] });
    await expect(bar.status).toHaveText(en.command.empty);
    await expect(bar.options).toHaveCount(1);
    await expect(bar.selected).toHaveAccessibleName("ZZZZ");
    // Words that name no function or symbol: nothing to run, so Enter keeps the bar open where it was.
    await bar.input.fill("ZZQ ZZZ");
    await expect(bar.status).toHaveText(en.command.empty);
    await expect(bar.options).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(bar.dialog).toBeVisible();
    await expect(page).toHaveURL("/");
    await expect(mainHeading(page)).toHaveText(en.market.title);

    // A company-name search lists the search's matches, in its order.
    const { results } = await apiJson<SearchResponse>(page.request, "/api/search?q=micro");
    expect(results.length, "search results for micro").toBeGreaterThanOrEqual(3);
    await bar.input.fill("micro");
    await expect(bar.options).toHaveCount(results.length);
    for (const [index, result] of results.entries()) await expect(bar.options.nth(index)).toHaveAccessibleName(new RegExp(`^${esc(result.symbol)} `));
    await expect(bar.options.first()).toHaveAttribute("aria-selected", "true");
    // Down, down, up: the second result, which the input names as its active descendant.
    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp"]) await page.keyboard.press(key);
    await expect(bar.options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(bar.selected).toHaveCount(1);
    await expect(bar.input).toHaveAttribute("aria-activedescendant", (await bar.options.nth(1).getAttribute("id")) ?? "");
    // Up from the first wraps to the last, and down from there back to the first.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(bar.options.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(bar.options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expectPage(page, stockPath(results[1].symbol));
  });
});

test("? and a question asks the assistant, which answers in the chat (the bar opens with / or, on phones, its button)", async ({ page, app }) => {
  await app.goto("/");
  if (app.isPhone) await page.getByRole("navigation", { name: en.nav.primary }).getByRole("button", { name: en.nav.search, exact: true }).click();
  else await page.keyboard.press("/");
  const bar = commandBar(page);
  await expect(bar.dialog).toBeVisible();
  await expect(bar.input).toBeFocused();

  const question = "how is NVDA doing";
  await bar.input.fill(`?${question}`);
  await expect(bar.options).toHaveCount(1);
  await expect(bar.selected).toHaveAccessibleName(tpl(en.command.ask, { q: question }));
  await page.keyboard.press("Enter");
  await expect(bar.dialog).toBeHidden();
  const chat = page.getByRole("dialog", { name: en.ai.chat.title }).getByRole("log", { name: en.ai.chat.title });
  await expect(chat).toContainText(question);
  // The mock model names the ticker of the question and ends its chat answers so.
  await expect(chat).toContainText("NVDA: this is a mock answer from the end-to-end test model");
  await expect(chat).toContainText("Ask a follow-up question to see the conversation continue.");
});
