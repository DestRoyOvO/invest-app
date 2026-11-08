import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkDailyBudget,
  clientKey,
  consumeDailyBudget,
  consumeRateLimit,
  DEFAULT_AI_DAILY_LIMIT,
  FIXTURE_MARKET_LIMIT,
  marketRateLimit,
  RATE_LIMITS,
  readDailyLimit,
  refundDailyBudget,
  resetRateLimits,
  type RateLimitRule,
} from "./rate-limit";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 10, 7, 15, 0, 0);

describe("consumeRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("uses the configured limits", () => {
    expect(RATE_LIMITS.analyze).toMatchObject({ limit: 20, windowMs: 10 * MINUTE });
    expect(RATE_LIMITS.chat).toMatchObject({ limit: 40, windowMs: 10 * MINUTE });
    expect(RATE_LIMITS.login).toMatchObject({ limit: 5, windowMs: 15 * MINUTE });
    expect(RATE_LIMITS.loginGlobal).toMatchObject({ limit: 30, windowMs: 15 * MINUTE });
  });

  it("raises only the market-data limit while serving fixture data", () => {
    expect(marketRateLimit({})).toBe(RATE_LIMITS.market);
    expect(marketRateLimit({ MARKET_DATA_SOURCE: "yahoo" })).toBe(RATE_LIMITS.market);
    const fixtures = marketRateLimit({ MARKET_DATA_SOURCE: "fixtures" });
    expect(fixtures).toBe(FIXTURE_MARKET_LIMIT);
    expect(fixtures.limit).toBeGreaterThan(100 * RATE_LIMITS.market.limit);
    expect(fixtures.name).toBe(RATE_LIMITS.market.name);
  });

  it("allows up to the limit inside the window, then reports when a slot frees up", () => {
    const rule = RATE_LIMITS.login;
    for (let i = 0; i < rule.limit; i += 1) {
      expect(consumeRateLimit(rule, "1.2.3.4", T0 + i * MINUTE)).toEqual({ ok: true, remaining: rule.limit - i - 1 });
    }
    // The oldest hit (T0) leaves the 15-minute window at T0 + 15 min.
    expect(consumeRateLimit(rule, "1.2.3.4", T0 + 5 * MINUTE)).toEqual({ ok: false, retryAfterSeconds: 10 * 60 });
  });

  it("slides: a slot opens as soon as the oldest hit leaves the window", () => {
    const rule: RateLimitRule = { name: "test", limit: 2, windowMs: 10_000 };
    expect(consumeRateLimit(rule, "k", T0).ok).toBe(true);
    expect(consumeRateLimit(rule, "k", T0 + 4_000).ok).toBe(true);
    expect(consumeRateLimit(rule, "k", T0 + 9_999)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(consumeRateLimit(rule, "k", T0 + 10_001).ok).toBe(true);
    expect(consumeRateLimit(rule, "k", T0 + 10_002).ok).toBe(false);
    expect(consumeRateLimit(rule, "k", T0 + 14_001).ok).toBe(true);
  });

  it("does not count rejected attempts", () => {
    const rule: RateLimitRule = { name: "test", limit: 1, windowMs: 10_000 };
    expect(consumeRateLimit(rule, "k", T0).ok).toBe(true);
    for (let i = 1; i < 10; i += 1) expect(consumeRateLimit(rule, "k", T0 + i * 500).ok).toBe(false);
    expect(consumeRateLimit(rule, "k", T0 + 10_001).ok).toBe(true);
  });

  it("keeps keys and rules independent", () => {
    const a: RateLimitRule = { name: "a", limit: 1, windowMs: MINUTE };
    const b: RateLimitRule = { name: "b", limit: 1, windowMs: MINUTE };
    expect(consumeRateLimit(a, "ip1", T0).ok).toBe(true);
    expect(consumeRateLimit(a, "ip1", T0).ok).toBe(false);
    expect(consumeRateLimit(a, "ip2", T0).ok).toBe(true);
    expect(consumeRateLimit(b, "ip1", T0).ok).toBe(true);
  });

  it("stays bounded by evicting the least recently used keys", () => {
    const rule: RateLimitRule = { name: "bounded", limit: 1, windowMs: MINUTE };
    expect(consumeRateLimit(rule, "first", T0).ok).toBe(true);
    expect(consumeRateLimit(rule, "first", T0).ok).toBe(false);
    for (let i = 0; i < 10_000; i += 1) consumeRateLimit(rule, `key-${i}`, T0);
    // "first" was the least recently used key and has been evicted, so it starts with a fresh window.
    expect(consumeRateLimit(rule, "first", T0).ok).toBe(true);
  });

  it("does not let a flood of new keys evict a bucket that is still being hit", () => {
    const rule: RateLimitRule = { name: "flood", limit: 1, windowMs: MINUTE };
    expect(consumeRateLimit(rule, "hot", T0).ok).toBe(true);
    for (let i = 0; i < 9_999; i += 1) {
      consumeRateLimit(rule, `key-${i}`, T0);
      // Rejected attempts still mark the bucket as recently used.
      if (i % 1_000 === 0 || i === 9_998) expect(consumeRateLimit(rule, "hot", T0).ok).toBe(false);
    }
    for (let i = 0; i < 5; i += 1) consumeRateLimit(rule, `extra-${i}`, T0);
    expect(consumeRateLimit(rule, "hot", T0).ok).toBe(false);
  });
});

