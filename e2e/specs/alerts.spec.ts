import { ALERT_LOG_STORAGE_KEY, ALERTS_STORAGE_KEY, createRule, type AlertEvent, type AlertKind, type AlertRule } from "@/lib/alerts";

import {
  dailyBars,
  dataRows,
  listQuotes,
  notificationState,
  nyDate,
  nyDaysTo,
  panel,
  price,
  readLocal,
  seedLocal,
  serverNow,
  signedPct,
  watchNotificationRequests,
  writtenDate,
} from "../support/notes";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Page } from "../support/test";

// Local alerts (lib/alerts.ts): rules of every kind created in the editor, checked by the alert engine against the
// quotes the app reads (/api/quotes); the bell's count of unseen triggers, the rules table and the history; pause,
// edit (which re-arms) and delete with Undo; persistence in investseek:alerts:v1 and investseek:alert-log:v1; the
// catch-up that replays daily bars for a price level crossed while no tab was open; and the notification permission,
// which the app asks for only from a click.
//
// Which rule triggers is computed here from the same quotes, the positions in the browser and the bars, never written
// down as a number.

const KIND_LABEL: Record<AlertKind, string> = {
  above: "Price at or above",
  below: "Price at or below",
  day_move: "Day move of at least",
  pnl_from_cost: "P&L from cost at or beyond",
  earnings_within: "Earnings within",
  cross_ma200: "Crosses the 200-day average",
};

const VALUE_LABEL: Record<Exclude<AlertKind, "cross_ma200">, string> = {
  above: "Price",
  below: "Price",
  day_move: "Move (%)",
  pnl_from_cost: "P&L from cost (%)",
  earnings_within: "Days before the report",
};

const SHORT_NY_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

interface Planned {
  kind: AlertKind;
  value: number | null;
  /** The rule as the rules table words it. */
  rule: string;
  /** The editor's line about the rule at today's quote. */
  context: string;
  /** Whether the condition holds at the quote, so the rule triggers at the first check. */
  met: boolean;
  /** The trigger as the history words it. */
  event?: string;
  /** The rules table's "Now" reading while the rule watches. */
  now?: string;
}

function rulesTable(page: Page) {
  return panel(page, "Rules").getByRole("table");
}

function historyTable(page: Page) {
  return panel(page, "History").getByRole("table");
}

function bell(page: Page) {
  return page.getByRole("banner").getByRole("button", { name: /^Alerts\b/ });
}

/** Creates a rule through the editor opened from the rules panel, after checking what the editor says about it. */
async function createInEditor(page: Page, symbol: string, last: number, plan: Planned): Promise<void> {
  await panel(page, "Rules").getByRole("button", { name: "New alert" }).click();
  const editor = page.getByRole("dialog", { name: "New alert" });
  await editor.getByRole("combobox", { name: "Symbol" }).fill(symbol);
  // The quote of the symbol, once typing pauses.
  await expect(editor.getByText(`Last ${price(last)}`, { exact: true })).toBeVisible();
  await editor.getByRole("combobox", { name: "Condition" }).selectOption({ label: KIND_LABEL[plan.kind] });
  if (plan.kind !== "cross_ma200") await editor.getByRole("textbox", { name: VALUE_LABEL[plan.kind] }).fill(String(plan.value));
  await expect(editor.getByText(plan.context, { exact: true })).toBeVisible();
  const alreadyMet = editor.getByText("The condition already holds, so this alert triggers at the next check.", { exact: true });
  if (plan.met) await expect(alreadyMet).toBeVisible();
  else await expect(alreadyMet).toHaveCount(0);
  await editor.getByRole("button", { name: "Save alert" }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator("[data-toast]").filter({ hasText: `Alert saved: ${symbol} ${plan.rule}` })).toBeVisible();
}

