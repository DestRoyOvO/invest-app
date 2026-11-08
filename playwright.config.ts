import { defineConfig, devices } from "@playwright/test";

import { APP_ENV, APP_PORT, BASE_URL, HOST, LLM_PORT, LLM_URL, STORAGE_STATE } from "./e2e/support/env";

// End-to-end tests against the production build, with synthetic market data (MARKET_DATA_SOURCE=fixtures) and the
// mock model (e2e/mock-llm.mjs): no request ever reaches Yahoo or DeepSeek. docs/testing.md explains the setup.
//
// Locally an app already running on E2E_PORT (3100) is reused, so `npm run build && npm start -- -H 127.0.0.1 -p 3100`
// with the environment of e2e/support/env.ts in one terminal and `npm run e2e` in another skips the build. In CI the
// suite always builds and starts its own server, and runs on Playwright's bundled Chromium; locally it uses Google
// Chrome unless E2E_CHANNEL=chromium asks for the bundled browser (npx playwright install chromium).

const CI = Boolean(process.env.CI);
const requestedChannel = process.env.E2E_CHANNEL ?? (CI ? "chromium" : "chrome");
const channel = requestedChannel === "chromium" ? undefined : requestedChannel;

export default defineConfig({
  testDir: "./e2e/specs",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  globalSetup: "./e2e/support/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    locale: "en-US",
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], channel, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: "node e2e/mock-llm.mjs",
      url: `${LLM_URL}/health`,
      env: { E2E_LLM_PORT: String(LLM_PORT), E2E_LLM_HOST: HOST },
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      command: `npm run build && npm start -- -H ${HOST} -p ${APP_PORT}`,
      url: `${BASE_URL}/api/health`,
      env: APP_ENV,
      reuseExistingServer: !CI,
      timeout: 600_000,
      stdout: "pipe",
    },
  ],
});
