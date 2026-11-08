// Settings of the end-to-end suite, in one place: ports, the clock, the app's environment and how its server starts.
//
// The password and the session secret below are obvious test values. They exist only for the server the suite starts
// (a production build on 127.0.0.1 with MARKET_DATA_SOURCE=fixtures and the mock model); never use them anywhere else.

import { execFileSync } from "node:child_process";
import os from "node:os";
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
 * Where the app server's no-network preload records each connection it refuses, so the suite fails on them (the
 * global setup's teardown reads it): a temporary file per app port, the same for a server Playwright starts and one
 * from `npm run e2e:serve`. The lines also go to the server's stderr.
 */
export const NO_NETWORK_LOG = path.join(os.tmpdir(), `investseek-e2e-no-network-${APP_PORT}.log`);

/**
 * The instant the server's clock starts at, and the browser's with it (E2E_NOW): Saturday 2026-11-07 10:00 in New
 * York, a closed market after Friday's session, with every scheduled event of the fixture data ahead. Any ISO
 * date-time works; E2E_NOW=real runs on the real clock, where the data changes as sessions close.
 */
export const DEFAULT_NOW = "2026-11-07T15:00:00.000Z";
export const E2E_NOW = process.env.E2E_NOW?.trim() || DEFAULT_NOW;
/** The pinned start as epoch ms, or null on the real clock. */
export const PINNED_NOW: number | null = E2E_NOW === "real" ? null : Date.parse(E2E_NOW);
if (PINNED_NOW !== null && Number.isNaN(PINNED_NOW)) throw new Error(`E2E_NOW must be an ISO date-time or "real", got ${JSON.stringify(E2E_NOW)}`);

/**
 * Reuse servers already listening on the two ports (E2E_REUSE=1, for example from `npm run e2e:serve`) instead of
 * starting fresh ones. The global setup still checks that the app is the build this suite tests.
 */
export const REUSE = process.env.E2E_REUSE === "1";

/** The commit checked out (git rev-parse HEAD), or null without git. */
export function gitHead(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * How the app server starts: `next start` on the production build with two preloads, no network access beyond this
 * machine (e2e/support/no-network.mjs) and the clock pinned at E2E_NOW (e2e/support/clock.mjs). Arguments for node,
 * run from the repository root.
 */
export const APP_SERVER_ARGS = [
  "--import",
  "./e2e/support/no-network.mjs",
  "--import",
  "./e2e/support/clock.mjs",
  "node_modules/next/dist/bin/next",
  "start",
  "-H",
  HOST,
  "-p",
  String(APP_PORT),
];

/** How the mock model starts (node arguments) and its environment. */
export const MOCK_SERVER_ARGS = ["e2e/mock-llm.mjs"];
export const MOCK_ENV: Record<string, string> = { E2E_LLM_PORT: String(LLM_PORT), E2E_LLM_HOST: HOST };

/**
 * The app's environment. Every setting is given, blank meaning "default", so a developer's .env.local (which Next
 * loads too, without overriding variables that are already set) cannot change what the suite tests.
 */
export function appEnv(commit: string | null = gitHead()): Record<string, string> {
  return {
    MARKET_DATA_SOURCE: "fixtures",
    DEEPSEEK_API_KEY: "test",
    DEEPSEEK_BASE_URL: LLM_URL,
    DEEPSEEK_MODEL: "deepseek-chat",
    ACCESS_PASSWORD: TEST_PASSWORD,
    SESSION_SECRET: TEST_SESSION_SECRET,
    AI_DAILY_LIMIT: "100000",
    SITE_ACCESS: "public",
    // Every test sends its own X-Forwarded-For (e2e/support/test.ts), so the per-client limits (20 notes in 10
    // minutes) apply to each test, as to clients behind a proxy, instead of to the whole suite.
    TRUST_PROXY: "1",
    SITE_URL: "",
    LOG_LEVEL: "warn",
    NEXT_TELEMETRY_DISABLED: "1",
    // Shown by /api/health, so the global setup can tell a server of another commit.
    GIT_SHA: commit ?? "",
    // Read by the preloads, not by the app.
    E2E_NOW,
    E2E_NO_NETWORK_LOG: NO_NETWORK_LOG,
  };
}