test.describe("rules of every kind", () => {
  test("the editor creates each kind; the rules the quotes meet trigger, the others keep watching", async ({ page, app, request, context }) => {
    test.skip(app.isPhone, "One project is enough for the rule logic; the drawer and the bell are the same on phones.");
    // Six round trips through the editor: on a busy machine this takes longer than the suite's 60 seconds.
    test.slow();
    await watchNotificationRequests(context);
    await app.seedStorage(SAMPLE_DATA);
    const now = await serverNow(request);
    const quote = (await listQuotes(request, ["AAPL"])).get("AAPL");
    if (!quote?.price || quote.changePercent === null || !quote.twoHundredDayAverage || !quote.nextEarningsDate || !quote.regularMarketTime) {
      throw new Error("The AAPL quote lacks a field the rules read");
    }
    const last = quote.price;
    const cost = SAMPLE_DATA.holdings.AAPL.cost;

    const above = Math.floor(last * 0.98);
    const below = Math.floor(last * 0.9);
    const move = Math.abs(quote.changePercent);
    const moveRule = Math.max(0.1, Math.floor(move * 10) / 10);
    const pnl = ((last - cost) / cost) * 100;
    const reportIn = nyDaysTo(now, nyDate(new Date(quote.nextEarningsDate)));
    const versusAverage = (last / quote.twoHundredDayAverage - 1) * 100;
    const session = writtenDate(quote.regularMarketTime.slice(0, 10), { short: true });
    const away = (level: number) => `${Math.abs((level / last - 1) * 100).toFixed(1)}%`;

    const plans: Planned[] = [
      { kind: "above", value: above, rule: `At or above ${price(above)}`, context: `The level is ${away(above)} below the last price.`, met: last >= above, event: `AAPL traded at ${price(last)}, at or above ${price(above)}` },
      { kind: "below", value: below, rule: `At or below ${price(below)}`, context: `The level is ${away(below)} below the last price.`, met: last <= below, now: `${away(below)} away` },
      {
        kind: "day_move",
        value: moveRule,
        rule: `Day move ±${moveRule}% or more`,
        context: `Today ${signedPct(quote.changePercent)}`,
        met: move >= moveRule,
        event: `AAPL moved ${signedPct(quote.changePercent)} on ${session}`,
        now: `today ${signedPct(quote.changePercent)}`,
      },
      { kind: "pnl_from_cost", value: 50, rule: "Gain from cost of 50% or more", context: `P&L from cost now ${signedPct(pnl)}`, met: pnl >= 50, event: `AAPL was ${signedPct(pnl)} from your cost`, now: `P&L ${signedPct(pnl)}` },
      {
        kind: "earnings_within",
        value: 3,
        rule: "Report within 3 days",
        context: `Next report ${SHORT_NY_DATE.format(new Date(quote.nextEarningsDate))}${quote.earningsDateEstimated ? " (est.)" : ""}`,
        met: reportIn <= 3,
        now: `in ${reportIn} days`,
      },
      {
        kind: "cross_ma200",
        value: null,
        rule: "Crosses the 200-day average",
        context: `The price is ${Math.abs(versusAverage).toFixed(1)}% ${versusAverage >= 0 ? "above" : "below"} the 200-day average (${price(quote.twoHundredDayAverage)}).`,
        // A cross needs the price on the other side of the average than at the last check; the editor records the side.
        met: false,
        now: `${signedPct(versusAverage)} vs avg`,
      },
    ];
    const triggered = plans.filter((plan) => plan.met);
    // The fixture day has rules of both outcomes, or the test would not tell them apart.
    expect(triggered.length).toBeGreaterThan(0);
    expect(triggered.length).toBeLessThan(plans.length);

    await app.goto("/alerts");
    await expect(bell(page)).toHaveAccessibleName("Alerts");
    for (const [index, plan] of plans.entries()) {
      await createInEditor(page, "AAPL", last, plan);
      // The permission is asked for once, from the click that saves the first rule; never again.
      expect((await notificationState(page)).requests).toBe(1);
      await expect(dataRows(rulesTable(page))).toHaveCount(index + 1);
    }

    await expect(bell(page)).toHaveAccessibleName(`Alerts, ${triggered.length} new`);
    await expect(page.getByRole("banner").getByText(String(triggered.length), { exact: true })).toBeVisible();
    const rows = dataRows(rulesTable(page));
    for (const plan of plans) {
      const row = rows.filter({ hasText: plan.rule });
      await expect(row).toContainText(plan.met ? "Triggered" : "Watching");
      if (!plan.met && plan.now) await expect(row).toContainText(plan.now);
    }
    const history = dataRows(historyTable(page));
    await expect(history).toHaveCount(triggered.length);
    for (const plan of triggered) await expect(history.filter({ hasText: plan.event })).toHaveCount(1);

    // The alert center lists the same triggers; marking them seen clears the count.
    await bell(page).click();
    const center = page.getByRole("dialog", { name: "Alert center" });
    await expect(center.getByRole("listitem")).toHaveCount(triggered.length);
    for (const plan of triggered) await expect(center.getByRole("listitem").filter({ hasText: plan.event })).toBeVisible();
    await center.getByRole("button", { name: "Mark all seen" }).click();
    await expect(bell(page)).toHaveAccessibleName("Alerts");

    const stored = (await readLocal<AlertRule[]>(page, ALERTS_STORAGE_KEY)) ?? [];
    expect(stored.map((rule) => [rule.kind, rule.value, rule.done])).toEqual(plans.map((plan) => [plan.kind, plan.value, plan.met]));
    const log = (await readLocal<AlertEvent[]>(page, ALERT_LOG_STORAGE_KEY)) ?? [];
    expect(log.map((event) => event.kind).sort()).toEqual(triggered.map((plan) => plan.kind).sort());
    expect(log.every((event) => event.seen)).toBe(true);
  });
});

