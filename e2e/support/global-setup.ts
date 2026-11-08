import { mkdirSync } from "node:fs";
import path from "node:path";

import { request, type FullConfig } from "@playwright/test";

import { BASE_URL, STORAGE_STATE, TEST_PASSWORD } from "./env";

// Signs in once through the real sign-in API and stores the session cookie as the browser state every spec starts
// from (specs that need to be signed out open a fresh context with an empty state).
//
// The production build names the cookie __Host-is_session and marks it Secure. Browsers treat http://127.0.0.1 as a
// secure context, so Chrome keeps and sends it there; Playwright's request context does the same for loopback hosts.
// A state left by an earlier run is reused while the server still accepts it, which keeps local reruns under the
// sign-in limit (5 attempts per client in 15 minutes).

async function isSignedIn(baseURL: string): Promise<boolean> {
  const context = await request.newContext({ baseURL, storageState: STORAGE_STATE }).catch(() => null);
  if (!context) return false;
  try {
    const response = await context.get("/api/auth/status");
    if (!response.ok()) return false;
    const status = (await response.json()) as { authenticated?: boolean; authRequired?: boolean };
    return status.authRequired === true && status.authenticated === true;
  } catch {
    return false;
  } finally {
    await context.dispose();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? BASE_URL;
  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  if (await isSignedIn(baseURL)) return;

  const context = await request.newContext({ baseURL });
  try {
    const response = await context.post("/api/auth/login", { data: { password: TEST_PASSWORD }, headers: { origin: baseURL } });
    if (response.status() !== 204) {
      throw new Error(`Sign-in failed with HTTP ${response.status()}: ${(await response.text()).slice(0, 200)}`);
    }
    const state = await context.storageState({ path: STORAGE_STATE });
    const cookie = state.cookies.find((c) => c.name.endsWith("is_session"));
    if (!cookie) throw new Error("The sign-in response set no session cookie.");
  } finally {
    await context.dispose();
  }
  if (!(await isSignedIn(baseURL))) throw new Error("The stored session is not accepted by the server.");
}