describe("clientKey", () => {
  it("keeps IPv4 addresses and strips ports", () => {
    expect(clientKey("203.0.113.9")).toBe("203.0.113.9");
    expect(clientKey(" 203.0.113.9:51234 ")).toBe("203.0.113.9");
    expect(clientKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientKey("::FFFF:CB00:7109")).toBe("203.0.113.9");
  });

  it("groups IPv6 clients by /64, so rotating inside one block does not reset the limit", () => {
    const key = clientKey("2001:db8:abcd:12:1::5");
    expect(key).toBe("2001:db8:abcd:12::/64");
    expect(clientKey("2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff")).toBe(key);
    expect(clientKey("[2001:db8:abcd:12::99]:443")).toBe(key);
    expect(clientKey("2001:db8:abcd:13::1")).not.toBe(key);
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
    expect(clientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("bounds anything else in length", () => {
    expect(clientKey("unknown")).toBe("unknown");
    expect(clientKey("local")).toBe("local");
    expect(clientKey(`forged-${"x".repeat(10_000)}`)).toHaveLength(64);
  });
});

describe("daily AI budget", () => {
  beforeEach(() => resetRateLimits());

  it("reads AI_DAILY_LIMIT as a positive integer with a default", () => {
    expect(readDailyLimit({})).toBe(DEFAULT_AI_DAILY_LIMIT);
    expect(readDailyLimit({ AI_DAILY_LIMIT: "50" })).toBe(50);
    expect(readDailyLimit({ AI_DAILY_LIMIT: " 75 " })).toBe(75);
    for (const invalid of ["", "0", "-5", "abc", "12.5", "1e3"]) {
      expect(readDailyLimit({ AI_DAILY_LIMIT: invalid })).toBe(DEFAULT_AI_DAILY_LIMIT);
    }
  });

  it("consumes until the limit and resets at UTC midnight", () => {
    expect(consumeDailyBudget(T0, 2)).toEqual({ ok: true, remaining: 1 });
    expect(consumeDailyBudget(T0, 2)).toEqual({ ok: true, remaining: 0 });
    // 15:00 UTC: nine hours until the next UTC day.
    expect(consumeDailyBudget(T0, 2)).toEqual({ ok: false, retryAfterSeconds: 9 * 3600 });
    expect(checkDailyBudget(T0, 2).ok).toBe(false);
    expect(consumeDailyBudget(Date.UTC(2026, 10, 8, 0, 0, 1), 2).ok).toBe(true);
  });

  it("checks without consuming and refunds unused requests", () => {
    expect(checkDailyBudget(T0, 1)).toEqual({ ok: true, remaining: 1 });
    expect(checkDailyBudget(T0, 1)).toEqual({ ok: true, remaining: 1 });
    expect(consumeDailyBudget(T0, 1).ok).toBe(true);
    expect(consumeDailyBudget(T0, 1).ok).toBe(false);
    refundDailyBudget(T0);
    expect(consumeDailyBudget(T0, 1).ok).toBe(true);
  });

  it("never refunds below zero", () => {
    refundDailyBudget(T0);
    expect(checkDailyBudget(T0, 1)).toEqual({ ok: true, remaining: 1 });
  });
});
