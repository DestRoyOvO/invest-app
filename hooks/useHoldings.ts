"use client";

import { createLocalStore } from "@/lib/local-store";
import { valuePortfolio, type Portfolio, type QuoteLike } from "@/lib/portfolio";
import { normalizeSymbol } from "@/lib/symbols";

import { useLocalStore } from "./useLocalStore";

// Positions (shares and average cost per symbol), stored only in this browser through a local store
// (lib/local-store.ts), so every component and every open tab stays in sync.

export interface Position {
  shares: number;
  /** Average cost per share. */
  cost: number;
}

export type Holdings = Record<string, Position>;

export const HOLDINGS_STORAGE_KEY = "investseek:holdings:v1";
const EMPTY: Holdings = {};

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function sanitizeHoldings(value: unknown): Holdings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Holdings = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const symbol = normalizeSymbol(key);
    if (!symbol || !raw || typeof raw !== "object") continue;
    const { shares, cost } = raw as { shares?: unknown; cost?: unknown };
    if (isPositive(shares) && isPositive(cost)) out[symbol] = { shares, cost };
  }
  return out;
}

/** The store behind useHoldings; registered for backup and restore. */
export const holdingsStore = createLocalStore<Holdings>({ key: HOLDINGS_STORAGE_KEY, sanitize: sanitizeHoldings, empty: EMPTY });

/** Saves a position; false (and nothing saved) for an invalid symbol or a non-positive share count or cost. */
export function setPosition(symbol: string, position: Position): boolean {
  const key = normalizeSymbol(symbol);
  if (!key || !isPositive(position.shares) || !isPositive(position.cost)) return false;
  holdingsStore.update((current) => ({ ...current, [key]: { shares: position.shares, cost: position.cost } }));
  return true;
}

/** Removes the position for the symbol, if any. */
export function clearPosition(symbol: string) {
  holdingsStore.update((current) => {
    if (!(symbol in current)) return current;
    const next = { ...current };
    delete next[symbol];
    return next;
  });
}

export function useHoldings() {
  const holdings = useLocalStore(holdingsStore);
  return { holdings, setPosition, clearPosition };
}

/** Values the stored positions at the given quotes; see lib/portfolio.ts for the currency and missing-price rules. */
export function valuePositions(holdings: Holdings, quotes: ReadonlyMap<string, QuoteLike>): Portfolio {
  return valuePortfolio(
    Object.entries(holdings).map(([symbol, position]) => ({ symbol, shares: position.shares, cost: position.cost })),
    (symbol) => quotes.get(symbol),
  );
}
