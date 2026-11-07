// Queue rules for Toast, kept free of React so they can be tested.

export interface QueuedToast {
  id: string;
}

/** Appends a toast (replacing one with the same id) and keeps the newest `max`, so a burst never floods the screen. */
export function pushToast<T extends QueuedToast>(queue: readonly T[], toast: T, max: number): T[] {
  const next = [...queue.filter((item) => item.id !== toast.id), toast];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function removeToast<T extends QueuedToast>(queue: readonly T[], id: string): T[] {
  return queue.filter((item) => item.id !== id);
}

/**
 * Time left before a toast closes when its timer resumes after a pause (hover or focus). It never drops below
 * `floor`, so a toast left the moment before it expired still gives the reader a moment to act.
 */
export function remainingTime(deadline: number, now: number, floor = 1500): number {
  return Math.max(deadline - now, floor);
}
