import { expect, test } from "../support/test";

// AI notes stream from the mock model (e2e/mock-llm.mjs) once signed in; the reserved symbol E2ELEN makes the mock
// stop at the token limit. The global setup signed the browser in, so the note panels offer Generate.

test.describe("AI research note", () => {
  test("streams a note for the open stock", async ({ page, app }) => {
    await app.goto("/stock/AAPL");
    const panel = page.getByRole("region", { name: "AI research note", exact: true });
    await panel.getByRole("button", { name: "Generate" }).click();
    await expect(panel.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(panel).toContainText("AAPL (Apple Inc.)");
    await expect(panel).toContainText("Mock answer for automated tests.");
    await expect(panel.getByRole("button", { name: "Regenerate" })).toBeEnabled();
  });

  test("says so when the model stops at its length limit", async ({ page, app }) => {
    await app.goto("/stock/E2ELEN");
    const panel = page.getByRole("region", { name: "AI research note", exact: true });
    await panel.getByRole("button", { name: "Generate" }).click();
    await expect(panel).toContainText("E2ELEN");
    await expect(panel.getByText("Reached the length limit, so the last sentence may be cut off.")).toBeVisible();
  });
});

test.describe("signed out", () => {
  // A fresh context without the session cookie of the global setup.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the note panel offers to unlock AI instead of generating", async ({ page, app }) => {
    await app.goto("/stock/AAPL");
    const panel = page.getByRole("region", { name: "AI research note", exact: true });
    await expect(panel.getByRole("button", { name: "Unlock AI" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Generate" })).toHaveCount(0);
  });
});
