import { MESSAGES } from "@/lib/i18n/messages";

import { colorOf, dataRows, listQuotes, panel, resolvedColor, signedPct } from "../support/notes";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Page, type Response } from "../support/test";

// Display preferences (lib/prefs.ts): theme, language, price colors and density. Each is stored in a cookie (is_theme,
// is_lang, is_updown, is_density) and rendered by the server on <html> (data-theme, lang, data-updown, data-density),
// so the first paint is already right: every check reads the document the server sent, after a reload, as well as the
// page itself. Colors are compared with the design tokens the browser resolves (var(--green) and so on), so a change
// of a hue does not fail these tests but a wrong mapping does.

/** The attributes of the <html> start tag of a document response, as the server rendered them. */
async function serverHtml(response: Response | null): Promise<Record<string, string>> {
  if (!response) throw new Error("No document response");
  const tag = /<html\b([^>]*)>/i.exec(await response.text())?.[1] ?? "";
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

async function cookie(page: Page, name: string): Promise<string | undefined> {
  return (await page.context().cookies()).find((entry) => entry.name === name)?.value;
}

/** Opens the display menu in the top bar, picks an option of one of its groups and closes the menu again. */
async function choose(page: Page, group: string, option: string, words = MESSAGES.en): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: words.nav.settings, exact: true }).click();
  const menu = page.getByRole("dialog", { name: words.settings.title });
  await menu.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option, exact: true }).click();
  // A new language renames the menu and its groups; the options keep their names (each language names itself).
  const radio = page.getByRole("dialog").getByRole("radio", { name: option, exact: true });
  await expect(radio).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(radio).toBeHidden();
}

async function canvasColor(page: Page): Promise<string> {
  return page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
}

async function colorScheme(page: Page): Promise<string> {
  return page.locator("html").evaluate((html) => getComputedStyle(html).colorScheme);
}

test.describe("theme", () => {
  test("dark, light and system are rendered by the server and kept in the cookie; system follows the browser", async ({ page, app }) => {
    test.skip(app.isPhone, "The menu, the cookie and the server's rendering are the same on phones.");
    const first = await app.goto("/watchlist");
    // A first visit follows the operating system.
    expect((await serverHtml(first))["data-theme"]).toBe("system");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => colorScheme(page)).toBe("dark");
    const dark = await canvasColor(page);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => colorScheme(page)).toBe("light");
    const light = await canvasColor(page);
    expect(dark).not.toBe(light);

    // An explicit theme wins over the browser's scheme, on the page and in the next document.
    await choose(page, "Theme", "Dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => canvasColor(page)).toBe(dark);
    expect(await cookie(page, "is_theme")).toBe("dark");
    expect((await serverHtml(await page.reload()))["data-theme"]).toBe("dark");
    await expect.poll(() => canvasColor(page)).toBe(dark);

    await page.emulateMedia({ colorScheme: "dark" });
    await choose(page, "Theme", "Light");
    await expect.poll(() => canvasColor(page)).toBe(light);
    expect(await cookie(page, "is_theme")).toBe("light");
    expect((await serverHtml(await page.reload()))["data-theme"]).toBe("light");
    await expect.poll(() => colorScheme(page)).toBe("light");
    await expect.poll(() => canvasColor(page)).toBe(light);

    await choose(page, "Theme", "System");
    expect(await cookie(page, "is_theme")).toBe("system");
    expect((await serverHtml(await page.reload()))["data-theme"]).toBe("system");
    await expect.poll(() => canvasColor(page)).toBe(dark);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => canvasColor(page)).toBe(light);
  });
});

