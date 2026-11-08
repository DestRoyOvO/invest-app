"use client";

import { useSyncExternalStore } from "react";

import { normalizeSymbol } from "@/lib/symbols";

import { addRecent } from "./useRecents";

// The last quote viewed, stored as a bare string under a key older than the naming rule (backups keep it as text).

export const LAST_SYMBOL_STORAGE_KEY = "investseek:last-symbol";
const FALLBACK = "AAPL";
const listeners = new Set<() => void>();
let snapshot: string | null = null;

function read(): string {
  try {
    return normalizeSymbol(window.localStorage.getItem(LAST_SYMBOL_STORAGE_KEY)) ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Another tab, a restore or "Clear all data" changed the key: read it again. A restore in this tab announces its
 * writes with the same storage event (lib/backup.ts, browserEnv); key is null when another tab cleared all storage.
 */
function onStorage(event: StorageEvent) {
  if (event.key !== LAST_SYMBOL_STORAGE_KEY && event.key !== null) return;
  const next = read();
  if (next === snapshot) return;
  snapshot = next;
  emit();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    // While nothing listened, another tab may have changed the key without this tab hearing about it.
    snapshot = null;
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string {
  return (snapshot ??= read());
}

/** The external store behind useLastSymbol (exported for tests). */
export const lastSymbolStore = { subscribe, getSnapshot };

/**
 * Records the most recently viewed quote so the Quote navigation item (QT) and security codes typed alone return to it,
 * and adds it to the recent symbols of the command bar (hooks/useRecents.ts).
 */
export function rememberSymbol(symbol: string) {
  addRecent(symbol);
  if (snapshot === symbol) return;
  snapshot = symbol;
  try {
    window.localStorage.setItem(LAST_SYMBOL_STORAGE_KEY, symbol);
  } catch {
    // ignore storage errors
  }
  emit();
}

/** The last symbol viewed (AAPL before any), kept current across tabs and restores. The fallback during server rendering. */
export function useLastSymbol(): string {
  return useSyncExternalStore(lastSymbolStore.subscribe, lastSymbolStore.getSnapshot, () => FALLBACK);
}
