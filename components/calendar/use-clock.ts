"use client";

import { useSyncExternalStore } from "react";

import { NEW_YORK } from "@/lib/events";

// A coarse clock for date ranges and relative labels. The server snapshot is null, so nothing that depends on the time
// of day renders before hydration (the server may sit in another time zone and render at another moment).
const noop = () => () => {};

function subscribeClock(step: number) {
  return (onChange: () => void) => {
    const id = window.setInterval(onChange, Math.min(step, 60_000));
    return () => window.clearInterval(id);
  };
}

const clockSubscribers = new Map<number, (onChange: () => void) => () => void>();

/** Now, rounded down to `step` ms (a stable value between ticks); null during server rendering and hydration. */
export function useClock(step = 60_000): number | null {
  let subscribe = clockSubscribers.get(step);
  if (!subscribe) {
    subscribe = subscribeClock(step);
    clockSubscribers.set(step, subscribe);
  }
  return useSyncExternalStore(subscribe, () => Math.floor(Date.now() / step) * step, () => null);
}

function readZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The viewer's IANA time zone; null on the server, and null when it is New York (no second clock needed). */
export function useViewerZone(): string | null {
  const zone = useSyncExternalStore(noop, readZone, () => null);
  return zone === NEW_YORK ? null : zone;
}
