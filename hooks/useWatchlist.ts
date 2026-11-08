"use client";

import { useSyncExternalStore } from "react";

import { fetchJson, symbolsParam } from "@/lib/api-client";
import { createLocalStore } from "@/lib/local-store";
import { normalizeSymbol } from "@/lib/symbols";
import { DEFAULT_WATCHLIST, MAX_WATCHLIST } from "@/lib/universe";
import type { QuotesResponse } from "@/types/api";

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

// ---------------------------------------------------------------------------------------------------------------------
// Typed symbols
// ---------------------------------------------------------------------------------------------------------------------
// Every other way in adds a symbol the app has already shown: a search suggestion, a loaded quote page, a screener
// row, a symbol the command bar knows, a starter chip, a restored backup. Text typed into the add form can be any
// well-formed ticker, so before it is saved the data source is asked through /api/quotes, the request behind the
// watchlist's Not found notice: a symbol the answer lists as missing is refused. When the lookup itself fails
// (offline, rate limited, Yahoo down) the symbol is added as before, so the list keeps working and the Not found notice
// stays the safety net.

/** What the data source says about a symbol: known, unknown (the quotes route lists it as missing), or no answer. */
export type SymbolLookup = "known" | "unknown" | "unavailable";

export type Fetcher = <T>(url: string) => Promise<T>;

/** How long the add form waits for a lookup; a slower one counts as unavailable, and the symbol is added unchecked. */
export const LOOKUP_TIMEOUT_MS = 6_000;

/**
 * Asks the app's quotes route whether the data source knows `symbol` (normalized): unknown when the answer lists it as
 * missing, as the watchlist's Not found notice reads it; unavailable when the request fails or takes longer than
 * `timeoutMs`.
 */
export async function lookUpSymbol(symbol: string, { fetcher = fetchJson, timeoutMs = LOOKUP_TIMEOUT_MS }: { fetcher?: Fetcher; timeoutMs?: number } = {}): Promise<SymbolLookup> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SymbolLookup>((resolve) => {
    timer = setTimeout(() => resolve("unavailable"), timeoutMs);
  });
  const answer = fetcher<QuotesResponse>(`/api/quotes?symbols=${symbolsParam([symbol])}`).then(
    (response): SymbolLookup => (Array.isArray(response?.missing) && response.missing.includes(symbol) ? "unknown" : "known"),
    (): SymbolLookup => "unavailable",
  );
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}

export type TypedAddResult = AddResult | "unknown";

export type TypedAddPlan = { kind: "settled"; result: "invalid" | "exists" | "full" } | { kind: "lookup"; symbol: string };

/**
 * What typed text needs before anything is saved: a malformed ticker, one already listed (in any case) and a full list
 * settle at once, without a request; any other symbol is looked up first.
 */
export function planTypedAdd(input: string, current: readonly string[]): TypedAddPlan {
  const symbol = normalizeSymbol(input);
  if (!symbol) return { kind: "settled", result: "invalid" };
  if (current.includes(symbol)) return { kind: "settled", result: "exists" };
  if (current.length >= MAX_WATCHLIST) return { kind: "settled", result: "full" };
  return { kind: "lookup", symbol };
}

/**
 * Adds a symbol typed into the add form (see Typed symbols above). The result comes at once when the text settles it,
 * and as a promise while the data source is asked: "unknown" when it does not know the symbol, which is not saved;
 * otherwise what adding it gives, checked again against the list as it is then (another tab may have changed it).
 */
export function addTypedSymbol(input: string, lookup: (symbol: string) => Promise<SymbolLookup> = (symbol) => lookUpSymbol(symbol)): AddResult | Promise<TypedAddResult> {
  const plan = planTypedAdd(input, watchlistStore.getSnapshot());
  if (plan.kind === "settled") return plan.result;
  return lookup(plan.symbol).then(
    (found) => (found === "unknown" ? "unknown" : addSymbol(plan.symbol)),
    () => addSymbol(plan.symbol),
  );
}

/** The watchlist changes outside React (backups, imports, tests); components use useWatchlist(). */
export const watchlistActions = {
  add: addToEnd,
  /** Text typed into the add form: looked up before it is saved (addTypedSymbol). */
  addTyped: (input: string) => addTypedSymbol(input),
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
    /** Adds a symbol the app has shown (a suggestion, a quote, a screener row) without asking the data source. */
    add: addToEnd,
    /** Adds text typed into the add form once the data source knows it (addTypedSymbol). */
    addTyped: watchlistActions.addTyped,
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
