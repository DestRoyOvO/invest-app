import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cached, clearCache, isFresh, peek } from "./cache";

const T0 = Date.parse("2026-11-07T15:00:00.000Z");

describe("isFresh", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearCache();
  });

  it("is true while cached() would answer without loading, and false once a reload is due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    expect(isFresh("k")).toBe(false);
    await cached("k", { ttlMs: 1_000, staleMs: 60_000 }, async () => 1);
    expect(isFresh("k")).toBe(true);

    // Expired but still inside the stale window: peek() still has a value, yet the next cached() call loads again.
    vi.setSystemTime(T0 + 2_000);
    expect(peek("k")).toBe(1);
    expect(isFresh("k")).toBe(false);
  });

  it("is true while a load is in flight, since concurrent callers share it", async () => {
    let release: (value: number) => void = () => undefined;
    const pending = cached("slow", { ttlMs: 1_000 }, () => new Promise<number>((resolve) => (release = resolve)));
    expect(isFresh("slow")).toBe(true);
    release(5);
    expect(await pending).toBe(5);
  });

  it("is false after a failed first load", async () => {
    await expect(cached("broken", { ttlMs: 1_000 }, () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    expect(isFresh("broken")).toBe(false);
  });
});
