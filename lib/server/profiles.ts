import "server-only";

import type { HoldingProfile, ProfilesResponse } from "@/types/portfolio";

import { getSummary, hasCachedSummary } from "./yahoo";

// Company profiles for portfolio exposure (Yahoo's sector for holdings outside the stock universe). Each lookup reuses
// the cached quote-page summary (6 hours fresh, 24 hours stale), so a symbol whose quote page was opened recently
// costs no Yahoo call, and the lookups run at most four at a time.

export const MAX_PROFILE_SYMBOLS = 25;
const CONCURRENCY = 4;

/** Uncached Yahoo calls behind getProfiles(symbols): one summary per symbol not in the cache. */
export function uncachedProfileCalls(symbols: readonly string[]): number {
  return symbols.filter((symbol) => !hasCachedSummary(symbol)).length;
}

/** Runs `work` over the items with at most `limit` in flight, keeping each result in its input slot. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await work(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

/** Profiles for the symbols; unknown symbols and failed lookups are listed in `missing`. */
export async function getProfiles(symbols: readonly string[]): Promise<ProfilesResponse> {
  const settled = await mapLimited(symbols, CONCURRENCY, (symbol) => getSummary(symbol));
  const profiles: Record<string, HoldingProfile> = {};
  const missing: string[] = [];
  let degraded = false;
  symbols.forEach((symbol, i) => {
    const outcome = settled[i];
    if (outcome.status === "rejected") degraded = true;
    const summary = outcome.status === "fulfilled" ? outcome.value : null;
    if (!summary) {
      missing.push(symbol);
      return;
    }
    const { profile } = summary;
    profiles[symbol] = {
      symbol,
      name: profile.longName ?? profile.name ?? null,
      sector: profile.sector,
      industry: profile.industry,
      country: profile.country,
      currency: profile.currency,
    };
  });
  return { asOf: new Date().toISOString(), profiles, missing, degraded };
}
