"use client";

import { useCallback, useSyncExternalStore } from "react";

import { valuePortfolio, type Portfolio, type QuoteLike } from "@/lib/portfolio";
import { normalizeSymbol } from "@/lib/symbols";

// Positions (shares and average cost per symbol), stored only in this browser.

export interface Position {
  shares: number;
  /** Average cost per share. */
  cost: number;
}

export type Holdings = Record<string, Position>;

const STORAGE_KEY = "investseek:holdings:v1";
const EMPTY: Holdings = {};
const listeners = new Set<() => void>();
let snapshot: Holdings | null = null;

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

function read(): Holdings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeHoldings(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  // While nothing was subscribed, another tab may have changed storage without this tab hearing the event.
  if (listeners.size === 0) snapshot = null;
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      snapshot = null;
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): Holdings {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

/** Re-reads storage before a change, so an edit never overwrites positions saved in another tab. */
function latest(): Holdings {
  snapshot = read();
  return snapshot;
}

function write(next: Holdings) {
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  emit();
}

export function useHoldings() {
  const holdings = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const setPosition = useCallback((symbol: string, position: Position): boolean => {
    if (!isPositive(position.shares) || !isPositive(position.cost)) return false;
    write({ ...latest(), [symbol]: position });
    return true;
  }, []);

  const clearPosition = useCallback((symbol: string) => {
    const next = { ...latest() };
    delete next[symbol];
    write(next);
  }, []);

  return { holdings, setPosition, clearPosition };
}

/** Values the stored positions at the given quotes; see lib/portfolio.ts for the currency and missing-price rules. */
export function valuePositions(holdings: Holdings, quotes: ReadonlyMap<string, QuoteLike>): Portfolio {
  return valuePortfolio(
    Object.entries(holdings).map(([symbol, position]) => ({ symbol, shares: position.shares, cost: position.cost })),
    (symbol) => quotes.get(symbol),
  );
}
