import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as health } from "@/app/api/health/route";
import packageJson from "@/package.json";
import type { HealthResponse } from "@/types/api";

import { APP_VERSION, buildHealth, DOWN_AFTER_FAILURES, isUpstreamReady } from "./health";
import { createSessionToken, readAuthConfig } from "./session";
import { getUpstreamStats, resetUpstreamStats, upstream, type UpstreamStats } from "./yahoo";

const T0 = Date.parse("2026-11-07T15:00:00.000Z");
const MINUTE = 60_000;

function stats(overrides: Partial<UpstreamStats>): UpstreamStats {
  return { pending: 0, lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, failingSince: null, ...overrides };
}

const iso = (ms: number) => new Date(ms).toISOString();

async function failCall(): Promise<void> {
  await upstream(() => Promise.reject(new Error("fetch failed"))).catch(() => undefined);
}

describe("isUpstreamReady", () => {
  it("is ready without calls, after a success and during short failure bursts", () => {
    expect(isUpstreamReady(stats({}), T0)).toBe(true);
    expect(isUpstreamReady(stats({ lastSuccessAt: iso(T0) }), T0)).toBe(true);
    // Many failures within a few seconds: not sustained yet.
    expect(isUpstreamReady(stats({ consecutiveFailures: 20, failingSince: iso(T0 - 10_000), lastFailureAt: iso(T0) }), T0)).toBe(true);
    // Sustained, but too few calls to call it down.
    expect(isUpstreamReady(stats({ consecutiveFailures: DOWN_AFTER_FAILURES - 1, failingSince: iso(T0 - 10 * MINUTE), lastFailureAt: iso(T0) }), T0)).toBe(true);
  });

  it("is not ready after sustained recent failure", () => {
    const down = stats({ consecutiveFailures: DOWN_AFTER_FAILURES, failingSince: iso(T0 - 3 * MINUTE), lastFailureAt: iso(T0 - MINUTE) });
    expect(isUpstreamReady(down, T0)).toBe(false);
    // Nothing has been tried for a long time: the old streak no longer says anything.
    expect(isUpstreamReady(down, T0 + 30 * MINUTE)).toBe(true);
  });
});

describe("buildHealth", () => {
  beforeEach(() => resetUpstreamStats());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetUpstreamStats();
  });

  it("reports version, commit, uptime and data source for liveness", () => {
    vi.stubEnv("GIT_SHA", "0123456789abcdef");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const { status, body } = buildHealth({ ready: false, now: T0 });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, time: iso(T0), version: packageJson.version, commit: "0123456789abcdef", dataSource: "yahoo" });
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.upstream).toBeUndefined();
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("counts failures in upstream() and turns readiness off after sustained failure", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < DOWN_AFTER_FAILURES; i++) {
      vi.setSystemTime(T0 + i * MINUTE);
      await failCall();
    }
    const now = T0 + (DOWN_AFTER_FAILURES - 1) * MINUTE;
    expect(getUpstreamStats()).toMatchObject({ consecutiveFailures: DOWN_AFTER_FAILURES, failingSince: iso(T0), lastFailureAt: iso(now), pending: 0 });
    const down = buildHealth({ ready: true, now });
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({ ok: false, upstream: { ready: false, consecutiveFailures: DOWN_AFTER_FAILURES } });

    // Liveness stays green during the outage, so a container health check never restarts the app because of Yahoo.
    expect(buildHealth({ ready: false, now }).status).toBe(200);

    await upstream(() => Promise.resolve("ok"));
    const up = buildHealth({ ready: true, now: Date.now() });
    expect(up.status).toBe(200);
    expect(up.body.upstream).toMatchObject({ ready: true, consecutiveFailures: 0, failingSince: null });
  });

  it("does not count Yahoo's answers about unknown symbols as failures", async () => {
    await upstream(() => Promise.reject(new Error("No data found, symbol may be delisted"))).catch(() => undefined);
    await upstream(() => Promise.reject(Object.assign(new Error("Invalid Search Query"), { name: "BadRequestError" }))).catch(() => undefined);
    expect(getUpstreamStats()).toMatchObject({ consecutiveFailures: 0, lastFailureAt: null });
    expect(getUpstreamStats().lastSuccessAt).not.toBeNull();
  });
});

describe("GET /api/health", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetUpstreamStats();
  });

  it("reports whether AI is configured, from the environment alone", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test-not-real");
    const response = await health(new Request("http://localhost/api/health"));
    const body = (await response.json()) as HealthResponse;
    expect(body).toMatchObject({ ok: true, aiConfigured: true });
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(((await (await health(new Request("http://localhost/api/health"))).json()) as HealthResponse).aiConfigured).toBe(false);
  });

  it("answers liveness with 200 and readiness with 503 after sustained failure", async () => {
    const live = await health(new Request("http://localhost/api/health"));
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(((await live.json()) as HealthResponse).upstream).toBeUndefined();

    const ready = await health(new Request("http://localhost/api/health?ready=1"));
    expect(ready.status).toBe(200);
    expect(((await ready.json()) as HealthResponse).upstream).toMatchObject({ ready: true });

    vi.useFakeTimers();
    for (let i = 0; i < DOWN_AFTER_FAILURES; i++) {
      vi.setSystemTime(T0 + i * MINUTE);
      await failCall();
    }
    const notReady = await health(new Request("http://localhost/api/health?ready"));
    expect(notReady.status).toBe(503);
    expect(((await notReady.json()) as HealthResponse).ok).toBe(false);
    expect((await health(new Request("http://localhost/api/health?ready=0"))).status).toBe(200);
  });

  it("shows the times of the latest Yahoo calls on a private site only to a signed-in caller", async () => {
    vi.stubEnv("SITE_ACCESS", "private");
    vi.stubEnv("ACCESS_PASSWORD", "correct horse battery staple");
    vi.stubEnv("SESSION_SECRET", "0123456789abcdef0123456789abcdef-test");
    vi.useFakeTimers();
    for (let i = 0; i < DOWN_AFTER_FAILURES; i++) {
      vi.setSystemTime(T0 + i * MINUTE);
      await failCall();
    }
    const url = "http://localhost/api/health?ready=1";

    const anonymous = await health(new Request(url));
    expect(anonymous.status).toBe(503);
    expect(((await anonymous.json()) as HealthResponse).upstream).toEqual({
      pending: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: DOWN_AFTER_FAILURES,
      failingSince: null,
      ready: false,
    });

    const auth = readAuthConfig();
    const cookie = `${auth.cookieName}=${createSessionToken(auth.sessionKey as Buffer)}`;
    const owner = await health(new Request(url, { headers: { cookie } }));
    expect(((await owner.json()) as HealthResponse).upstream).toMatchObject({
      failingSince: iso(T0),
      lastFailureAt: iso(T0 + (DOWN_AFTER_FAILURES - 1) * MINUTE),
    });
  });
});
