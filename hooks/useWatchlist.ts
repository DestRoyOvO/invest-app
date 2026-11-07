"use client";

import { useCallback, useSyncExternalStore } from "react";

import { normalizeSymbol } from "@/lib/symbols";
import { DEFAULT_WATCHLIST, MAX_WATCHLIST } from "@/lib/universe";

// The watchlist lives in localStorage (no account needed). useSyncExternalStore keeps every component
// and every open tab in sync, and avoids hydration mismatches by rendering an empty list on the server.

export const WATCHLIST_STORAGE_KEY = "investseek:watchlist:v1";
const STORAGE_KEY = WATCHLIST_STORAGE_KEY;
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let snapshot: string[] | null = null;

/** Turns stored or imported data into a valid watchlist (normalized, unique, capped); exported for backups. */
export function sanitizeWatchlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_WATCHLIST];
  const out: string[] = [];
  for (const item of value) {
    const symbol = normalizeSymbol(item);
    if (symbol && !out.includes(symbol)) out.push(symbol);
    if (out.length >= MAX_WATCHLIST) break;
  }
  return out;
}

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? [...DEFAULT_WATCHLIST] : sanitizeWatchlist(JSON.parse(raw));
  } catch {
    return [...DEFAULT_WATCHLIST];
  }
}

function getSnapshot(): string[] {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
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

/** Re-reads storage before a change, so an edit never overwrites a list saved in another tab. */
function latest(): string[] {
  snapshot = read();
  return snapshot;
}

function write(next: string[]) {
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode, quota); keep the in-memory list.
  }
  emit();
}

const noopSubscribe = () => () => {};

export type AddResult = "added" | "exists" | "invalid" | "full";

export function useWatchlist() {
  const symbols = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const add = useCallback((input: string): AddResult => {
    const symbol = normalizeSymbol(input);
    if (!symbol) return "invalid";
    const current = latest();
    if (current.includes(symbol)) return "exists";
    if (current.length >= MAX_WATCHLIST) return "full";
    write([...current, symbol]);
    return "added";
  }, []);

  const remove = useCallback((symbol: string) => {
    write(latest().filter((s) => s !== symbol));
  }, []);

  const toggle = useCallback(
    (symbol: string) => {
      if (latest().includes(symbol)) remove(symbol);
      else add(symbol);
    },
    [add, remove],
  );

  const move = useCallback((symbol: string, offset: -1 | 1) => {
    const current = [...latest()];
    const index = current.indexOf(symbol);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    write(current);
  }, []);

  return { symbols, hydrated, add, remove, toggle, move, has: (symbol: string) => symbols.includes(symbol) };
}
