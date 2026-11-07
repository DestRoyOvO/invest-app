"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { symbolsParam } from "@/lib/api-client";
import type { ProfilesResponse } from "@/types/portfolio";

/** The profiles route accepts at most this many symbols. */
const MAX_PROFILES = 25;

/** Key for a profile lookup: unique symbols in a stable order, capped at the route limit. */
export function profilesKey(symbols: readonly string[]): string | null {
  const unique = [...new Set(symbols)].sort().slice(0, MAX_PROFILES);
  return unique.length > 0 ? `/api/profiles?symbols=${symbolsParam(unique)}` : null;
}

/**
 * Yahoo profiles (sector, industry, country) for holdings outside the stock universe, used to group exposure. Profiles
 * change rarely: refreshed every 6 hours, never on focus.
 */
export function useProfiles(symbols: readonly string[]) {
  const key = useMemo(() => profilesKey(symbols), [symbols]);
  return useSWR<ProfilesResponse>(key, { refreshInterval: 6 * 3_600_000, revalidateOnFocus: false, dedupingInterval: 60_000 });
}