test.describe("managing rules", () => {
  test("pause, edit and delete with Undo; rules, triggers and their state survive a reload", async ({ page, app, request, context }) => {
    test.skip(app.isPhone, "The row actions are the same on phones (always shown on touch screens).");
    const now = await serverNow(request);
    const quotes = await listQuotes(request, ["NVDA", "MSFT", "AMZN"]);
    const msft = quotes.get("MSFT")?.price;
    const nvda = quotes.get("NVDA")?.price;
    const amzn = quotes.get("AMZN")?.changePercent;
    if (!msft || !nvda || amzn === null || amzn === undefined) throw new Error("Missing quotes");
    // Three rules that watch at today's quotes; the edit moves the MSFT level below its price.
    const nvdaLevel = Math.floor(nvda * 0.8);
    const msftLevel = Math.ceil(msft * 1.15);
    const msftEdited = Math.floor(msft * 0.99);
    const amznMove = Math.ceil(Math.abs(amzn)) + 2;
    const rules = [
      createRule({ symbol: "NVDA", kind: "below", value: nvdaLevel, repeat: "once" }, now),
      createRule({ symbol: "MSFT", kind: "above", value: msftLevel, repeat: "once" }, now),
      createRule({ symbol: "AMZN", kind: "day_move", value: amznMove, repeat: "daily" }, now),
    ];
    await seedLocal(context, { [ALERTS_STORAGE_KEY]: rules });

    await app.goto("/alerts");
    const rows = dataRows(rulesTable(page));
    const row = (symbol: string) => rows.filter({ has: page.getByRole("link", { name: symbol, exact: true }) });
    await expect(rows).toHaveCount(3);
    for (const symbol of ["NVDA", "MSFT", "AMZN"]) await expect(row(symbol)).toContainText("Watching");
    await expect(row("AMZN")).toContainText("Daily");

    // Pause.
    await page.getByRole("button", { name: "Pause the alert for NVDA" }).click();
    await expect(row("NVDA")).toContainText("Paused");
    await expect(page.getByRole("button", { name: "Resume the alert for NVDA" })).toBeVisible();

    // Edit: a new level re-arms the rule, and this one holds at once.
    await page.getByRole("button", { name: "Edit the alert for MSFT" }).click();
    const editor = page.getByRole("dialog", { name: "Edit alert · MSFT" });
    const level = editor.getByRole("textbox", { name: "Price" });
    await expect(level).toHaveValue(String(msftLevel));
    await level.fill(String(msftEdited));
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(editor).toBeHidden();
    await expect(row("MSFT")).toContainText(`At or above ${price(msftEdited)}`);
    await expect(row("MSFT")).toContainText("Triggered");
    await expect(bell(page)).toHaveAccessibleName("Alerts, 1 new");
    await expect(dataRows(historyTable(page))).toHaveText([new RegExp(`MSFT traded at ${price(msft)}, at or above ${price(msftEdited)}`)]);
    // A new note alone keeps the rule's state: it does not fire again.
    await page.getByRole("button", { name: "Edit the alert for MSFT" }).click();
    await editor.getByRole("textbox", { name: "Note (optional)" }).fill("Above the old high");
    await editor.getByRole("button", { name: "Save changes" }).click();
    await expect(editor).toBeHidden();
    await expect(row("MSFT")).toContainText("Above the old high");
    await expect(row("MSFT")).toContainText("Triggered");
    await expect(dataRows(historyTable(page))).toHaveCount(1);
    await expect(bell(page)).toHaveAccessibleName("Alerts, 1 new");

    // Delete, Undo, delete again.
    await page.getByRole("button", { name: "Delete the alert for AMZN" }).click();
    await expect(rows).toHaveCount(2);
    await page.locator("[data-toast]").filter({ hasText: `Alert deleted: AMZN Day move ±${amznMove}% or more` }).getByRole("button", { name: "Undo" }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.getByRole("link")).toHaveText(["NVDA", "MSFT", "AMZN"]);
    await page.getByRole("button", { name: "Delete the alert for AMZN" }).click();
    await expect(rows).toHaveCount(2);

    await expect
      .poll(async () => ((await readLocal<AlertRule[]>(page, ALERTS_STORAGE_KEY)) ?? []).map((rule) => ({ symbol: rule.symbol, value: rule.value, paused: rule.paused, done: rule.done })))
      .toEqual([
        { symbol: "NVDA", value: nvdaLevel, paused: true, done: false },
        { symbol: "MSFT", value: msftEdited, paused: false, done: true },
      ]);

    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect(row("NVDA")).toContainText("Paused");
    await expect(row("MSFT")).toContainText("Triggered");
    await expect(dataRows(historyTable(page))).toHaveCount(1);
    await expect(bell(page)).toHaveAccessibleName("Alerts, 1 new");
    // Resuming starts a fresh watch.
    await page.getByRole("button", { name: "Resume the alert for NVDA" }).click();
    await expect(row("NVDA")).toContainText("Watching");
  });
});

