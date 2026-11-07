"use client";

import { useSyncExternalStore } from "react";

import { normalizeSymbol } from "@/lib/symbols";

const STORAGE_KEY = "investseek:last-symbol";
const FALLBACK = "AAPL";
const listeners = new Set<() => void>();
let snapshot: string | null = null;

function read(): string {
  try {
    return normalizeSymbol(window.localStorage.getItem(STORAGE_KEY)) ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Records the most recently viewed quote so the "Quote" navigation item returns to it. */
export function rememberSymbol(symbol: string) {
  if (snapshot === symbol) return;
  snapshot = symbol;
  try {
    window.localStorage.setItem(STORAGE_KEY, symbol);
  } catch {
    // ignore storage errors
  }
  for (const listener of listeners) listener();
}

export function useLastSymbol(): string {
  return useSyncExternalStore(
    subscribe,
    () => (snapshot ??= read()),
    () => FALLBACK,
  );
}
