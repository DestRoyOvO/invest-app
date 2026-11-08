import { defineConfig, devices } from "@playwright/test";

import { APP_SERVER_ARGS, appEnv, BASE_URL, LLM_URL, MOCK_ENV, MOCK_SERVER_ARGS, REUSE, STORAGE_STATE } from "../support/env";

// `npm run screenshots`: regenerates the README images (docs/screenshots, or SCREENSHOTS_DIR) from the fixture data,
// with the end-to-end suite's servers and settings (e2e/support/env.ts: fixture data, the mock model, no network access,
// the clock pinned at E2E_NOW, E2E_PORT, E2E_LLM_PORT and E2E_REUSE) and one change: the app's clock stands still at
// E2E_NOW (frozen-clock.mjs in place of the suite's clock.mjs), so the times the server stamps on its data are the
// same in every run and so are the images. readme.shots.ts lists the images; docs/testing.md (Screenshots) explains
// the command. Its files end in .shots.ts, so neither `npm run e2e` (e2e/specs) nor Vitest (*.test.ts) picks them up.

const CI = Boolean(process.env.CI);
const requestedChannel = process.env.E2E_CHANNEL ?? (CI ? "chromium" : "chrome");
const channel = requestedChannel === "chromium" ? undefined : requestedChannel;

const SUITE_CLOCK = "./e2e/support/clock.mjs";
const appServerArgs = APP_SERVER_ARGS.map((arg) => (arg === SUITE_CLOCK ? "./e2e/screenshots/frozen-clock.mjs" : arg));
if (appServerArgs.every((arg, i) => arg === APP_SERVER_ARGS[i])) throw new Error(`APP_SERVER_ARGS no longer preloads ${SUITE_CLOCK}: update e2e/screenshots/playwright.config.ts.`);

export default defineConfig({
  testDir: ".",
  testMatch: "*.shots.ts",
  outputDir: "../../test-results/screenshots",
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  workers: 3,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    locale: "en-US",
    timezoneId: "America/New_York",
    // The app finishes its animations and transitions at once (app/globals.css), and the captures skip what is left.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    // Desktop images: the viewport at device scale factor 1. The phone image is tagged @phone.
    { name: "desktop", grepInvert: /@phone/, use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: "phone", grep: /@phone/, use: { ...devices["Pixel 7"], channel, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: `node ${MOCK_SERVER_ARGS.join(" ")}`,
      url: `${LLM_URL}/health`,
      env: MOCK_ENV,
      reuseExistingServer: REUSE,
      timeout: 30_000,
      cwd: "../..",
    },
    {
      command: `npm run build && node ${appServerArgs.join(" ")}`,
      url: `${BASE_URL}/api/health`,
      env: appEnv(),
      reuseExistingServer: REUSE,
      timeout: 600_000,
      stdout: "pipe",
      cwd: "../..",
    },
  ],
});
