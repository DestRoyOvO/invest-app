"use client";

import { useSyncExternalStore } from "react";

import { createLocalStore } from "@/lib/local-store";
import { normalizeSymbol } from "@/lib/symbols";
import { DEFAULT_WATCHLIST, MAX_WATCHLIST } from "@/lib/universe";

import { useLocalStore } from "./useLocalStore";

// The watchlist lives in localStorage (no account needed), through a local store (lib/local-store.ts) that keeps every
// component and every open tab in sync, and renders an empty list on the server to avoid hydration mismatches. The
// stored order is the investor's own order: sorting a table never rewrites it.

export const WATCHLIST_STORAGE_KEY = "investseek:watchlist:v1";
const EMPTY: string[] = [];

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

/** The store behind useWatchlist; registered for backup and restore. */
export const watchlistStore = createLocalStore<string[]>({
  key: WATCHLIST_STORAGE_KEY,
  sanitize: sanitizeWatchlist,
  empty: EMPTY,
  // A first visit starts with a few large caps; an emptied list stays empty.
  initial: () => [...DEFAULT_WATCHLIST],
});

/** `item` moved to `index` (clamped); the same array when it is missing or already there. */
export function moveItem<T>(list: readonly T[], item: T, index: number): readonly T[] {
  const from = list.indexOf(item);
  if (from < 0) return list;
  const to = Math.max(0, Math.min(list.length - 1, Math.trunc(index)));
  if (from === to) return list;
  const next = list.filter((_, i) => i !== from);
  next.splice(to, 0, item);
  return next;
}

/** `item` inserted at `index` (clamped), e.g. to undo a removal in place; the same array when it is already there. */
export function insertItem<T>(list: readonly T[], item: T, index: number): readonly T[] {
  if (list.includes(item)) return list;
  const at = Math.max(0, Math.min(list.length, Math.trunc(index)));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

const noopSubscribe = () => () => {};

export type AddResult = "added" | "exists" | "invalid" | "full";

function addSymbol(input: string, index?: number): AddResult {
  const symbol = normalizeSymbol(input);
  if (!symbol) return "invalid";
  let result: AddResult = "added";
  watchlistStore.update((current) => {
    if (current.includes(symbol)) {
      result = "exists";
      return current;
    }
    if (current.length >= MAX_WATCHLIST) {
      result = "full";
      return current;
    }
    return index === undefined ? [...current, symbol] : [...insertItem(current, symbol, index)];
  });
  return result;
}

const addToEnd = (input: string) => addSymbol(input);
const insertAt = (input: string, index: number) => addSymbol(input, index);

/** The watchlist changes outside React (backups, imports, tests); components use useWatchlist(). */
export const watchlistActions = {
  add: addToEnd,
  insertAt,
  remove: (symbol: string) => removeSymbol(symbol),
  toggle: (symbol: string) => toggleSymbol(symbol),
  move: (symbol: string, offset: -1 | 1) => moveBy(symbol, offset),
  moveTo: (symbol: string, index: number) => moveTo(symbol, index),
};

function removeSymbol(symbol: string) {
  watchlistStore.update((current) => current.filter((s) => s !== symbol));
}

function toggleSymbol(symbol: string) {
  if (watchlistStore.getSnapshot().includes(symbol)) removeSymbol(symbol);
  else addSymbol(symbol);
}

function moveBy(symbol: string, offset: -1 | 1) {
  watchlistStore.update((current) => {
    const index = current.indexOf(symbol);
    return index < 0 ? current : [...moveItem(current, symbol, index + offset)];
  });
}

function moveTo(symbol: string, index: number) {
  watchlistStore.update((current) => [...moveItem(current, symbol, index)]);
}

export function useWatchlist() {
  const symbols = useLocalStore(watchlistStore);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return {
    symbols,
    hydrated,
    add: addToEnd,
    /** Adds the symbol at a position in the stored order (used to undo a removal in place). */
    insertAt,
    remove: removeSymbol,
    toggle: toggleSymbol,
    /** Swaps the symbol with its neighbour. */
    move: moveBy,
    /** Moves the symbol to a position in the stored order. */
    moveTo,
    has: (symbol: string) => symbols.includes(symbol),
  };
}
