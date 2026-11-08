import { AI_CHATS_KEY, AI_PREFS_KEY, type ChatHistory, type Conversation } from "@/lib/ai-store";
import type { ChatRequest } from "@/types/api";

import { hitAtCenter, readLocal, seedLocal, serverNow } from "../support/notes";
import { SAMPLE_DATA } from "../support/routes";
import { expect, test, type Page } from "../support/test";

// The research assistant (components/ai/ChatDrawer.tsx) against the mock model: opened from the shell, from a quote
// page and from the command bar's "?"; the "Include my positions" switch and what the request to /api/ai/chat carries
// with it on and off; suggested questions, Copy, Retry; the saved conversations and their limit. ai.spec.ts covers the
// research note, the mock's scenarios, Stop and Regenerate.
//
// The mock answers a chat with "**<symbol or subject>**: this is a mock answer ..." and ends it with "Ask a follow-up
// question to see the conversation continue." Request bodies are read from the page's own requests; an answer is
// complete once it shows its Copy button (the answer streams, so the response itself is not read).

/** The conversations the README promises to keep ("up to 20 chats"). */
const KEPT_CONVERSATIONS = 20;
const ANSWER_END = "Ask a follow-up question to see the conversation continue.";

function drawer(page: Page) {
  return page.getByRole("dialog", { name: "Research assistant" });
}

function conversation(page: Page) {
  return drawer(page).getByRole("log", { name: "Research assistant" });
}

/** One per answer that has finished streaming. */
function copyButtons(page: Page) {
  return conversation(page).getByRole("button", { name: "Copy answer" });
}

/** The body of the next chat request the page sends; fails after 15 seconds without one. */
function nextChatRequest(page: Page): Promise<ChatRequest> {
  return page
    .waitForRequest((request) => new URL(request.url()).pathname === "/api/ai/chat" && request.method() === "POST", { timeout: 15_000 })
    .then((request) => request.postDataJSON() as ChatRequest);
}

/** Types a question into the chat box and sends it with Enter; resolves to the request body once the answer is in. */
async function ask(page: Page, question: string): Promise<ChatRequest> {
  const answered = await copyButtons(page).count();
  const request = nextChatRequest(page);
  const box = drawer(page).getByRole("textbox", { name: "Ask about this page…" });
  await box.fill(question);
  await box.press("Enter");
  const body = await request;
  await expect(copyButtons(page)).toHaveCount(answered + 1);
  await expect(conversation(page).getByText(ANSWER_END, { exact: true })).toHaveCount(answered + 1);
  return body;
}

async function openFromTopBar(page: Page): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: /Open research assistant$/ }).click();
  await expect(drawer(page)).toBeVisible();
}

test.describe("opening the assistant", () => {
  test("from the navigation it is about the market; from a quote page about that symbol", async ({ page, app }) => {
    await app.goto("/");
    // The rail on tablets and desktops, the tab bar on phones: both are the primary navigation.
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Assistant/ }).click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page)).toContainText("Ask about the market. Answers use the data on the page you are viewing.");
    await expect(drawer(page).getByText("Context: Market", { exact: true })).toBeVisible();
    await expect(drawer(page).getByRole("textbox", { name: "Ask about this page…" })).toBeFocused();
    await drawer(page).getByRole("button", { name: "Close" }).click();
    await expect(drawer(page)).toBeHidden();

    // "Why is it moving?" opens the assistant with its question, sent at once about the symbol's move.
    await app.goto("/stock/AAPL");
    const request = nextChatRequest(page);
    await page.getByRole("button", { name: "Why is it moving?" }).click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByText("Context: AAPL", { exact: true })).toBeVisible();
    expect(await request).toMatchObject({
      lang: "en",
      messages: [{ role: "user", content: "Why is AAPL moving today?" }],
      context: { view: "stock", symbol: "AAPL", intent: { kind: "move", symbol: "AAPL" } },
    });
    await expect(copyButtons(page)).toHaveCount(1);
    await expect(conversation(page)).toContainText("Why is AAPL moving today?");
    await expect(conversation(page)).toContainText("AAPL: this is a mock answer from the end-to-end test model");
    await expect(conversation(page)).toContainText(ANSWER_END);
  });
});