test.describe("language", () => {
  test("Chinese switches the interface and <html lang>, also in the server's document", async ({ page, app }) => {
    test.skip(app.isPhone, "The menu is the same on phones.");
    const zh = MESSAGES.zh;
    await app.goto("/notes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(MESSAGES.en.notes.title);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await choose(page, "Language", "中文");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(zh.notes.title);
    await expect(page.getByRole("banner").getByRole("button", { name: zh.nav.settings, exact: true })).toBeVisible();
    expect(await cookie(page, "is_lang")).toBe("zh");

    const html = await serverHtml(await page.reload());
    expect(html.lang).toBe("zh-CN");
    // Switching the language keeps the price colors on screen: without a cookie of their own they would follow the
    // language (red up in Chinese) after this reload.
    expect(html["data-updown"]).toBe("intl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(zh.notes.title);
    await expect(panel(page, zh.notes.title)).toContainText(zh.notes.pageIntro);

    await choose(page, zh.settings.language, "English", zh);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(MESSAGES.en.notes.title);
    expect((await serverHtml(await page.reload())).lang).toBe("en");
  });
});

test.describe("price colors", () => {
  test("green up, red up and color-blind color an up and a down change, from the server's first paint", async ({ page, app, request }) => {
    test.skip(app.isPhone, "The colors are the same on phones.");
    await app.seedStorage(SAMPLE_DATA);
    const quotes = await listQuotes(request, ["AAPL", "MSFT"]);
    const upChange = quotes.get("AAPL")?.changePercent ?? 0;
    const downChange = quotes.get("MSFT")?.changePercent ?? 0;
    // The fixture day has AAPL up and MSFT down.
    expect(upChange).toBeGreaterThan(0);
    expect(downChange).toBeLessThan(0);

    await app.goto("/watchlist");
    const rows = dataRows(panel(page, "Watchlist").getByRole("table"));
    const up = rows.filter({ has: page.getByRole("link", { name: /^AAPL\b/ }) }).getByText(signedPct(upChange), { exact: true });
    const down = rows.filter({ has: page.getByRole("link", { name: /^MSFT\b/ }) }).getByText(signedPct(downChange), { exact: true });
    await expect(up).toBeVisible();
    await expect(down).toBeVisible();
    const hue = async (token: string) => resolvedColor(page, `var(--${token})`);
    const expectColors = async (upToken: string, downToken: string) => {
      await expect.poll(() => colorOf(up)).toBe(await hue(upToken));
      await expect.poll(() => colorOf(down)).toBe(await hue(downToken));
    };

    await expect(page.locator("html")).toHaveAttribute("data-updown", "intl");
    await expectColors("green", "red");

    await choose(page, "Price colors", "Red up");
    await expectColors("red", "green");
    expect(await cookie(page, "is_updown")).toBe("cn");
    expect((await serverHtml(await page.reload()))["data-updown"]).toBe("cn");
    await expectColors("red", "green");

    await choose(page, "Price colors", "Color-blind");
    await expectColors("blue", "orange");
    expect(await cookie(page, "is_updown")).toBe("cb");
    expect((await serverHtml(await page.reload()))["data-updown"]).toBe("cb");
    await expectColors("blue", "orange");

    await choose(page, "Price colors", "Green up");
    await expectColors("green", "red");
    expect((await serverHtml(await page.reload()))["data-updown"]).toBe("intl");
  });
});

test.describe("density", () => {
  test("compact lowers the row height of data tables, from the server's first paint", async ({ page, app }) => {
    test.skip(app.isPhone, "Phone rows grow to fit 40px touch targets.");
    await app.seedStorage(SAMPLE_DATA);
    await app.goto("/watchlist");
    // The positions table has rows of plain figures, so its rows are exactly as tall as the density's row height.
    const row = dataRows(panel(page, "Positions").getByRole("table")).first();
    await expect(row).toBeVisible();
    const rowHeight = () => page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.height = "var(--row-h)";
      document.body.append(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      return height;
    });
    const height = async () => (await row.boundingBox())?.height ?? 0;
    const comfortable = await rowHeight();
    expect(Math.abs((await height()) - comfortable)).toBeLessThanOrEqual(1.5);

    await choose(page, "Density", "Compact");
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    const compact = await rowHeight();
    expect(compact).toBeLessThan(comfortable);
    await expect.poll(height).toBeLessThanOrEqual(compact + 1.5);
    expect(await height()).toBeGreaterThanOrEqual(compact);
    expect(await cookie(page, "is_density")).toBe("compact");

    expect((await serverHtml(await page.reload()))["data-density"]).toBe("compact");
    await expect(row).toBeVisible();
    expect(Math.abs((await height()) - compact)).toBeLessThanOrEqual(1.5);
  });
});
