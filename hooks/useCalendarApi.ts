"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import useSWR from "swr";

import type { CalendarResponse } from "@/types/api";

/** Symbols one /api/calendar request accepts (the route answers 400 above this). */
export const AGENDA_MAX_SYMBOLS = 100;

/**
 * Events for the symbols over the next `days` days, plus the stock universe when asked, from /api/calendar. Pass null
 * while the symbol lists are still loading from the browser, so the page does not first request an empty list. The
 * key matches useCalendar in hooks/useApi.ts, so both share one cache entry. Only the first AGENDA_MAX_SYMBOLS symbols
 * are sent; callers say so when the list is longer.
 */
export function useAgendaFeed(symbols: readonly string[] | null, days: number, includeUniverse = false) {
  let key: string | null = null;
  if (symbols !== null) {
    const params = new URLSearchParams({ days: String(days) });
    if (symbols.length > 0) params.set("symbols", symbols.slice(0, AGENDA_MAX_SYMBOLS).join(","));
    if (includeUniverse) params.set("scope", "universe");
    key = `/api/calendar?${params.toString()}`;
  }
  return useSWR<CalendarResponse>(key, { refreshInterval: 1_800_000, revalidateOnFocus: false });
}

/**
 * True once the element has come within `margin` of the viewport (and stays true), for loading row details lazily.
 * Without IntersectionObserver (old browsers) it turns true right after mounting.
 */
export function useSeen<T extends Element>(margin = "200px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setSeen(true), 0);
      return () => window.clearTimeout(id);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen, margin]);
  return [ref, seen];
}
