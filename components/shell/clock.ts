"use client";

import { useSyncExternalStore } from "react";

// Shared wall clocks for the shell: one ticking every second (the market clock and its countdown) and one every 30
// seconds (the session ribbon). The server snapshot is null, so nothing time-dependent renders before hydration.

interface Clock {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number | null;
}

function createClock(intervalMs: number): Clock {
  const listeners = new Set<() => void>();
  let now: number | null = null;
  let timer: number | undefined;

  const tick = () => {
    now = Date.now();
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (timer === undefined) {
        now = Date.now();
        timer = window.setInterval(tick, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
          window.clearInterval(timer);
          timer = undefined;
        }
      };
    },
    getSnapshot: () => now,
  };
}

const clocks = { second: createClock(1_000), halfMinute: createClock(30_000) };
const serverSnapshot = () => null;

/** The current time in ms, updated every second or every 30 seconds; null during server rendering and hydration. */
export function useNow(resolution: keyof typeof clocks = "second"): number | null {
  const clock = clocks[resolution];
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, serverSnapshot);
}