test.describe("on a phone", () => {
  test("the toasts of a saved alert leave the editor's buttons clear", async ({ page, app, request }) => {
    test.skip(!app.isPhone, "Wider screens show the editor at the side, clear of the toasts.");
    test.fixme(true, "components/ui/Toast.tsx: on phones the toasts (z-60, 4rem above the bottom) cover an open bottom sheet's footer, here Save alert and Cancel, for 5 to 10 s");
    await app.seedStorage(SAMPLE_DATA);
    const last = (await listQuotes(request, ["AAPL"])).get("AAPL")?.price;
    if (!last) throw new Error("No AAPL quote");
    const level = Math.floor(last * 0.98);
    await app.goto("/alerts");
    await createInEditor(page, "AAPL", last, {
      kind: "above",
      value: level,
      rule: `At or above ${price(level)}`,
      context: `The level is ${Math.abs((level / last - 1) * 100).toFixed(1)}% below the last price.`,
      met: true,
    });
    // Saved, and triggered at once: two toasts, for 5 and 10 seconds. The next rule is started meanwhile.
    const trigger = page.locator("[data-toast]").filter({ hasText: "AAPL traded at" });
    await expect(trigger).toBeVisible();
    await panel(page, "Rules").getByRole("button", { name: "New alert" }).click();
    const editor = page.getByRole("dialog", { name: "New alert" });
    for (const name of ["Save alert", "Cancel"]) {
      const button = editor.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      await expect(trigger).toBeVisible();
      // What a tap at the middle of the button reaches.
      const reached = await button.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit && element.contains(hit) ? "button" : (hit?.closest("[data-toast]")?.textContent ?? hit?.tagName ?? "nothing");
      });
      expect(reached, `a tap on ${name}`).toBe("button");
    }
  });
});

