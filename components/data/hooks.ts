"use client";

// React hooks for the data screens: what is stored right now, symbol checks for imports, and applying restored
// display preferences to the open page.

import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useHoldings } from "@/hooks/useHoldings";
import { useWatchlist } from "@/hooks/useWatchlist";
import { readStorage, type PrefCookies, type StorageSnapshot } from "@/lib/backup";
import { registeredLocalStores } from "@/lib/local-store";

import { applyPrefCookies, prefCookiesOf } from "./prefs-sync";
import { checkSymbols, type SymbolCheck } from "./symbol-check";

const EMPTY_SNAPSHOT: StorageSnapshot = {};
let cachedSnapshot: StorageSnapshot | null = null;

function sameSnapshot(a: StorageSnapshot, b: StorageSnapshot): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function readSnapshot(): StorageSnapshot {
  try {
    const fresh = readStorage(window.localStorage);
    if (cachedSnapshot && sameSnapshot(cachedSnapshot, fresh)) return cachedSnapshot;
    cachedSnapshot = fresh;
    return fresh;
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function subscribeSnapshot(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  const unsubscribers = [...registeredLocalStores().values()].map((store) => store.subscribe(onChange));
  return () => {
    window.removeEventListener("storage", onChange);
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

/**
 * The app's stored keys and raw values (not the backup bookkeeping), kept current: other tabs and restores announce
 * changes with storage events, the local stores notify their subscribers, and edits through the watchlist and
 * positions hooks re-render this component. Null during server rendering.
 */
export function useStorageSnapshot(): StorageSnapshot | null {
  useWatchlist();
  useHoldings();
  return useSyncExternalStore<StorageSnapshot | null>(subscribeSnapshot, readSnapshot, () => null);
}

/**
 * Checks symbols against live quotes, each symbol once, shortly after the list stops changing. A symbol without a
 * result yet is being checked. `retry` checks again the symbols whose check failed (network or Yahoo down).
 */
export function useSymbolChecks(symbols: readonly string[], queriesOf: (symbol: string) => string[]) {
  const [checks, setChecks] = useState<ReadonlyMap<string, SymbolCheck>>(() => new Map());
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  const key = symbols.join(",");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useEffectEvent(async (pending: string[]) => {
    for (const symbol of pending) inFlight.current.add(symbol);
    const result = await checkSymbols(pending, queriesOf);
    for (const symbol of pending) inFlight.current.delete(symbol);
    if (mounted.current) setChecks((current) => new Map([...current, ...result]));
  });

  useEffect(() => {
    const pending = (key ? key.split(",") : []).filter((symbol) => !checks.has(symbol) && !inFlight.current.has(symbol));
    if (pending.length === 0) return;
    const timer = window.setTimeout(() => void run(pending), 600);
    return () => window.clearTimeout(timer);
  }, [key, checks]);

  const retry = useCallback(() => {
    setChecks((current) => new Map([...current].filter(([, check]) => check.status !== "failed")));
  }, []);

  return { checks, retry };
}

/**
 * Applies restored preference values to the open page through the preferences provider (prefs-sync.ts), so the
 * cookies, the <html> attributes, the theme-color meta and the resolved theme change together, as they do from the
 * settings menu. Values this version cannot show are left alone. `current` is what is on screen now, so a restore can
 * be compared and undone.
 */
export function usePrefsSync() {
  const { lang, theme, updown, density, setLang, setTheme, setUpdown, setDensity } = usePrefs();

  const apply = useCallback((cookies: PrefCookies) => applyPrefCookies(cookies, { setLang, setTheme, setUpdown, setDensity }), [setLang, setTheme, setUpdown, setDensity]);

  const current = useCallback((): PrefCookies => prefCookiesOf({ lang, theme, updown, density }), [lang, theme, updown, density]);

  return { apply, current };
}
