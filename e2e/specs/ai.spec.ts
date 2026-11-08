import { AI_HEADERS } from "@/types/api";

import { LLM_URL } from "../support/env";
import { expect, test, type Page } from "../support/test";

// AI notes stream from the mock model (e2e/mock-llm.mjs) once signed in. A note on a reserved symbol picks the mock's
// scenario: E2ELEN stops at the length limit, E2EERR fails mid-stream, E2ESLOW streams slowly enough to stop, E2EKEY
// is answered as a rejected key. The global setup signed the browser in, so the note panels offer Generate.
//
// The server keeps finished notes for 15 minutes, so a second project or a rerun gets the note from that cache:
// tests that must see the model stream use Regenerate, which skips it.

function notePanel(page: Page) {
  return page.getByRole("region", { name: "AI research note", exact: true });
}

/** The note request's response, once its headers arrive. */
function noteResponse(page: Page) {
  return page.waitForResponse((response) => response.url().endsWith("/api/ai/analyze") && response.request().method() === "POST");
}

interface MockStats {
  started: Record<string, number>;
  completed: Record<string, number>;
  cancelled: Record<string, number>;
}

test.describe("AI research note", () => {
  test("streams a note for the open stock, and a new one on Regenerate", async ({ page, app }) => {
    await app.goto("/stock/AAPL");
    const panel = notePanel(page);
    await panel.getByRole("button", { name: "Generate" }).click();
    await expect(panel.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(panel).toContainText("AAPL (Apple Inc.)");
    await expect(panel).toContainText("Mock answer for automated tests.");

    const regenerated = noteResponse(page);
    await panel.getByRole("button", { name: "Regenerate" }).click();
    expect((await regenerated).headers()[AI_HEADERS.noteCache]).toBe("miss");
    await expect(panel).toContainText("Mock answer for automated tests.");
    await expect(panel.getByRole("button", { name: "Regenerate" })).toBeEnabled();
  });

  test("says so when the model stops at its length limit", async ({ page, app }) => {
    await app.goto("/stock/E2ELEN");
    const panel = notePanel(page);
    await panel.getByRole("button", { name: "Generate" }).click();
    await expect(panel).toContainText("E2ELEN");
    await expect(panel.getByText("Reached the length limit, so the last sentence may be cut off.")).toBeVisible();
  });

  test("keeps the partial text and offers Retry when the stream fails", async ({ page, app }) => {
    await app.goto("/stock/E2EERR");
    const panel = notePanel(page);
    await panel.getByRole("button", { name: "Generate" }).click();
    await expect(panel.getByRole("alert")).toHaveText("The response was interrupted.");
    await expect(panel.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Retry" })).toBeEnabled();
    await expect(panel).not.toContainText("Mock answer for automated tests.");
  });

  test("explains a rejected API key", async ({ page, app }) => {
    await app.goto("/stock/E2EKEY");
    const panel = notePanel(page);
    await panel.getByRole("button", { name: "Generate" }).click();
    await expect(panel.getByRole("alert")).toHaveText("DeepSeek rejected the request. If you run this site, check the API key and the account balance.");
    await expect(panel.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("stops a note that is still streaming, up to the model", async ({ page, app, request }) => {
    const stats = async () => (await (await request.get(`${LLM_URL}/stats`)).json()) as MockStats;
    await app.goto("/stock/E2ESLOW");
    const panel = notePanel(page);
    const before = await stats();
    await panel.getByRole("button", { name: "Generate" }).click();
    await expect(panel.getByRole("heading", { name: "Summary" })).toBeVisible();
    await panel.getByRole("button", { name: "Stop" }).click();

    await expect(panel.getByRole("button", { name: "Regenerate" })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "Stop" })).toHaveCount(0);
    // The app cancels its request to the model, and the mock sees the stream end early.
    await expect.poll(async () => (await stats()).cancelled.slow ?? 0).toBeGreaterThan(before.cancelled.slow ?? 0);
    await page.waitForTimeout(1_000);
    await expect(panel).not.toContainText("Mock answer for automated tests.");
  });
});

test.describe("signed out", () => {
  // A fresh context without the session cookie of the global setup.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the note panel offers to unlock AI instead of generating", async ({ page, app }) => {
    await app.goto("/stock/AAPL");
    const panel = notePanel(page);
    await expect(panel.getByRole("button", { name: "Unlock AI" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Generate" })).toHaveCount(0);
  });

  test("the note API refuses a request without a session", async ({ page }) => {
    const response = await page.request.post("/api/ai/analyze", { data: { kind: "stock", symbol: "AAPL", lang: "en" } });
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});
