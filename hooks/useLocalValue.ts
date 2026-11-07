"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** True after hydration; use to avoid rendering browser-only values during SSR. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** A string kept in localStorage (best effort; falls back to memory when storage is unavailable). */
export function useLocalString(key: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      // Sync from storage once after mount (localStorage is not available during SSR).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setValue(stored);
    } catch {
      // ignore
    }
  }, [key]);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // ignore
      }
    },
    [key],
  );

  return [value, update];
}

/** Debounces a value. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