test.describe("positions", () => {
  test("“Include my positions” is on by default, says where they go, and decides what the request carries", async ({ page, app }) => {
    test.skip(app.isPhone, "The switch works the same on phones.");
    await app.seedStorage(SAMPLE_DATA);
    const all = Object.entries(SAMPLE_DATA.holdings)
      .map(([symbol, { shares, cost }]) => ({ symbol, shares, cost }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    const bySymbol = (positions: ChatRequest["context"]["positions"]) => [...(positions ?? [])].sort((a, b) => a.symbol.localeCompare(b.symbol));

    await app.goto("/");
    await openFromTopBar(page);
    const toggle = drawer(page).getByRole("switch", { name: "Include my positions" });
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAccessibleDescription("Your positions go to DeepSeek with each question.");
    const withPositions = await ask(page, "What changed in the last session?");
    expect(withPositions.context.view).toBe("market");
    expect(bySymbol(withPositions.context.positions)).toEqual(all);

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAccessibleDescription("Your positions stay in this browser.");
    await expect.poll(() => readLocal(page, AI_PREFS_KEY)).toEqual({ includePositions: false });
    const without = await ask(page, "And what should I read next?");
    expect(without.context).toEqual({ view: "market" });
    // The conversation goes along, the positions do not.
    expect(without.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);

    // The choice is kept; on a quote page only that symbol's own position goes along.
    await app.goto("/stock/AAPL");
    await openFromTopBar(page);
    await expect(toggle).not.toBeChecked();
    await drawer(page).getByRole("button", { name: "New chat" }).click();
    expect((await ask(page, "How did it trade?")).context).toEqual({ view: "stock", symbol: "AAPL" });
    await toggle.click();
    await expect(toggle).toBeChecked();
    const own = await ask(page, "And my position?");
    expect(own.context).toEqual({ view: "stock", symbol: "AAPL", positions: [{ symbol: "AAPL", ...SAMPLE_DATA.holdings.AAPL }] });
  });
});

test.describe("answers", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("a suggested question sends its text, Copy puts the answer on the clipboard, Retry asks a failed question again", async ({ page, app }) => {
    test.skip(app.isPhone, "The answer controls are the same on phones.");
    await app.goto("/");
    await openFromTopBar(page);
    const suggested = drawer(page).getByRole("list", { name: "Suggested questions" }).getByRole("button");
    await expect(suggested.first()).toBeVisible();
    const question = (await suggested.first().textContent()) ?? "";
    expect(question).not.toBe("");
    const request = nextChatRequest(page);
    await suggested.first().click();
    expect((await request).messages).toEqual([{ role: "user", content: question }]);
    await expect(copyButtons(page)).toHaveCount(1);
    await expect(conversation(page)).toContainText(question);
    await expect(conversation(page)).toContainText(ANSWER_END);
    await expect(drawer(page).getByRole("list", { name: "Suggested questions" })).toHaveCount(0);

    // Copy takes the answer as the model wrote it (Markdown), the text the conversation was saved with. The clipboard
    // of Windows turns line ends into CR LF.
    const saved = (await readLocal<ChatHistory>(page, AI_CHATS_KEY))?.conversations[0]?.messages.at(-1);
    expect(saved?.role).toBe("assistant");
    expect(saved?.content).toMatch(/^\*\*[^*]+\*\*: this is a mock answer/);
    expect(saved?.content).toContain(ANSWER_END);
    await copyButtons(page).click();
    await expect(page.locator("[data-toast]").filter({ hasText: "Copied as Markdown." })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.replace(/\r\n/g, "\n")).toBe(saved?.content);

    // E2EERR makes the mock fail mid-answer; Retry sends the same conversation again without repeating the question.
    const failing = "E2EERR what happened to the leaders?";
    const failed = nextChatRequest(page);
    const box = drawer(page).getByRole("textbox", { name: "Ask about this page…" });
    await box.fill(failing);
    await box.press("Enter");
    const firstBody = await failed;
    expect(firstBody.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(firstBody.messages.at(-1)).toEqual({ role: "user", content: failing });
    const alert = conversation(page).getByRole("alert");
    await expect(alert).toHaveText("The response was interrupted.");
    const retried = nextChatRequest(page);
    await conversation(page).getByRole("button", { name: "Retry the question" }).click();
    expect((await retried).messages).toEqual(firstBody.messages);
    // The same marker fails the retry too: one question, one notice, Retry offered again.
    await expect(conversation(page).getByRole("button", { name: "Retry the question" })).toBeEnabled();
    await expect(alert).toHaveText("The response was interrupted.");
    await expect(conversation(page).getByText(failing, { exact: true })).toHaveCount(1);
  });
});

test.describe("the chat footer", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("stays within reach while the Copy toast shows", async ({ page, app }) => {
    await app.goto("/");
    await openFromTopBar(page);
    await ask(page, "Which sectors moved the most?");
    await copyButtons(page).click();
    const copied = page.locator("[data-toast]").filter({ hasText: "Copied as Markdown." });
    await expect(copied).toBeVisible();
    // Its button is Dismiss, told apart from the drawer's Close, and the message says what it dismisses.
    await expect(drawer(page).getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
    await expect(copied.getByRole("button", { name: "Dismiss", exact: true })).toHaveAccessibleDescription("Copied as Markdown.");
    // A follow-up typed at once: the box and Send must take a tap or a click.
    const box = drawer(page).getByRole("textbox", { name: "Ask about this page…" });
    await box.fill("And which lagged?");
    const send = drawer(page).getByRole("button", { name: "Send", exact: true });
    for (const [name, control] of [["the question box", box], ["Send", send]] as const) {
      await expect(control).toBeEnabled();
      expect(await hitAtCenter(control), `a tap on ${name}`).toBe("itself");
    }
  });
});

test.describe("saved conversations", () => {
  test("are kept up to the documented number and reopen from the history", async ({ page, app, context, request }) => {
    test.skip(app.isPhone, "The history menu is the same on phones.");
    const now = (await serverNow(request)).getTime();
    const seeded: Conversation[] = Array.from({ length: KEPT_CONVERSATIONS }, (_, index) => {
      const at = new Date(now - (KEPT_CONVERSATIONS - index) * 3_600_000).toISOString();
      const context = { key: "market", label: "Market" };
      return {
        id: `c-seeded-${index + 1}`,
        title: `Seeded question ${index + 1}`,
        createdAt: at,
        updatedAt: at,
        lang: "en",
        messages: [
          { id: `m-q-${index + 1}`, role: "user", content: `Seeded question ${index + 1}`, at, context },
          { id: `m-a-${index + 1}`, role: "assistant", content: `Seeded answer ${index + 1}`, at, context },
        ],
      };
    });
    await seedLocal(context, { [AI_CHATS_KEY]: { conversations: [...seeded].reverse(), activeId: null } satisfies ChatHistory });

    await app.goto("/");
    await openFromTopBar(page);
    const historyButton = drawer(page).getByRole("button", { name: /^History/ });
    await expect(historyButton).toHaveAccessibleName(`History ${KEPT_CONVERSATIONS}`);
    const question = "Which sectors led the last session?";
    await ask(page, question);

    // The new conversation pushes out the oldest one.
    await expect(historyButton).toHaveAccessibleName(`History ${KEPT_CONVERSATIONS}`);
    await historyButton.click();
    const menu = page.locator(`[id="${await historyButton.getAttribute("aria-controls")}"]`);
    const listed = menu.getByRole("listitem");
    await expect(listed).toHaveCount(KEPT_CONVERSATIONS);
    await expect(listed.first()).toContainText(question);
    await expect(listed.first()).toContainText("Open now");
    const titled = (title: string) => listed.filter({ has: page.getByText(title, { exact: true }) });
    await expect(titled("Seeded question 1")).toHaveCount(0);
    await expect(titled("Seeded question 2")).toHaveCount(1);
    const stored = (await readLocal<ChatHistory>(page, AI_CHATS_KEY)) as ChatHistory;
    expect(stored.conversations).toHaveLength(KEPT_CONVERSATIONS);
    expect(stored.conversations[0]).toMatchObject({ title: question, messages: [{ role: "user", content: question }, { role: "assistant" }] });
    expect(stored.activeId).toBe(stored.conversations[0].id);

    // After a reload the open conversation comes back; an older one opens from the history.
    await page.reload();
    await openFromTopBar(page);
    await expect(conversation(page)).toContainText(question);
    await expect(conversation(page)).toContainText(ANSWER_END);
    await historyButton.click();
    await page
      .locator(`[id="${await historyButton.getAttribute("aria-controls")}"]`)
      .getByRole("button")
      .filter({ has: page.getByText("Seeded question 7", { exact: true }) })
      .click();
    await expect(conversation(page)).toContainText("Seeded answer 7");
    await expect(conversation(page)).not.toContainText(question);
  });
});

test.describe("from the command bar", () => {
  test("a question after ? opens the assistant with it", async ({ page, app }) => {
    test.skip(app.isPhone, "A keyboard flow: phones open the command bar from the search field.");
    await app.goto("/watchlist");
    await page.keyboard.press("/");
    const bar = page.getByRole("dialog", { name: "Command bar" });
    const question = "Which of my stocks report next week?";
    await bar.getByRole("combobox", { name: "Command bar" }).fill(`?${question}`);
    await expect(bar.getByRole("option", { name: `Ask the assistant: ${question}` })).toBeVisible();
    const request = nextChatRequest(page);
    await page.keyboard.press("Enter");
    await expect(drawer(page)).toBeVisible();
    await expect(bar).toBeHidden();
    const body = await request;
    expect(body.messages).toEqual([{ role: "user", content: question }]);
    expect(body.context.view).toBe("watchlist");
    await expect(copyButtons(page)).toHaveCount(1);
    await expect(conversation(page)).toContainText(question);
    await expect(conversation(page)).toContainText(ANSWER_END);
  });
});
