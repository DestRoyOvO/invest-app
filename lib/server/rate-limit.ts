import "server-only";

import { isIPv4, isIPv6 } from "node:net";

import { MINUTE } from "./cache";

// In-memory sliding-window rate limits plus a process-wide daily AI budget.
// State lives on globalThis (so dev-mode module reloads keep it) and is bounded. With several server instances
// each instance enforces its own limits, which is acceptable for a single-user deployment.

export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  analyze: { name: "analyze", limit: 20, windowMs: 10 * MINUTE },
  chat: { name: "chat", limit: 40, windowMs: 10 * MINUTE },
  login: { name: "login", limit: 5, windowMs: 15 * MINUTE },
  /**
   * Sign-in attempts from all clients together. Per-client limits can be sidestepped by rotating addresses (an IPv6
   * block, or a forged first X-Forwarded-For hop behind a proxy that appends to the header), so this caps password
   * guessing for the whole server. A flood can delay new sign-ins, but existing sessions keep working.
   */
  loginGlobal: { name: "login-global", limit: 30, windowMs: 15 * MINUTE },
  /** Public market-data routes: generous for real use (a few tabs polling), but stops scripted Yahoo-quota abuse. */
  market: { name: "market", limit: 600, windowMs: 5 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/** Key for limits shared by every client. */
export const GLOBAL_KEY = "*";

const MAX_KEY_LENGTH = 64;

/** The eight 16-bit groups of an address that isIPv6() accepted (zone ids and an embedded IPv4 tail allowed). */
function ipv6Groups(address: string): number[] {
  let text = address.split("%")[0];
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
  }
  const parse = (part: string | undefined) => (part ? part.split(":").map((group) => parseInt(group, 16)) : []);
  const [head, rest] = text.split("::");
  const headGroups = parse(head);
  if (rest === undefined) return headGroups;
  const restGroups = parse(rest);
  return [...headGroups, ...new Array<number>(8 - headGroups.length - restGroups.length).fill(0), ...restGroups];
}

/**
 * Rate-limit key for a client address. IPv6 clients are grouped by their /64 prefix (one subscriber's block, which a
 * client can rotate through freely), IPv4-mapped IPv6 and "address:port" forms collapse to the address, and anything
 * else is length-bounded so that a forged header cannot bloat the limiter's memory.
 */
export function clientKey(address: string): string {
  let value = address.trim().toLowerCase();
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value) ?? /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (withPort) value = withPort[1];
  if (isIPv4(value)) return value;
  if (!isIPv6(value)) return value.slice(0, MAX_KEY_LENGTH);
  const groups = ipv6Groups(value);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  const prefix = groups.slice(0, 4).map((group) => group.toString(16));
  return `${prefix.join(":")}::/64`;
}

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export const DEFAULT_AI_DAILY_LIMIT = 200;
const MAX_TRACKED_KEYS = 10_000;

interface Bucket {
  /** Hit timestamps inside the window, oldest first; never longer than the rule's limit. */
  hits: number[];
  windowMs: number;
}

interface LimiterState {
  buckets: Map<string, Bucket>;
  budget: { day: string; used: number };
}

const globalState = globalThis as unknown as { __investseekRateLimit?: LimiterState };
const state: LimiterState = (globalState.__investseekRateLimit ??= { buckets: new Map(), budget: { day: "", used: 0 } });

function evictIfNeeded(now: number): void {
  if (state.buckets.size <= MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of state.buckets) {
    const newest = bucket.hits[bucket.hits.length - 1] ?? 0;
    if (newest <= now - bucket.windowMs) state.buckets.delete(key);
  }
  // Still too many active keys: drop the least recently used ones (the Map is kept in recency order).
  while (state.buckets.size > MAX_TRACKED_KEYS) {
    const oldest = state.buckets.keys().next().value;
    if (oldest === undefined) break;
    state.buckets.delete(oldest);
  }
}

/** Records one hit for `key` under `rule` unless the window is full. Rejected attempts are not recorded. */
export function consumeRateLimit(rule: RateLimitRule, key: string, now: number = Date.now()): RateLimitResult {
  const id = `${rule.name}:${key}`;
  const windowStart = now - rule.windowMs;
  const hits = (state.buckets.get(id)?.hits ?? []).filter((t) => t > windowStart);
  const full = hits.length >= rule.limit;
  if (!full) hits.push(now);

  // Re-inserting moves the key to the most recently used position, rejected or not, so that a flood of new keys
  // cannot evict (and thereby reset) a bucket that is still being hit.
  state.buckets.delete(id);
  state.buckets.set(id, { hits, windowMs: rule.windowMs });
  evictIfNeeded(now);

  // A full window frees a slot when its oldest hit expires.
  if (full) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + rule.windowMs - now) / 1000)) };
  return { ok: true, remaining: rule.limit - hits.length };
}

/** AI_DAILY_LIMIT as a positive integer; anything else falls back to the default of 200. */
export function readDailyLimit(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.AI_DAILY_LIMIT?.trim() ?? "";
  if (!/^\d{1,7}$/.test(raw)) return DEFAULT_AI_DAILY_LIMIT;
  const value = Number(raw);
  return value > 0 ? value : DEFAULT_AI_DAILY_LIMIT;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now: number): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

function currentBudget(now: number): { day: string; used: number } {
  const day = utcDay(now);
  if (state.budget.day !== day) state.budget = { day, used: 0 };
  return state.budget;
}

/** Checks the daily AI budget without using it (fast rejection before any work is done). */
export function checkDailyBudget(now: number = Date.now(), limit: number = readDailyLimit()): RateLimitResult {
  const budget = currentBudget(now);
  if (budget.used >= limit) return { ok: false, retryAfterSeconds: secondsUntilNextUtcDay(now) };
  return { ok: true, remaining: limit - budget.used };
}

/** Uses one unit of the daily AI budget. Call it right before a model request is made. */
export function consumeDailyBudget(now: number = Date.now(), limit: number = readDailyLimit()): RateLimitResult {
  const budget = currentBudget(now);
  if (budget.used >= limit) return { ok: false, retryAfterSeconds: secondsUntilNextUtcDay(now) };
  budget.used += 1;
  return { ok: true, remaining: limit - budget.used };
}

/** Gives back one unit, for a request that consumed the budget but never reached the model. */
export function refundDailyBudget(now: number = Date.now()): void {
  const budget = currentBudget(now);
  if (budget.used > 0) budget.used -= 1;
}

/** Test helper. */
export function resetRateLimits(): void {
  state.buckets.clear();
  state.budget = { day: "", used: 0 };
}
