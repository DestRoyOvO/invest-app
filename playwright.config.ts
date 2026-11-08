import { defineConfig, devices } from "@playwright/test";

import { APP_SERVER_ARGS, appEnv, BASE_URL, LLM_URL, MOCK_ENV, MOCK_SERVER_ARGS, REUSE, STORAGE_STATE } from "./e2e/support/env";

// End-to-end tests against the production build, with synthetic market data (MARKET_DATA_SOURCE=fixtures), the mock
// model (e2e/mock-llm.mjs), no network access for the app beyond this machine and its clock pinned at E2E_NOW (see
// e2e/support/env.ts): no request ever reaches Yahoo or DeepSeek, and a run sees the same data on any day.
// docs/testing.md explains the setup.
//
// Playwright builds and starts both servers itself and refuses to run when the ports are taken. To keep servers
// between runs, start them with `npm run e2e:serve` and run the suite with E2E_REUSE=1; the global setup then checks
// that the app on the port is the fixture-mode production build of this commit. In CI the suite runs on Playwright's
// bundled Chromium; locally it uses Google Chrome unless E2E_CHANNEL=chromium asks for the bundled browser
// (npx playwright install chromium).

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
      command: `node ${MOCK_SERVER_ARGS.join(" ")}`,
      url: `${LLM_URL}/health`,
      env: MOCK_ENV,
      reuseExistingServer: REUSE,
      timeout: 30_000,
    },
    {
      command: `npm run build && node ${APP_SERVER_ARGS.join(" ")}`,
      url: `${BASE_URL}/api/health`,
      env: appEnv(),
      reuseExistingServer: REUSE,
      timeout: 600_000,
      stdout: "pipe",
    },
  ],
});