test.describe("while away", () => {
  test("a price level crossed while no tab was open is reported from daily bars when the app opens", async ({ page, app, request, context }) => {
    const now = await serverNow(request);
    const quote = (await listQuotes(request, ["AAPL"])).get("AAPL");
    if (!quote?.price) throw new Error("No AAPL quote");
    // The rule was last checked after the close four sessions back, so the sessions since then were never seen.
    const { bars } = await dailyBars(request, "AAPL", "1mo");
    const sessions = bars.map((bar) => ({ session: new Date(bar.t).toISOString().slice(0, 10), high: bar.h, low: bar.l }));
    const checked = sessions[sessions.length - 5];
    const since = sessions.slice(-4);
    const highest = Math.max(...since.map((bar) => bar.high));
    test.skip(highest <= quote.price, "No session since the last check traded above today's price.");
    // A level the price is below now, but which a session since the check reached.
    const level = Math.round(((quote.price + highest) / 2) * 100) / 100;
    const hits = since.filter((bar) => bar.high >= level);
    const rule: AlertRule = {
      ...createRule({ symbol: "AAPL", kind: "above", value: level, repeat: "once" }, new Date(`${checked.session}T21:00:00Z`)),
      lastCheckedAt: `${checked.session}T21:00:00.000Z`,
      checkedSession: checked.session,
      checkedHigh: checked.high,
      checkedLow: checked.low,
    };
    await seedLocal(context, { [ALERTS_STORAGE_KEY]: [rule] });
    expect(now.getTime() - Date.parse(rule.lastCheckedAt as string)).toBeGreaterThan(5 * 60_000);

    await app.goto("/alerts");
    const more = hits.length - 1;
    const text = `AAPL traded above ${price(level)} on ${writtenDate(hits[0].session, { short: true })} (high ${price(hits[0].high)})${more === 0 ? "" : more === 1 ? ", and on 1 more session" : `, and on ${more} more sessions`}`;
    const history = dataRows(historyTable(page));
    await expect(history).toHaveCount(1);
    await expect(history).toContainText(text);
    await expect(history).toContainText("While away");
    await expect(dataRows(rulesTable(page))).toContainText("Triggered");
    await expect(bell(page)).toHaveAccessibleName("Alerts, 1 new");
    const [event] = (await readLocal<AlertEvent[]>(page, ALERT_LOG_STORAGE_KEY)) ?? [];
    expect(event?.missed).toEqual({ session: hits[0].session, extreme: hits[0].high, sessions: hits.length });
  });
});

test.describe("notification permission", () => {
  test("is never asked for on page load; the opt-in on /alerts asks once", async ({ page, app, request, context }) => {
    test.skip(app.isPhone, "The permission logic is the same on phones.");
    await watchNotificationRequests(context, { allow: true });
    const now = await serverNow(request);
    const rule = createRule({ symbol: "MSFT", kind: "above", value: 1, repeat: "once" }, now);
    await app.seedStorage(SAMPLE_DATA);
    await seedLocal(context, { [ALERTS_STORAGE_KEY]: [rule] });

    // A rule that holds, a trigger and its toast, two pages: no prompt.
    await app.goto("/stock/MSFT");
    await expect(bell(page)).toHaveAccessibleName("Alerts, 1 new");
    expect(await notificationState(page)).toEqual({ requests: 0, permission: "default" });
    await bell(page).click();
    await page.getByRole("dialog", { name: "Alert center" }).getByRole("link", { name: "Manage alerts" }).click();
    await expect(page).toHaveURL(/\/alerts$/);
    const how = panel(page, "How alerts work");
    await expect(how).toContainText("System notifications are off. Alerts show here and as messages inside the app.");
    expect(await notificationState(page)).toEqual({ requests: 0, permission: "default" });

    await how.getByRole("button", { name: "Allow notifications" }).click();
    await expect(how).toContainText("System notifications are on in this browser.");
    await expect(how.getByRole("button", { name: "Allow notifications" })).toHaveCount(0);
    expect(await notificationState(page)).toEqual({ requests: 1, permission: "granted" });
  });
});
