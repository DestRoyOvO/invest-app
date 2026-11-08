import { closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

import { request, type FullConfig } from "@playwright/test";

import { BASE_URL, E2E_NOW, gitHead, NO_NETWORK_LOG, PINNED_NOW, REUSE, STORAGE_STATE, TEST_PASSWORD } from "./env";

// Checks that the app on the port is the server this suite tests, then signs in once through the real sign-in API and
// stores the session cookie as the browser state every spec starts from (specs that need to be signed out open a
// fresh context with an empty state).
//
// At the end of the run (the teardown this setup returns, which runs while the servers are still up), the run fails if
// the app server refused an outbound connection meanwhile: the no-network preload appends each refusal to
// NO_NETWORK_LOG, and only the lines written since this setup count, so a reused server's earlier runs do not.
//
// The production build names the cookie __Host-is_session and marks it Secure. Browsers treat http://127.0.0.1 as a
// secure context, so Chrome keeps and sends it there; Playwright's request context does the same for loopback hosts.
// A state left by an earlier run is reused while the server still accepts it, which keeps local reruns under the
// sign-in limit (5 attempts per client in 15 minutes).

/** The production session cookie; the development server names it is_session. */
const PRODUCTION_COOKIE = "__Host-is_session";

/** How long a server's pinned clock may have run on before its data could differ from a fresh one's. */
const MAX_CLOCK_RUN_MS = 6 * 60 * 60 * 1000;

/** With E2E_NOW=real, how far the server's clock may be from this machine's (the same clock, read twice). */
const REAL_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

interface Health {
  dataSource?: string;
  aiConfigured?: boolean;
  commit?: string | null;
  time?: string;
}

/**
 * Throws unless the app answers as the fixture-mode server of this checkout: fixture data, the mock model, this
 * commit, and a clock started at E2E_NOW (or the real clock, with E2E_NOW=real). A server left running from another
 * branch, in Yahoo mode, on another clock or without the preloads would otherwise be tested by mistake.
 */
async function checkServer(baseURL: string): Promise<void> {
  const context = await request.newContext({ baseURL });
  try {
    const response = await context.get("/api/health");
    if (!response.ok()) throw new Error(`${baseURL}/api/health answered HTTP ${response.status()}.`);
    const health = (await response.json()) as Health;
    const problems: string[] = [];
    if (health.dataSource !== "fixtures") problems.push(`it serves ${health.dataSource ?? "unknown"} market data, not fixtures`);
    if (health.aiConfigured !== true) problems.push("its AI is not configured");
    const head = gitHead();
    if (head && health.commit !== head) problems.push(`it runs commit ${health.commit ?? "unknown"}, but ${head} is checked out`);
    const serverNow = Date.parse(health.time ?? "");
    if (PINNED_NOW !== null) {
      if (!(serverNow >= PINNED_NOW && serverNow <= PINNED_NOW + MAX_CLOCK_RUN_MS)) {
        problems.push(`its clock reads ${health.time ?? "nothing"}, not E2E_NOW=${E2E_NOW} (or it has run for more than six hours)`);
      }
    } else if (!(Math.abs(serverNow - Date.now()) < REAL_CLOCK_TOLERANCE_MS)) {
      problems.push(`its clock reads ${health.time ?? "nothing"}, but E2E_NOW=real expects the real clock (start it with E2E_NOW=real)`);
    }
    if (problems.length > 0) {
      const advice = REUSE ? "Restart it with `npm run e2e:serve`, or run without E2E_REUSE so Playwright starts its own." : "";
      throw new Error(`The server on ${baseURL} is not the one this suite tests: ${problems.join("; ")}. ${advice}`.trim());
    }
  } finally {
    await context.dispose();
  }
}

/** The no-network log from byte `offset` on, or "" when nothing was added. */
function readLogFrom(offset: number): string {
  const size = statSync(NO_NETWORK_LOG).size;
  if (size <= offset) return "";
  const buffer = Buffer.alloc(size - offset);
  const fd = openSync(NO_NETWORK_LOG, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

/**
 * The current length of the no-network log. Throws when the server under test does not write one: without it, a
 * refused connection would only show in the server output and the run would still pass.
 */
function noNetworkLogOffset(): number {
  let size: number;
  try {
    size = statSync(NO_NETWORK_LOG).size;
  } catch {
    size = -1;
  }
  if (size <= 0 || !readLogFrom(0).includes("[no-network] guard active")) {
    throw new Error(`The app server keeps no no-network log at ${NO_NETWORK_LOG}: it was not started with this checkout's e2e/support/env.ts. ${REUSE ? "Restart `npm run e2e:serve`." : ""}`.trim());
  }
  return size;
}

/** Fails the run when the app server refused an outbound connection after `offset`. */
function checkNoNetworkLog(offset: number): void {
  const refused = readLogFrom(offset)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("[no-network] refused"));
  if (refused.length > 0) {
    throw new Error(
      `The app server tried to reach the network ${refused.length} time(s) during the run; fixture mode must answer every request from this machine:\n- ${[...new Set(refused)].join("\n- ")}`,
    );
  }
}

async function isSignedIn(baseURL: string): Promise<boolean> {
  const context = await request.newContext({ baseURL, storageState: STORAGE_STATE }).catch(() => null);
  if (!context) return false;
  try {
    const response = await context.get("/api/auth/status");
    if (!response.ok()) return false;
    const status = (await response.json()) as { authenticated?: boolean; authRequired?: boolean };
    const state = await context.storageState();
    return status.authRequired === true && status.authenticated === true && state.cookies.some((cookie) => cookie.name === PRODUCTION_COOKIE);
  } catch {
    return false;
  } finally {
    await context.dispose();
  }
}

export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  const baseURL = config.projects[0]?.use.baseURL ?? BASE_URL;
  await checkServer(baseURL);
  const logOffset = noNetworkLogOffset();
  const teardown = async () => checkNoNetworkLog(logOffset);
  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  if (await isSignedIn(baseURL)) return teardown;

  const context = await request.newContext({ baseURL });
  try {
    const response = await context.post("/api/auth/login", { data: { password: TEST_PASSWORD }, headers: { origin: baseURL } });
    if (response.status() !== 204) {
      throw new Error(`Sign-in failed with HTTP ${response.status()}: ${(await response.text()).slice(0, 200)}`);
    }
    const state = await context.storageState({ path: STORAGE_STATE });
    // Only the production build sets the __Host- cookie, so this also proves the suite is not testing `next dev`.
    if (!state.cookies.some((cookie) => cookie.name === PRODUCTION_COOKIE)) {
      throw new Error(`The sign-in response set no ${PRODUCTION_COOKIE} cookie: the server is not a production build.`);
    }
  } finally {
    await context.dispose();
  }
  if (!(await isSignedIn(baseURL))) throw new Error("The stored session is not accepted by the server.");
  return teardown;
}
