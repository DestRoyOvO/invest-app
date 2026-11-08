// Settings of the end-to-end suite, in one place: ports, the app's environment and the test-only credentials.
//
// The password and the session secret below are obvious test values. They exist only for the server the suite starts
// (a production build on 127.0.0.1 with MARKET_DATA_SOURCE=fixtures and the mock model); never use them anywhere else.

import path from "node:path";

/** The app under test (E2E_PORT) and the mock model (E2E_LLM_PORT). Other local dev servers use 3300-3499. */
export const APP_PORT = Number(process.env.E2E_PORT || 3100);
export const LLM_PORT = Number(process.env.E2E_LLM_PORT || 3199);
export const HOST = "127.0.0.1";
export const BASE_URL = `http://${HOST}:${APP_PORT}`;
export const LLM_URL = `http://${HOST}:${LLM_PORT}`;

/** Test-only credentials for the suite's own server. */
export const TEST_PASSWORD = "e2e-test-password-not-a-secret";
export const TEST_SESSION_SECRET = "e2e-test-session-secret-0123456789abcdef";

/** The signed-in browser state written by the global setup (gitignored). */
export const STORAGE_STATE = path.join(__dirname, "..", ".auth", "state.json");

/**
 * The app's environment. Every setting is given, blank meaning "default", so a developer's .env.local (which Next
 * loads too, without overriding variables that are already set) cannot change what the suite tests.
 */
export const APP_ENV: Record<string, string> = {
  MARKET_DATA_SOURCE: "fixtures",
  DEEPSEEK_API_KEY: "test",
  DEEPSEEK_BASE_URL: LLM_URL,
  DEEPSEEK_MODEL: "deepseek-chat",
  ACCESS_PASSWORD: TEST_PASSWORD,
  SESSION_SECRET: TEST_SESSION_SECRET,
  AI_DAILY_LIMIT: "100000",
  SITE_ACCESS: "public",
  TRUST_PROXY: "0",
  SITE_URL: "",
  LOG_LEVEL: "warn",
  NEXT_TELEMETRY_DISABLED: "1",
};
